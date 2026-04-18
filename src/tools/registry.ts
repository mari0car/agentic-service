import type { DbConnection } from "../db/connection.js";
import type { Logger } from "pino";
import type { Config } from "../config/schema.js";
import type { RequestContext } from "../agent/prompt-assembler.js";
import type { AgentResponse } from "../agent/response-parser.js";
import { z } from "zod";

// ─── Tool definition types (Vercel AI SDK compatible) ─────────────────────────

export type ToolDefinition = {
  description: string;
  parameters: z.ZodTypeAny;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
};

export type ToolRegistry = {
  tools: Record<string, ToolDefinition>;
  list(): { name: string; description: string }[];
};

// ─── Route handler types (static / compiled tool-registry bypass) ─────────────
//
// A RouteHandler is a hand-authored (or JIT-compiled) TypeScript function that
// handles a specific route entirely in code, bypassing the LLM. It receives the
// same RequestContext and ToolRegistry the agent would receive, so it can call
// database, crypto, time, and validate tools directly.
//
// RouteHandlerRegistry maps a handler key (declared in spec frontmatter as
// `tool_handler: <key>`) to its implementation. The key is arbitrary but
// conventionally mirrors the spec path, e.g. "projects/get" or "tasks/list".
//
// This is the precursor to the JIT hot-path system (docs/specs/09-hot-path.md).
// JIT-generated plans will implement the same RouteHandler interface.

export type RouteHandler = {
  /** Human-readable description — shown in /admin/tool-registry. */
  description?: string;
  execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse>;
};

/** key → handler, e.g. "projects/get" → { execute: ... } */
export type RouteHandlerRegistry = Map<string, RouteHandler>;

// ─── Response state (mutable per request) ─────────────────────────────────────

export type ResponseState = {
  headers: Record<string, string>;
  cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>;
};

export function createResponseState(): ResponseState {
  return { headers: {}, cookies: [] };
}

// ─── Build the tool registry ──────────────────────────────────────────────────

export function buildToolRegistry(
  config: Config,
  db: DbConnection,
  logger: Logger,
  responseState: ResponseState
): ToolRegistry {
  // Import tool factories
  const tools: Record<string, ToolDefinition> = {};

  // --- database ---
  const { databaseQueryTool, databaseExecuteTool, databaseTransactionTool } =
    createDatabaseTools(db, config);
  tools["database_query"] = databaseQueryTool;
  tools["database_execute"] = databaseExecuteTool;
  tools["database_transaction"] = databaseTransactionTool;

  // --- crypto ---
  const cryptoTools = createCryptoTools(config);
  for (const [name, tool] of Object.entries(cryptoTools)) {
    tools[name] = tool;
  }

  // --- time ---
  const timeTools = createTimeTools();
  for (const [name, tool] of Object.entries(timeTools)) {
    tools[name] = tool;
  }

  // --- validate ---
  const validateTools = createValidateTools();
  for (const [name, tool] of Object.entries(validateTools)) {
    tools[name] = tool;
  }

  // --- log ---
  tools["log_write"] = createLogTool(logger);

  // --- response ---
  const responseTools = createResponseTools(responseState);
  for (const [name, tool] of Object.entries(responseTools)) {
    tools[name] = tool;
  }

  return {
    tools,
    list() {
      return Object.entries(tools).map(([name, t]) => ({
        name,
        description: t.description,
      }));
    },
  };
}

// ─── Database tools ───────────────────────────────────────────────────────────

function createDatabaseTools(db: DbConnection, config: Config) {
  const databaseQueryTool: ToolDefinition = {
    description:
      "Execute a read-only SQL SELECT query and return rows. Only SELECT and WITH statements are allowed.",
    parameters: z.object({
      sql: z.string().describe("SQL SELECT statement with $1, $2, ... placeholders"),
      params: z
        .array(z.unknown())
        .optional()
        .describe("Positional parameter values"),
    }),
    async execute({ sql, params }) {
      return db.query(sql as string, params as unknown[] | undefined);
    },
  };

  const databaseExecuteTool: ToolDefinition = {
    description:
      "Execute a write SQL statement (INSERT, UPDATE, DELETE) and return affected rows. Use $1, $2, ... placeholders.",
    parameters: z.object({
      sql: z.string().describe("SQL INSERT/UPDATE/DELETE statement with placeholders"),
      params: z
        .array(z.unknown())
        .optional()
        .describe("Positional parameter values"),
    }),
    async execute({ sql, params }) {
      return db.execute(sql as string, params as unknown[] | undefined);
    },
  };

  const databaseTransactionTool: ToolDefinition = {
    description:
      "Execute multiple SQL statements as an atomic transaction. If any statement fails, all are rolled back.",
    parameters: z.object({
      statements: z.array(
        z.object({
          sql: z.string().describe("SQL statement"),
          params: z.array(z.unknown()).optional(),
        })
      ),
    }),
    async execute({ statements }) {
      return db.transaction(
        statements as Array<{ sql: string; params?: unknown[] }>
      );
    },
  };

  void config; // used for future config-based limits
  return { databaseQueryTool, databaseExecuteTool, databaseTransactionTool };
}

// ─── Crypto tools ─────────────────────────────────────────────────────────────

function createCryptoTools(config: Config) {
  const tools: Record<string, ToolDefinition> = {};

  tools["crypto_hash"] = {
    description: "Generate a hash of input data using sha256, sha512, or md5.",
    parameters: z.object({
      algorithm: z.enum(["sha256", "sha512", "md5"]),
      data: z.string(),
    }),
    async execute({ algorithm, data }) {
      const { createHash } = await import("node:crypto");
      const hash = createHash(algorithm as string).update(data as string).digest("hex");
      return { hash };
    },
  };

  tools["crypto_hash_password"] = {
    description: "Hash a password using bcrypt for secure storage.",
    parameters: z.object({
      password: z.string(),
      rounds: z.number().optional().default(10),
    }),
    async execute({ password, rounds }) {
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash(password as string, (rounds as number) ?? 10);
      return { hash };
    },
  };

  tools["crypto_verify_password"] = {
    description: "Verify a plain text password against a bcrypt hash.",
    parameters: z.object({
      password: z.string(),
      hash: z.string(),
    }),
    async execute({ password, hash }) {
      const bcrypt = await import("bcryptjs");
      const valid = await bcrypt.compare(password as string, hash as string);
      return { valid };
    },
  };

  tools["crypto_generate_token"] = {
    description: "Generate a random token: UUID, hex string, or base64 string.",
    parameters: z.object({
      type: z.enum(["uuid", "hex", "base64"]),
      length: z.number().optional().default(32),
    }),
    async execute({ type, length }) {
      const { randomBytes, randomUUID } = await import("node:crypto");
      if (type === "uuid") {
        return { token: randomUUID() };
      }
      const bytes = randomBytes((length as number) ?? 32);
      return {
        token: type === "hex" ? bytes.toString("hex") : bytes.toString("base64"),
      };
    },
  };

  tools["crypto_jwt_sign"] = {
    description: "Create a signed JWT token with the given payload.",
    parameters: z.object({
      payload: z.record(z.unknown()),
      expires_in_seconds: z.number().optional(),
    }),
    async execute({ payload, expires_in_seconds }) {
      const jwt = await import("jsonwebtoken");
      const secret = config.auth.jwt.secret;
      if (!secret) throw new Error("JWT secret not configured");
      const jwtPayload = payload as Record<string, unknown>;
      let token: string;
      if (expires_in_seconds) {
        token = jwt.default.sign(jwtPayload, secret, {
          expiresIn: expires_in_seconds as number,
        });
      } else {
        token = jwt.default.sign(jwtPayload, secret);
      }
      return { token };
    },
  };

  tools["crypto_jwt_verify"] = {
    description: "Verify and decode a JWT token. Returns valid=false if invalid or expired.",
    parameters: z.object({
      token: z.string(),
    }),
    async execute({ token }) {
      const jwt = await import("jsonwebtoken");
      const secret = config.auth.jwt.secret;
      if (!secret) throw new Error("JWT secret not configured");
      try {
        const payload = jwt.default.verify(token as string, secret);
        return { valid: true, payload, error: null };
      } catch (err) {
        return {
          valid: false,
          payload: null,
          error: err instanceof Error ? err.message : "Invalid token",
        };
      }
    },
  };

  return tools;
}

// ─── Time tools ───────────────────────────────────────────────────────────────

function createTimeTools(): Record<string, ToolDefinition> {
  return {
    time_now: {
      description: "Get the current timestamp in ISO 8601 format, Unix seconds, and Unix milliseconds.",
      parameters: z.object({
        timezone: z.string().optional().default("UTC"),
      }),
      async execute({ timezone }) {
        const now = new Date();
        const tz = (timezone as string) ?? "UTC";
        const iso = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          fractionalSecondDigits: 3,
        }).format(now);
        return {
          iso: now.toISOString(),
          unix: Math.floor(now.getTime() / 1000),
          unix_ms: now.getTime(),
          formatted: iso,
        };
      },
    },

    time_parse: {
      description: "Parse a date/time string and return ISO, Unix timestamps.",
      parameters: z.object({
        input: z.string(),
        format: z.string().optional(),
      }),
      async execute({ input }) {
        const d = new Date(input as string);
        const valid = !isNaN(d.getTime());
        return {
          iso: valid ? d.toISOString() : null,
          unix: valid ? Math.floor(d.getTime() / 1000) : null,
          valid,
        };
      },
    },

    time_format: {
      description: "Format a Unix timestamp into a human-readable string.",
      parameters: z.object({
        unix: z.number(),
        format: z.string().optional().default("ISO"),
        timezone: z.string().optional().default("UTC"),
      }),
      async execute({ unix, format, timezone }) {
        const d = new Date((unix as number) * 1000);
        const tz = (timezone as string) ?? "UTC";
        let formatted: string;
        if (!format || format === "ISO") {
          formatted = d.toISOString();
        } else if (format === "RFC3339") {
          formatted = d.toISOString().replace("T", " ").replace("Z", "+00:00");
        } else {
          // Simple date format: YYYY-MM-DD
          formatted = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
            .format(d)
            .replace(/\//g, "-");
        }
        return { formatted };
      },
    },
  };
}

// ─── Validate tools ───────────────────────────────────────────────────────────

function createValidateTools(): Record<string, ToolDefinition> {
  return {
    validate_json_schema: {
      description: "Validate a JSON object against a JSON Schema. Returns valid=true/false with error details.",
      parameters: z.object({
        data: z.unknown(),
        schema: z.record(z.unknown()),
      }),
      async execute({ data, schema }) {
        const { default: Ajv } = await import("ajv");
        const ajv = new Ajv({ allErrors: true });
        const validate = ajv.compile(schema as Record<string, unknown>);
        const valid = validate(data);
        const errors = validate.errors?.map((e) => ({
          path: e.instancePath || "/",
          message: e.message ?? "validation error",
        })) ?? [];
        return { valid, errors };
      },
    },

    validate_email: {
      description: "Check if a string is a valid email address format.",
      parameters: z.object({
        email: z.string(),
      }),
      async execute({ email }) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return { valid: re.test(email as string) };
      },
    },

    validate_uuid: {
      description: "Check if a string is a valid UUID and return its version.",
      parameters: z.object({
        value: z.string(),
      }),
      async execute({ value }) {
        const re =
          /^[0-9a-f]{8}-[0-9a-f]{4}-([1-5])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const match = re.exec(value as string);
        if (!match) return { valid: false, version: null };
        return { valid: true, version: parseInt(match[1]!) };
      },
    },
  };
}

// ─── Log tool ─────────────────────────────────────────────────────────────────

function createLogTool(logger: Logger): ToolDefinition {
  return {
    description: "Write a structured log entry at the specified level.",
    parameters: z.object({
      level: z.enum(["debug", "info", "warn", "error"]),
      message: z.string(),
      data: z.record(z.unknown()).optional(),
    }),
    async execute({ level, message, data }) {
      const logFn = logger[level as keyof Logger] as (obj: unknown, msg: string) => void;
      if (typeof logFn === "function") {
        logFn.call(logger, data ?? {}, message as string);
      }
      return { logged: true };
    },
  };
}

// ─── Response tools ───────────────────────────────────────────────────────────

function createResponseTools(
  state: ResponseState
): Record<string, ToolDefinition> {
  return {
    response_set_header: {
      description: "Set a custom HTTP response header.",
      parameters: z.object({
        name: z.string(),
        value: z.string(),
      }),
      async execute({ name, value }) {
        state.headers[name as string] = value as string;
        return { set: true };
      },
    },

    response_set_cookie: {
      description: "Set a response cookie.",
      parameters: z.object({
        name: z.string(),
        value: z.string(),
        max_age: z.number().optional(),
        path: z.string().optional(),
        domain: z.string().optional(),
        secure: z.boolean().optional(),
        http_only: z.boolean().optional(),
        same_site: z.enum(["strict", "lax", "none"]).optional(),
      }),
      async execute(params) {
        const { name, value, ...options } = params;
        state.cookies.push({
          name: name as string,
          value: value as string,
          options: options as Record<string, unknown>,
        });
        return { set: true };
      },
    },
  };
}
