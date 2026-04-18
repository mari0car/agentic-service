import pino from "pino";
import path from "node:path";
import { loadConfig } from "../config/loader.js";
import { getConnection } from "../db/connection.js";
import { migrateUp, migrateDown, getMigrationStatus } from "../db/migrator.js";

export async function migrateCommand(
  direction: "up" | "down" | "status",
  configFile?: string,
  steps = 1
): Promise<void> {
  const config = loadConfig(configFile);
  const logger = pino({
    level: "info",
    transport:
      config.logging.format === "text"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });

  const db = await getConnection(config.database, logger);
  const migrationsDir = path.resolve(
    process.cwd(),
    config.database.migrations.directory
  );

  try {
    if (direction === "status") {
      const status = await getMigrationStatus(db, migrationsDir);
      if (status.length === 0) {
        console.log("No migration files found in", migrationsDir);
      } else {
        for (const m of status) {
          console.log(`${m.applied ? "[x]" : "[ ]"} ${m.name}`);
        }
      }
    } else if (direction === "up") {
      const { applied, errors } = await migrateUp(
        db,
        migrationsDir,
        config.database.driver,
        logger
      );
      if (applied.length === 0) {
        console.log("No new migrations to apply.");
      } else {
        console.log(`Applied ${applied.length} migration(s):`, applied.join(", "));
      }
      if (errors.length > 0) {
        console.error("Errors:", errors.join("\n"));
        process.exit(1);
      }
    } else if (direction === "down") {
      const { reverted, errors } = await migrateDown(
        db,
        migrationsDir,
        config.database.driver,
        logger,
        steps
      );
      if (reverted.length === 0) {
        console.log("Nothing to revert.");
      } else {
        console.log(`Reverted ${reverted.length} migration(s):`, reverted.join(", "));
      }
      if (errors.length > 0) {
        console.error("Errors:", errors.join("\n"));
        process.exit(1);
      }
    }
  } finally {
    await db.close();
  }
}
