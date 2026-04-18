import { serve } from "@hono/node-server";
import pino from "pino";
import { loadConfig } from "../config/loader.js";
import { getConnection } from "../db/connection.js";
import { migrateUp } from "../db/migrator.js";
import { createSpecStore } from "../specs/store.js";
import { createApp } from "../server/app.js";
import path from "node:path";

export async function serveCommand(configFile?: string): Promise<void> {
  const config = loadConfig(configFile);

  // Set up logger
  const logger = pino({
    level: config.logging.level,
    transport:
      config.logging.format === "text"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });

  logger.info({ provider: config.llm.provider, model: config.llm.model }, "Starting Agentic Service");

  // Connect to database
  const db = await getConnection(config.database, logger);

  // Auto-migrate if configured
  if (config.database.migrations.auto_migrate) {
    const migrationsDir = path.resolve(
      process.cwd(),
      config.database.migrations.directory
    );
    logger.info({ migrationsDir }, "Running auto-migrations");
    const { applied, errors } = await migrateUp(
      db,
      migrationsDir,
      config.database.driver,
      logger
    );
    if (applied.length > 0) {
      logger.info({ applied }, "Migrations applied");
    }
    if (errors.length > 0) {
      logger.error({ errors }, "Migration errors");
      process.exit(1);
    }
  }

  // Load specs
  const specStore = createSpecStore(config.specs, logger);

  // Validate specs on startup
  if (config.specs.validate_on_startup) {
    const routes = specStore.getRoutes();
    const allSpecs = specStore.getAllSpecs();
    const specPaths = new Set(allSpecs.map((s) => s.relativePath));

    const issues: string[] = [];
    for (const route of routes) {
      if (!specPaths.has(route.specPath)) {
        issues.push(`Route ${route.method} ${route.pattern} references missing spec: ${route.specPath}`);
      }
    }

    if (issues.length > 0) {
      for (const issue of issues) {
        logger.warn({ issue }, "Spec validation warning");
      }
      if (config.specs.strict_validation) {
        logger.error("Strict spec validation failed. Exiting.");
        process.exit(1);
      }
    } else {
      logger.info({ routeCount: routes.length }, "Specs validated OK");
    }
  }

  // Create and start server
  const app = createApp(config, db, specStore, logger);
  const port = config.server.port;

  serve(
    {
      fetch: app.fetch,
      port,
      hostname: config.server.host,
    },
    (info) => {
      logger.info(
        {
          host: config.server.host,
          port: info.port,
          specsDir: config.specs.directory,
          routes: specStore.getRoutes().length,
        },
        "Agentic Service ready"
      );
    }
  );

  // Graceful shutdown
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      logger.info({ signal }, "Shutting down");
      await db.close();
      process.exit(0);
    });
  }
}
