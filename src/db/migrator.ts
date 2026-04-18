import fs from "node:fs";
import path from "node:path";
import type { DbConnection } from "./connection.js";
import type { Logger } from "pino";

const MIGRATIONS_TABLE = "_migrations";

/**
 * Split a SQL file into individual statements, correctly ignoring semicolons
 * that appear inside -- line comments or /* block comments *\/.
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    // Line comment: skip to end of line
    if (sql[i] === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        current += sql[i];
        i++;
      }
      continue;
    }

    // Block comment: skip until */
    if (sql[i] === "/" && sql[i + 1] === "*") {
      current += sql[i++];
      current += sql[i++];
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        current += sql[i++];
      }
      if (i < sql.length) {
        current += sql[i++]; // *
        current += sql[i++]; // /
      }
      continue;
    }

    // Statement terminator
    if (sql[i] === ";") {
      const trimmed = current.trim();
      // Only add if it has actual SQL (not just comments/whitespace)
      if (trimmed && /[A-Za-z]/.test(trimmed)) {
        statements.push(trimmed);
      }
      current = "";
      i++;
      continue;
    }

    current += sql[i++];
  }

  // Handle any trailing statement without a semicolon
  const trimmed = current.trim();
  if (trimmed && /[A-Za-z]/.test(trimmed)) {
    statements.push(trimmed);
  }

  return statements;
}

async function ensureMigrationsTable(db: DbConnection, driver: string): Promise<void> {
  const createSql =
    driver === "sqlite"
      ? `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           name TEXT NOT NULL UNIQUE,
           applied_at TEXT NOT NULL DEFAULT (datetime('now'))
         )`
      : `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
           id SERIAL PRIMARY KEY,
           name VARCHAR(255) NOT NULL UNIQUE,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
         )`;

  // We need DDL for the migration table itself — use the underlying connection directly
  // This is called with allow_ddl: true context, so we bypass via raw execute
  await db.execute(createSql, []);
}

async function getAppliedMigrations(db: DbConnection): Promise<Set<string>> {
  try {
    const result = await db.query(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY id ASC`
    );
    return new Set(result.rows.map((r) => r["name"] as string));
  } catch {
    return new Set();
  }
}

export async function migrateUp(
  db: DbConnection,
  migrationsDir: string,
  driver: string,
  logger: Logger
): Promise<{ applied: string[]; errors: string[] }> {
  const applied: string[] = [];
  const errors: string[] = [];

  // Ensure migrations directory exists
  if (!fs.existsSync(migrationsDir)) {
    logger.warn({ migrationsDir }, "Migrations directory not found, skipping");
    return { applied, errors };
  }

  // Temporarily allow DDL for the migrations table
  try {
    await ensureMigrationsTable(db, driver);
  } catch (err) {
    // If table creation fails (might already exist), continue
    logger.debug({ err }, "migrations table setup");
  }

  const existingMigrations = await getAppliedMigrations(db);

  // Read all .sql files, sorted numerically
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && !f.includes(".down."))
    .sort();

  for (const file of files) {
    if (existingMigrations.has(file)) {
      logger.debug({ migration: file }, "Already applied, skipping");
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf-8");

  // Split on semicolons, ignoring those inside -- line comments
  const statements = splitSqlStatements(sql);

    try {
      for (const stmt of statements) {
        await db.execute(stmt, []);
      }

      // Record migration as applied
      const insertSql =
        driver === "sqlite"
          ? `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`
          : `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`;
      await db.execute(insertSql, [file]);

      applied.push(file);
      logger.info({ migration: file }, "Migration applied");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${file}: ${msg}`);
      logger.error({ migration: file, err }, "Migration failed");
      break; // Stop on first failure
    }
  }

  return { applied, errors };
}

export async function migrateDown(
  db: DbConnection,
  migrationsDir: string,
  driver: string,
  logger: Logger,
  steps = 1
): Promise<{ reverted: string[]; errors: string[] }> {
  const reverted: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(migrationsDir)) {
    logger.warn({ migrationsDir }, "Migrations directory not found");
    return { reverted, errors };
  }

  const existingMigrations = await getAppliedMigrations(db);
  const appliedList = [...existingMigrations].reverse().slice(0, steps);

  for (const migrationName of appliedList) {
    const downFile = migrationName.replace(".sql", ".down.sql");
    const downPath = path.join(migrationsDir, downFile);

    if (!fs.existsSync(downPath)) {
      errors.push(`${migrationName}: no down migration file found (${downFile})`);
      continue;
    }

    const sql = fs.readFileSync(downPath, "utf-8");
    const statements = splitSqlStatements(sql);

    try {
      for (const stmt of statements) {
        await db.execute(stmt, []);
      }
      const deleteSql =
        driver === "sqlite"
          ? `DELETE FROM ${MIGRATIONS_TABLE} WHERE name = ?`
          : `DELETE FROM ${MIGRATIONS_TABLE} WHERE name = $1`;
      await db.execute(deleteSql, [migrationName]);
      reverted.push(migrationName);
      logger.info({ migration: migrationName }, "Migration reverted");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${migrationName}: ${msg}`);
      logger.error({ migration: migrationName, err }, "Migration revert failed");
      break;
    }
  }

  return { reverted, errors };
}

export async function getMigrationStatus(
  db: DbConnection,
  migrationsDir: string
): Promise<{ name: string; applied: boolean }[]> {
  let allFiles: string[] = [];
  if (fs.existsSync(migrationsDir)) {
    allFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && !f.includes(".down."))
      .sort();
  }

  const applied = await getAppliedMigrations(db);

  return allFiles.map((f) => ({ name: f, applied: applied.has(f) }));
}
