import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { scanProject, readProjectFile, writeProjectFile } from "../services/project-scanner.js";
import {
  startProject,
  stopProject,
  getProjectStatus,
  getProjectLogs,
  subscribeToLogs,
  checkHealth,
  runMigrations,
} from "../services/process-manager.js";

export const runtimeRoutes = new Hono();

// Get project status
runtimeRoutes.get("/:name/status", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const port = project.config?.server?.port || 8080;
  const status = getProjectStatus(name, port);

  // Check health if running
  if (status.running && status.port) {
    status.health = await checkHealth(status.port);
  }

  return c.json({ data: status });
});

// Start project
runtimeRoutes.post("/:name/start", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const port = project.config?.server?.port || 8080;

  try {
    const status = await startProject(project.path, name, port);
    return c.json({ data: status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to start";
    return c.json({ error: message }, 400);
  }
});

// Stop project
runtimeRoutes.post("/:name/stop", async (c) => {
  const name = c.req.param("name");

  try {
    await stopProject(name);
    return c.json({ data: { stopped: true } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to stop";
    return c.json({ error: message }, 400);
  }
});

// Get logs (non-streaming)
runtimeRoutes.get("/:name/logs", async (c) => {
  const name = c.req.param("name");
  const lines = getProjectLogs(name);
  return c.json({ data: { lines } });
});

// Stream logs via SSE
runtimeRoutes.get("/:name/logs/stream", async (c) => {
  const name = c.req.param("name");

  return streamSSE(c, async (stream) => {
    // Send existing logs first
    const existingLogs = getProjectLogs(name);
    for (const line of existingLogs) {
      await stream.writeSSE({ data: line, event: "log" });
    }

    // Subscribe to new logs
    const unsubscribe = subscribeToLogs(name, (line) => {
      stream.writeSSE({ data: line, event: "log" }).catch(() => {
        unsubscribe();
      });
    });

    // Keep connection alive
    const interval = setInterval(() => {
      stream.writeSSE({ data: "", event: "ping" }).catch(() => {
        clearInterval(interval);
        unsubscribe();
      });
    }, 15000);

    stream.onAbort(() => {
      clearInterval(interval);
      unsubscribe();
    });

    // Block until aborted
    await new Promise<void>((resolve) => {
      stream.onAbort(resolve);
    });
  });
});

// Check health
runtimeRoutes.get("/:name/health", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const port = project.config?.server?.port || 8080;
  const health = await checkHealth(port);
  return c.json({ data: { health } });
});

// Run migrations
runtimeRoutes.post("/:name/migrate", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const result = await runMigrations(project.path);
  return c.json({ data: result });
});

// Proxy API requests to the running project
runtimeRoutes.post("/:name/test", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const port = project.config?.server?.port || 8080;
  const body = await c.req.json<{
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  }>();

  const start = Date.now();
  try {
    const url = `http://localhost:${port}${body.path}`;
    const fetchOptions: RequestInit = {
      method: body.method,
      headers: {
        "Content-Type": "application/json",
        ...(body.headers || {}),
      },
      signal: AbortSignal.timeout(30000),
    };

    if (body.body && !["GET", "HEAD"].includes(body.method.toUpperCase())) {
      fetchOptions.body = JSON.stringify(body.body);
    }

    const response = await fetch(url, fetchOptions);
    const duration = Date.now() - start;

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseBody: unknown;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    const executionMode = response.headers.get("x-execution-mode") ?? null;
    const tokenInput = response.headers.has("x-token-usage-input")
      ? parseInt(response.headers.get("x-token-usage-input")!, 10)
      : null;
    const tokenOutput = response.headers.has("x-token-usage-output")
      ? parseInt(response.headers.get("x-token-usage-output")!, 10)
      : null;
    const serverDurationMs = response.headers.has("x-duration-ms")
      ? parseInt(response.headers.get("x-duration-ms")!, 10)
      : null;

    return c.json({
      data: {
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
        duration,
        executionMode,
        tokenInput,
        tokenOutput,
        serverDurationMs,
      },
    });
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : "Request failed";
    return c.json({
      data: {
        status: 0,
        headers: {},
        body: { error: message },
        duration,
      },
    });
  }
});

// Update port in config.yaml
runtimeRoutes.put("/:name/port", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project) return c.json({ error: "Project not found" }, 404);

  const { port } = await c.req.json<{ port: number }>();
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return c.json({ error: "Invalid port number (must be 1–65535)" }, 400);
  }

  try {
    const raw = await readProjectFile(project.path, "config.yaml");
    // Replace port value specifically under the server: section.
    // Strategy: find the server: block and replace its port: line in-place,
    // or insert one if absent. Scoping to the server block avoids matching
    // port: keys in other sections (e.g. database) and handles quoted values.
    const serverBlockRe = /(^server:[^\n]*\n)((?:[ \t]+[^\n]*\n)*)/m;
    const match = serverBlockRe.exec(raw);
    let updated: string;
    if (match) {
      const blockStart = match.index;
      const header = match[1];
      const body = match[2];
      if (/^[ \t]+port:/m.test(body)) {
        // Replace existing port line within the block
        const newBody = body.replace(/^([ \t]+port:[ \t]*)[\d"'][^\n]*/m, `$1${port}`);
        updated = raw.slice(0, blockStart) + header + newBody + raw.slice(blockStart + header.length + body.length);
      } else {
        // Insert port: as the first key under server:
        updated = raw.slice(0, blockStart) + header + `  port: ${port}\n` + body + raw.slice(blockStart + header.length + body.length);
      }
    } else {
      // No server: section at all — append one
      updated = raw + `\nserver:\n  port: ${port}\n`;
    }
    await writeProjectFile(project.path, "config.yaml", updated);
    return c.json({ data: { port, saved: true } });
  } catch {
    return c.json({ error: "Failed to update config.yaml" }, 500);
  }
});
