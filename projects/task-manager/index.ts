/**
 * Task Manager — Library-mode entry point
 *
 * This file replaces the `agentic-service serve` CLI invocation for the
 * task-manager example. It starts the server in library mode so it can mount
 * the RouteHandlerRegistry (tool-registry.ts) alongside the standard
 * LLM-backed agent.
 *
 * Usage (from projects/task-manager/):
 *   export AGENTIC_AUTH_JWT_SECRET=my-secret-at-least-32-chars
 *   npx tsx index.ts
 *
 *   or via start.sh (which wraps this)
 *
 * The standard CLI still works for config-only deployments that don't need
 * custom handlers:
 *   node ../../dist/index.js serve --config ./config.yaml
 */

import { serve } from "@hono/node-server";
import pino from "pino";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Import framework in library mode via the src/ path so tsx resolves it
// directly from source — no build step needed during development.
import { loadConfig } from "../../src/config/loader.js";
import { getConnection } from "../../src/db/connection.js";
import { migrateUp } from "../../src/db/migrator.js";
import { createSpecStore } from "../../src/specs/store.js";
import { createApp } from "../../src/server/app.js";

import { buildRegistry } from "./tool-registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const configFile = path.resolve(__dirname, "config.yaml");
  const config = loadConfig(configFile);

  const logger = pino({
    level: config.logging.level,
    transport:
      config.logging.format === "text"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });

  // ── Load handler registry (safe — one file per handler) ─────────────────────
  //
  // Each handler is imported in isolation. A syntax or runtime error in one
  // handler file only removes that handler; the others load normally and the
  // service starts. The broken route falls back to the LLM agent.
  const { registry, failures } = await buildRegistry(logger);

  logger.info(
    {
      provider: config.llm.provider,
      model: config.llm.model,
      handlers: registry.size,
      failedHandlers: failures.size,
    },
    "Starting Task Manager (library mode)"
  );

  if (failures.size > 0) {
    logger.warn(
      { failures: Object.fromEntries(failures) },
      "Some handlers failed to load — those routes will fall back to the LLM"
    );
  }

  // ── Database ────────────────────────────────────────────────────────────────
  const db = await getConnection(config.database, logger);

  // Auto-migrate if the DB file doesn't exist yet (first run)
  if (config.database.migrations.auto_migrate) {
    const migrationsDir = path.resolve(__dirname, config.database.migrations.directory);
    logger.info({ migrationsDir }, "Running auto-migrations");
    const { applied, errors } = await migrateUp(
      db,
      migrationsDir,
      config.database.driver,
      logger
    );
    if (applied.length > 0) logger.info({ applied }, "Migrations applied");
    if (errors.length > 0) {
      logger.error({ errors }, "Migration errors");
      process.exit(1);
    }
  }

  // ── Spec store ──────────────────────────────────────────────────────────────
  const specStore = createSpecStore(config.specs, logger);

  if (config.specs.validate_on_startup) {
    const routes = specStore.getRoutes();
    const allSpecs = specStore.getAllSpecs();
    const specPaths = new Set(allSpecs.map((s) => s.relativePath));
    const issues = routes
      .filter((r) => !specPaths.has(r.specPath))
      .map((r) => `Route ${r.method} ${r.pattern} references missing spec: ${r.specPath}`);

    if (issues.length > 0) {
      for (const issue of issues) logger.warn({ issue }, "Spec validation warning");
      if (config.specs.strict_validation) {
        logger.error("Strict spec validation failed. Exiting.");
        process.exit(1);
      }
    } else {
      logger.info({ routeCount: routes.length }, "Specs validated OK");
    }
  }

  // ── Log handler registry ────────────────────────────────────────────────────
  const handlerKeys = Array.from(registry.keys());
  logger.info(
    {
      handlers: handlerKeys,
      shadowMode: config.tool_registry.shadow_mode,
      shadowSampleRate: config.tool_registry.shadow_sample_rate,
    },
    "Route handler registry loaded"
  );

  // ── Create app (with handler registry + failure map) ────────────────────────
  const app = createApp(config, db, specStore, logger, registry, failures);

  // ── Start server ─────────────────────────────────────────────────────────────
  const port = config.server.port;
  serve(
    { fetch: app.fetch, port, hostname: config.server.host },
    (info) => {
      logger.info(
        {
          host: config.server.host,
          port: info.port,
          routes: specStore.getRoutes().length,
          handlers: registry.size,
          failedHandlers: failures.size,
        },
        "Task Manager ready"
      );
    }
  );

  // ── Graceful shutdown ────────────────────────────────────────────────────────
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      logger.info({ signal }, "Shutting down");
      await db.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
