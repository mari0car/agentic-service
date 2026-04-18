/**
 * Task Manager — Handler Registry Builder
 *
 * Each handler lives in its own file under ./handlers/. They are loaded via
 * dynamic import() calls wrapped in `loadHandlersSafe`, so a syntax error or
 * missing export in one file only removes that handler from the registry —
 * the others still load and the service starts normally. The broken route falls
 * back to the LLM agent at request time.
 *
 * Usage (from index.ts):
 *   const { registry, failures } = await buildRegistry(logger);
 *
 * Covered routes:
 *   GET  /api/projects                         → projects/list
 *   GET  /api/projects/:id                     → projects/get
 *   GET  /api/projects/:project_id/tasks       → tasks/list
 *   GET  /api/projects/:project_id/tasks/:id   → tasks/get
 *   POST /api/projects/:project_id/tasks       → tasks/create
 *   POST /api/auth/login                       → auth/login
 */

import type { Logger } from "pino";
import { loadHandlersSafe } from "../../src/tools/handler-loader.js";
import type { RouteHandlerRegistry } from "../../src/tools/registry.js";

export type RegistryBuildResult = {
  /** Successfully loaded handlers, ready to pass to createApp(). */
  registry: RouteHandlerRegistry;
  /** Keys that failed to load, mapped to their error messages (for diagnostics). */
  failures: Map<string, string>;
};

/**
 * Asynchronously load all route handlers.
 *
 * Each handler is imported in isolation — a failure in one does not affect the
 * others. Failures are logged at startup and exposed via /admin/tool-registry.
 */
export async function buildRegistry(logger: Logger): Promise<RegistryBuildResult> {
  return loadHandlersSafe(
    [
      { key: "projects/list", load: () => import("./handlers/projects-list.js") },
      { key: "projects/get",  load: () => import("./handlers/projects-get.js") },
      { key: "tasks/list",    load: () => import("./handlers/tasks-list.js") },
      { key: "tasks/get",     load: () => import("./handlers/tasks-get.js") },
      { key: "tasks/create",  load: () => import("./handlers/tasks-create.js") },
      { key: "auth/login",    load: () => import("./handlers/auth-login.js") },
    ],
    logger
  );
}
