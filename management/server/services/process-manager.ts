import { ChildProcess, execSync, spawn } from "child_process";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import type { ProjectStatus } from "../types.js";

/** Uses lsof so it catches both IPv4 and IPv6 listeners reliably on macOS. */
function isPortInUse(port: number): boolean {
  try {
    const out = execSync(`lsof -i tcp:${port} -sTCP:LISTEN -P -n`, {
      stdio: "pipe",
      timeout: 3000,
    }).toString();
    return out.trim().length > 0;
  } catch {
    return false; // lsof exits 1 when nothing matches
  }
}

interface ManagedProcess {
  process: ChildProcess;
  name: string;
  port: number;
  startedAt: string;
  logs: string[];
  maxLogLines: number;
  listeners: Set<(line: string) => void>;
}

const processes = new Map<string, ManagedProcess>();
const MAX_LOG_LINES = 5000;

/**
 * Load a project's .env file (if it exists) and merge with defaults.
 * Also provides sensible defaults for required env vars that are commonly
 * missing during development (e.g. JWT secret).
 */
function buildProjectEnv(projectPath: string): NodeJS.ProcessEnv {
  const projectEnv: Record<string, string> = {};

  // Read .env file from the project directory
  const envFile = path.join(projectPath, ".env");
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      // Strip surrounding quotes from value
      let value = trimmed.slice(eqIdx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      projectEnv[key] = value;
    }
  }

  // Provide a default JWT secret if not set anywhere.
  // This is a development convenience — the secret is stable per management
  // server session so tokens remain valid across project restarts.
  const jwtSecretKey = "AGENTIC_AUTH_JWT_SECRET";
  if (!projectEnv[jwtSecretKey] && !process.env[jwtSecretKey]) {
    if (!defaultJwtSecret) {
      defaultJwtSecret = randomBytes(32).toString("hex");
    }
    projectEnv[jwtSecretKey] = defaultJwtSecret;
  }

  return {
    ...process.env,
    ...projectEnv,
    NODE_ENV: "development",
    FORCE_COLOR: "1",
    // tsx needs a writable temp dir; system TMPDIR may be sandboxed
    TMPDIR: process.env.TMPDIR ?? "/tmp",
  };
}

// Stable per management server session so tokens survive project restarts
let defaultJwtSecret: string | null = null;

export function getProjectStatus(name: string, port?: number): ProjectStatus {
  const managed = processes.get(name);

  if (!managed) {
    return {
      name,
      running: false,
      port,
      health: "unknown",
    };
  }

  return {
    name,
    running: true,
    pid: managed.process.pid,
    port: managed.port,
    startedAt: managed.startedAt,
    uptime: Date.now() - new Date(managed.startedAt).getTime(),
    health: "unknown", // will be updated by health check
  };
}

export async function startProject(
  projectPath: string,
  name: string,
  port: number
): Promise<ProjectStatus> {
  if (processes.has(name)) {
    throw new Error(`Project "${name}" is already running`);
  }

  if (isPortInUse(port)) {
    throw Object.assign(
      new Error(`Port ${port} is already in use. Choose a different port in config.yaml.`),
      { code: "PORT_IN_USE", port }
    );
  }

  // Determine how to start the project.
  // If the project has an index.ts, run it with tsx (library mode with custom handlers).
  // Otherwise fall back to the CLI serve command (config-only projects).
  const indexPath = path.join(projectPath, "index.ts");
  const hasIndex = fs.existsSync(indexPath);
  const child = hasIndex
    ? spawn("npx", ["tsx", indexPath], {
        cwd: projectPath,
        env: buildProjectEnv(projectPath),
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      })
    : spawn("npx", ["tsx", "../../src/index.ts", "serve", "--config", "./config.yaml"], {
        cwd: projectPath,
        env: buildProjectEnv(projectPath),
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

  const managed: ManagedProcess = {
    process: child,
    name,
    port,
    startedAt: new Date().toISOString(),
    logs: [],
    maxLogLines: MAX_LOG_LINES,
    listeners: new Set(),
  };

  const appendLog = (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      managed.logs.push(line);
      if (managed.logs.length > managed.maxLogLines) {
        managed.logs.shift();
      }
      for (const listener of managed.listeners) {
        listener(line);
      }
    }
  };

  child.stdout?.on("data", appendLog);
  child.stderr?.on("data", appendLog);

  child.on("exit", (code) => {
    const exitMsg = `[management] Process exited with code ${code}`;
    managed.logs.push(exitMsg);
    for (const listener of managed.listeners) {
      listener(exitMsg);
    }
    processes.delete(name);
  });

  child.on("error", (err) => {
    const errMsg = `[management] Process error: ${err.message}`;
    managed.logs.push(errMsg);
    for (const listener of managed.listeners) {
      listener(errMsg);
    }
    processes.delete(name);
  });

  processes.set(name, managed);

  // Poll until the process is healthy, crashes, or we time out (10 s).
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));

    // Process exited — figure out why and give a useful message.
    if (!processes.has(name)) {
      const logText = managed.logs.join("\n");
      if (logText.includes("EADDRINUSE") || logText.includes("address already in use")) {
        throw Object.assign(
          new Error(`Port ${port} is already in use. Choose a different port in config.yaml.`),
          { code: "PORT_IN_USE", port }
        );
      }
      throw new Error(`Project "${name}" failed to start. Check logs for details.`);
    }

    // Process is still running — check the health endpoint.
    const health = await checkHealth(port);
    if (health === "healthy") break;
  }

  return getProjectStatus(name, port);
}

export async function stopProject(name: string): Promise<void> {
  const managed = processes.get(name);
  if (!managed) {
    throw new Error(`Project "${name}" is not running`);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      managed.process.kill("SIGKILL");
      processes.delete(name);
      resolve();
    }, 5000);

    managed.process.on("exit", () => {
      clearTimeout(timeout);
      processes.delete(name);
      resolve();
    });

    managed.process.kill("SIGTERM");
  });
}

export function getProjectLogs(name: string): string[] {
  const managed = processes.get(name);
  return managed?.logs || [];
}

export function subscribeToLogs(
  name: string,
  listener: (line: string) => void
): () => void {
  const managed = processes.get(name);
  if (!managed) {
    return () => {};
  }

  managed.listeners.add(listener);
  return () => {
    managed.listeners.delete(listener);
  };
}

export async function checkHealth(
  port: number
): Promise<"healthy" | "unhealthy"> {
  try {
    const response = await fetch(`http://localhost:${port}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok ? "healthy" : "unhealthy";
  } catch {
    return "unhealthy";
  }
}

export function getAllRunningProjects(): string[] {
  return Array.from(processes.keys());
}

export async function stopAllProjects(): Promise<void> {
  const names = getAllRunningProjects();
  await Promise.all(names.map((name) => stopProject(name)));
}

export async function runMigrations(
  projectPath: string
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["tsx", "../../src/index.ts", "migrate", "up", "--config", "./config.yaml"],
      {
        cwd: projectPath,
        env: buildProjectEnv(projectPath),
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let output = "";
    child.stdout?.on("data", (data) => (output += data.toString()));
    child.stderr?.on("data", (data) => (output += data.toString()));

    child.on("exit", (code) => {
      resolve({ success: code === 0, output });
    });

    child.on("error", (err) => {
      resolve({ success: false, output: err.message });
    });
  });
}
