import { loadConfig } from "../config/loader.js";
import { createSpecStore } from "../specs/store.js";
import pino from "pino";

export async function validateCommand(configFile?: string): Promise<void> {
  const config = loadConfig(configFile);
  const logger = pino({ level: "warn" });

  const specStore = createSpecStore(config.specs, logger);
  const routes = specStore.getRoutes();
  const allSpecs = specStore.getAllSpecs();
  const specPaths = new Set(allSpecs.map((s) => s.relativePath));

  console.log(`Loaded ${allSpecs.length} spec file(s), ${routes.length} route(s)\n`);

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check all referenced specs exist
  for (const route of routes) {
    if (!specPaths.has(route.specPath)) {
      errors.push(
        `Route ${route.method} ${route.pattern} references missing spec: ${route.specPath}`
      );
    }
  }

  // Check for duplicate routes
  const seen = new Map<string, string>();
  for (const route of routes) {
    const key = `${route.method} ${route.pattern}`;
    if (seen.has(key)) {
      errors.push(`Duplicate route: ${key}`);
    } else {
      seen.set(key, route.specPath);
    }
  }

  // Check global specs exist
  for (const globalSpec of config.specs.global_specs) {
    if (!specPaths.has(globalSpec)) {
      warnings.push(`Global spec not found: ${globalSpec}`);
    }
  }

  // Check routes file
  if (!specPaths.has(config.specs.routes_file)) {
    warnings.push(`Routes file not found: ${config.specs.routes_file} (will use frontmatter routing)`);
  }

  // Report
  if (warnings.length > 0) {
    console.log("WARNINGS:");
    for (const w of warnings) console.log(`  ⚠  ${w}`);
    console.log();
  }

  if (errors.length > 0) {
    console.log("ERRORS:");
    for (const e of errors) console.log(`  ✗  ${e}`);
    console.log();
    console.log(`Validation failed: ${errors.length} error(s)`);
    process.exit(1);
  } else {
    console.log(`✓ All ${routes.length} routes are valid`);
    if (routes.length > 0) {
      console.log("\nRoutes:");
      for (const route of routes) {
        console.log(`  ${route.method.padEnd(7)} ${route.pattern.padEnd(50)} → ${route.specPath}`);
      }
    }
  }
}
