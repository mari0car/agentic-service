import type { DatabaseConfig } from "../config/schema.js";
import type { Logger } from "pino";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type QueryResult = {
  rows: Record<string, unknown>[];
  row_count: number;
};

export type ExecuteResult = {
  affected_rows: number;
  returning: Record<string, unknown>[];
};

export type TransactionStatement = {
  sql: string;
  params?: unknown[];
};

export type TransactionResult = {
  results: (QueryResult | ExecuteResult | { error: string })[];
  committed: boolean;
};

export interface DbConnection {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>;
  transaction(statements: TransactionStatement[]): Promise<TransactionResult>;
  close(): Promise<void>;
  isHealthy(): Promise<boolean>;
}

// ─── PostgreSQL connection ──────────────────────────────────────────────────────

async function createPostgresConnection(
  config: DatabaseConfig,
  logger: Logger
): Promise<DbConnection> {
  const { default: postgres } = await import("postgres");

  const connectionString =
    config.url ??
    `postgres://${config.user ?? ""}:${config.password ?? ""}@${config.host}:${config.port}/${config.name}`;

  const sql = postgres(connectionString, {
    max: config.max_connections,
    idle_timeout: config.idle_timeout_ms / 1000,
    connect_timeout: config.connection_timeout_ms / 1000,
    ssl: config.ssl_mode === "disable" ? false : config.ssl_mode === "require" ? "require" : undefined,
    onnotice: (msg) => logger.debug({ msg }, "postgres notice"),
  });

  const maxRows = config.max_rows;

  const conn: DbConnection = {
    async query(querySql: string, params: unknown[] = []): Promise<QueryResult> {
      const upperSql = querySql.trim().toUpperCase();
      if (!upperSql.startsWith("SELECT") && !upperSql.startsWith("WITH")) {
        throw new Error("database.query only allows SELECT statements");
      }
      const rows = await sql.unsafe(querySql, params as never[]);
      const arr = rows as unknown as Record<string, unknown>[];
      const limited = arr.slice(0, maxRows);
      return { rows: limited, row_count: limited.length };
    },

    async execute(execSql: string, params: unknown[] = []): Promise<ExecuteResult> {
      const upperSql = execSql.trim().toUpperCase();
      if (
        !config.allow_ddl &&
        (upperSql.startsWith("CREATE") ||
          upperSql.startsWith("ALTER") ||
          upperSql.startsWith("DROP") ||
          upperSql.startsWith("TRUNCATE"))
      ) {
        throw new Error("DDL statements are disabled. Set allow_ddl: true in config to enable.");
      }
      if (config.read_only) {
        throw new Error("Database is configured as read-only.");
      }
      const rows = await sql.unsafe(execSql, params as never[]);
      const arr = rows as unknown as Record<string, unknown>[];
      return {
        affected_rows: (rows as unknown as { count: number }).count ?? arr.length,
        returning: arr,
      };
    },

    async transaction(statements: TransactionStatement[]): Promise<TransactionResult> {
      const results: TransactionResult["results"] = [];
      let committed = false;
      try {
        await sql.begin(async (tx) => {
          for (const stmt of statements) {
            const upper = stmt.sql.trim().toUpperCase();
            if (upper.startsWith("SELECT") || upper.startsWith("WITH")) {
              const rows = await tx.unsafe(stmt.sql, (stmt.params ?? []) as never[]);
              const arr = rows as unknown as Record<string, unknown>[];
              results.push({ rows: arr.slice(0, maxRows), row_count: Math.min(arr.length, maxRows) });
            } else {
              const rows = await tx.unsafe(stmt.sql, (stmt.params ?? []) as never[]);
              const arr = rows as unknown as Record<string, unknown>[];
              results.push({
                affected_rows: (rows as unknown as { count: number }).count ?? arr.length,
                returning: arr,
              });
            }
          }
          committed = true;
        });
      } catch (err) {
        results.push({ error: err instanceof Error ? err.message : String(err) });
      }
      return { results, committed };
    },

    async close(): Promise<void> {
      await sql.end();
    },

    async isHealthy(): Promise<boolean> {
      try {
        await sql`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
  };

  return conn;
}

// ─── SQLite connection ──────────────────────────────────────────────────────────

/**
 * Convert $1, $2, ... positional params (PostgreSQL style) to ? (SQLite style).
 * The params array order is preserved.
 */
function convertToSqliteParams(sql: string): string {
  return sql.replace(/\$\d+/g, "?");
}

async function createSqliteConnection(
  config: DatabaseConfig
): Promise<DbConnection> {
  const { default: Database } = await import("better-sqlite3");

  const dbPath = config.url?.replace(/^file:/, "") ?? "./data.db";
  const db = new Database(dbPath);

  // Enable WAL mode for better performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const maxRows = config.max_rows;

  const conn: DbConnection = {
    async query(querySql: string, params: unknown[] = []): Promise<QueryResult> {
      const upperSql = querySql.trim().toUpperCase();
      if (!upperSql.startsWith("SELECT") && !upperSql.startsWith("WITH")) {
        throw new Error("database.query only allows SELECT statements");
      }
      const normalizedSql = convertToSqliteParams(querySql);
      const stmt = db.prepare(normalizedSql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      const limited = rows.slice(0, maxRows);
      return { rows: limited, row_count: limited.length };
    },

    async execute(execSql: string, params: unknown[] = []): Promise<ExecuteResult> {
      const upperSql = execSql.trim().toUpperCase();
      if (
        !config.allow_ddl &&
        (upperSql.startsWith("CREATE") ||
          upperSql.startsWith("ALTER") ||
          upperSql.startsWith("DROP") ||
          upperSql.startsWith("TRUNCATE"))
      ) {
        throw new Error("DDL statements are disabled. Set allow_ddl: true in config to enable.");
      }
      if (config.read_only) {
        throw new Error("Database is configured as read-only.");
      }
      const normalizedSql = convertToSqliteParams(execSql);
      const stmt = db.prepare(normalizedSql);
      const info = stmt.run(...params);
      // For RETURNING-style queries with SQLite, we re-query if needed
      const returning: Record<string, unknown>[] = [];
      // SQLite doesn't support RETURNING in all versions; best effort
      try {
        if (execSql.toUpperCase().includes("RETURNING")) {
          // Not supported in older SQLite; silently ignore
        }
      } catch {
        // ignore
      }
      return { affected_rows: info.changes, returning };
    },

    async transaction(statements: TransactionStatement[]): Promise<TransactionResult> {
      const results: TransactionResult["results"] = [];
      let committed = false;
      const txn = db.transaction(() => {
        for (const stmt of statements) {
          const upper = stmt.sql.trim().toUpperCase();
          const normalizedSql = convertToSqliteParams(stmt.sql);
          if (upper.startsWith("SELECT") || upper.startsWith("WITH")) {
            const prepared = db.prepare(normalizedSql);
            const rows = prepared.all(...(stmt.params ?? [])) as Record<string, unknown>[];
            results.push({ rows: rows.slice(0, maxRows), row_count: Math.min(rows.length, maxRows) });
          } else {
            const prepared = db.prepare(normalizedSql);
            const info = prepared.run(...(stmt.params ?? []));
            results.push({ affected_rows: info.changes, returning: [] });
          }
        }
        committed = true;
      });
      try {
        txn();
      } catch (err) {
        results.push({ error: err instanceof Error ? err.message : String(err) });
      }
      return { results, committed };
    },

    async close(): Promise<void> {
      db.close();
    },

    async isHealthy(): Promise<boolean> {
      try {
        db.prepare("SELECT 1").get();
        return true;
      } catch {
        return false;
      }
    },
  };

  return conn;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

let _connection: DbConnection | null = null;

export async function getConnection(
  config: DatabaseConfig,
  logger: Logger
): Promise<DbConnection> {
  if (_connection) return _connection;

  if (config.driver === "sqlite") {
    _connection = await createSqliteConnection(config);
    logger.info({ driver: "sqlite" }, "Database connected");
  } else if (config.driver === "postgres") {
    _connection = await createPostgresConnection(config, logger);
    logger.info({ driver: "postgres" }, "Database connected");
  } else {
    throw new Error(`Unsupported database driver: ${config.driver}`);
  }

  return _connection;
}

export async function closeConnection(): Promise<void> {
  if (_connection) {
    await _connection.close();
    _connection = null;
  }
}
