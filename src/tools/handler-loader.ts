/**
 * Safe handler loader — isolates per-file import errors from the rest of the registry.
 *
 * Usage:
 *   const entry = await loadHandlerSafe(
 *     "projects/list",
 *     () => import("./handlers/projects-list.js"),
 *     logger
 *   );
 *   if (entry) registry.set(entry[0], entry[1]);
 *
 * If the dynamic import throws (e.g. syntax error, missing module, bad export),
 * the error is logged at `error` level and `null` is returned. Every other handler
 * continues to load normally. The broken route falls back to the LLM agent at
 * request time, just as if no handler had been registered for it.
 *
 * The `loadHandlersSafe` helper loads all entries in parallel and returns both the
 * populated registry and a map of keys that failed to load (for diagnostics).
 */

import type { Logger } from "pino";
import type { RouteHandler, RouteHandlerRegistry } from "./registry.js";

/** A single handler entry: [registryKey, handler] */
export type HandlerEntry = [key: string, handler: RouteHandler];

/** A handler load declaration: key + a function that returns a dynamic import */
export type HandlerDeclaration = {
  key: string;
  /** Must be a function wrapping a dynamic import so that errors are deferred. */
  load: () => Promise<{ default: RouteHandler }>;
};

/**
 * Attempt to load a single handler via a dynamic import.
 *
 * @param key   The registry key (e.g. "projects/list").
 * @param load  A zero-argument function that calls `import(...)`.
 *              Must be a wrapper so that the import is evaluated lazily inside the
 *              try/catch — passing `import(...)` directly would evaluate eagerly.
 * @param logger Pino logger instance.
 * @returns The handler entry on success, or `null` on any import/parse error.
 */
export async function loadHandlerSafe(
  key: string,
  load: () => Promise<{ default: RouteHandler }>,
  logger: Logger
): Promise<HandlerEntry | null> {
  try {
    const mod = await load();
    if (!mod.default || typeof mod.default.execute !== "function") {
      logger.error(
        { key },
        "Handler module loaded but does not export a valid RouteHandler as default — route will fall back to LLM"
      );
      return null;
    }
    return [key, mod.default];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { key, err: message },
      "Failed to load handler module — route will fall back to LLM"
    );
    return null;
  }
}

/**
 * Load all declared handlers concurrently, collecting failures without crashing.
 *
 * @param declarations  Array of { key, load } pairs.
 * @param logger        Pino logger instance.
 * @returns An object with:
 *   - `registry`: a `Map<string, RouteHandler>` containing every successfully loaded handler
 *   - `failures`: a `Map<string, string>` mapping failed keys to their error messages
 */
export async function loadHandlersSafe(
  declarations: HandlerDeclaration[],
  logger: Logger
): Promise<{ registry: RouteHandlerRegistry; failures: Map<string, string> }> {
  const results = await Promise.allSettled(
    declarations.map(({ key, load }) => loadHandlerSafe(key, load, logger))
  );

  const registry: RouteHandlerRegistry = new Map();
  const failures = new Map<string, string>();

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const key = declarations[i]!.key;

    if (result.status === "rejected") {
      // loadHandlerSafe itself never rejects, but guard defensively
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.set(key, message);
    } else if (result.value === null) {
      // Already logged inside loadHandlerSafe; record the failure for diagnostics
      failures.set(key, "Import failed — see startup logs for details");
    } else {
      registry.set(result.value[0], result.value[1]);
    }
  }

  if (failures.size > 0) {
    logger.warn(
      { failedKeys: Array.from(failures.keys()) },
      `${failures.size} handler(s) failed to load and will fall back to the LLM`
    );
  }

  return { registry, failures };
}
