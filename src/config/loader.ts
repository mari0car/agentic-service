import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import yaml from "js-yaml";
import { ConfigSchema, type Config } from "./schema.js";

// Load .env from cwd
loadDotenv({ path: path.resolve(process.cwd(), ".env") });

/**
 * Map AGENTIC_<PATH> env vars onto a raw config object.
 * e.g. AGENTIC_SERVER_PORT=9000 → { server: { port: 9000 } }
 */
function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(raw) as Record<string, unknown>;

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("AGENTIC_")) continue;
    const parts = key
      .slice("AGENTIC_".length)
      .toLowerCase()
      .split("_");

    // Build nested path: AGENTIC_SERVER_PORT → ["server","port"]
    // We do a greedy match: walk the parts array and merge adjacent ones
    // to match existing keys in the config.
    setNestedValue(result, parts, value ?? "");
  }

  return result;
}

function setNestedValue(
  obj: Record<string, unknown>,
  parts: string[],
  value: string
): void {
  if (parts.length === 0) return;

  // Try to find the longest prefix that matches an existing key,
  // working from shortest to longest to handle compound config keys
  // (e.g. "max_retries" in the config matched by parts ["max","retries"]).
  // We try the longest possible prefix that exists in obj.
  for (let i = parts.length; i >= 1; i--) {
    const key = parts.slice(0, i).join("_");
    const rest = parts.slice(i);

    if (!(key in obj)) continue;

    if (rest.length === 0) {
      // Exact leaf match
      obj[key] = value;
      return;
    }

    // Found a matching prefix — recurse into it
    if (typeof obj[key] !== "object" || obj[key] === null) {
      obj[key] = {};
    }
    setNestedValue(obj[key] as Record<string, unknown>, rest, value);
    return;
  }

  // No existing key matched — create a new nested path from the first part
  if (parts.length === 1) {
    obj[parts[0]!] = value;
  } else {
    const key = parts[0]!;
    const rest = parts.slice(1);
    if (typeof obj[key] !== "object" || obj[key] === null) {
      obj[key] = {};
    }
    setNestedValue(obj[key] as Record<string, unknown>, rest, value);
  }
}

export function loadConfig(configFilePath?: string): Config {
  let rawFromFile: Record<string, unknown> = {};

  const filePath =
    configFilePath ?? path.resolve(process.cwd(), "config.yaml");

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === "object") {
      rawFromFile = parsed as Record<string, unknown>;
    }
  }

  const rawWithEnv = applyEnvOverrides(rawFromFile);

  const result = ConfigSchema.safeParse(rawWithEnv);
  if (!result.success) {
    console.error("Configuration validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
