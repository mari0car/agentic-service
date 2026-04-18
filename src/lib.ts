/**
 * Agentic Service — Library API
 *
 * Import from this module to use Agentic Service as a library in your own
 * entry point. This lets you mount a RouteHandlerRegistry alongside the
 * standard LLM-backed agent without using the CLI binary.
 *
 * @example
 * ```ts
 * import { loadConfig, getConnection, createSpecStore, createApp } from "agentic-service/lib";
 * import { serve } from "@hono/node-server";
 * import { registry } from "./tool-registry.js";
 * import pino from "pino";
 *
 * const config = loadConfig("./config.yaml");
 * const logger = pino({ level: config.logging.level });
 * const db = await getConnection(config.database, logger);
 * const specStore = createSpecStore(config.specs, logger);
 * const app = createApp(config, db, specStore, logger, registry);
 * serve({ fetch: app.fetch, port: config.server.port });
 * ```
 */

export { loadConfig } from "./config/loader.js";
export { getConnection } from "./db/connection.js";
export { migrateUp, migrateDown, getMigrationStatus } from "./db/migrator.js";
export { createSpecStore } from "./specs/store.js";
export { createApp } from "./server/app.js";
export { buildToolRegistry, createResponseState } from "./tools/registry.js";
export { loadHandlerSafe, loadHandlersSafe } from "./tools/handler-loader.js";
export { executeAgent, executeHandler } from "./agent/executor.js";

// ── Types ──────────────────────────────────────────────────────────────────────
export type { Config, ToolRegistryConfig } from "./config/schema.js";
export type {
  ToolDefinition,
  ToolRegistry,
  ResponseState,
  RouteHandler,
  RouteHandlerRegistry,
} from "./tools/registry.js";
export type { RequestContext } from "./agent/prompt-assembler.js";
export type { AgentResponse } from "./agent/response-parser.js";
export type { AgentExecutionResult } from "./agent/executor.js";
export type { SpecFile, SpecStore } from "./specs/store.js";
export type { DbConnection } from "./db/connection.js";
export type { HandlerEntry, HandlerDeclaration } from "./tools/handler-loader.js";
