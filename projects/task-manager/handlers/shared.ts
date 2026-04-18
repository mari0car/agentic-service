/**
 * Shared helpers used across all task-manager route handlers.
 */

import type { ToolRegistry } from "../../../src/tools/registry.js";
import type { AgentResponse } from "../../../src/agent/response-parser.js";

/** Standard 401 Unauthorized response */
export function unauthorized(): AgentResponse {
  return {
    status: 401,
    headers: {},
    body: { error: { code: "unauthorized", message: "Authentication required" } },
  };
}

/** Standard 403 Forbidden response */
export function forbidden(): AgentResponse {
  return {
    status: 403,
    headers: {},
    body: { error: { code: "forbidden", message: "Not authorized" } },
  };
}

/** Standard 404 Not Found response */
export function notFound(message = "Not found"): AgentResponse {
  return {
    status: 404,
    headers: {},
    body: { error: { code: "not_found", message } },
  };
}

/** Standard 400 Bad Request response */
export function badRequest(message: string, field?: string): AgentResponse {
  return {
    status: 400,
    headers: {},
    body: {
      error: {
        code: "validation_error",
        message,
        ...(field ? { field } : {}),
      },
    },
  };
}

/**
 * Execute a database SELECT query via the tool registry.
 * Returns the raw result from database_query.
 */
export async function dbQuery(
  tools: ToolRegistry,
  sql: string,
  params?: unknown[]
): Promise<{ rows: Record<string, unknown>[]; row_count: number }> {
  const result = await tools.tools["database_query"]!.execute({ sql, params });
  return result as { rows: Record<string, unknown>[]; row_count: number };
}

/**
 * Parse a positive integer from a query param string.
 * Returns defaultValue if absent, null if invalid.
 */
export function parsePositiveInt(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number
): number | null {
  if (value === undefined || value === "") return defaultValue;
  const n = parseInt(value, 10);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}
