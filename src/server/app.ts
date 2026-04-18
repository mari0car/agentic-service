import { Hono } from "hono";
import type { Config } from "../config/schema.js";
import type { DbConnection } from "../db/connection.js";
import type { SpecStore } from "../specs/store.js";
import type { Logger } from "pino";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { buildCorsMiddleware } from "./middleware/cors.js";
import { buildAuthMiddleware, type AuthContext } from "./middleware/auth.js";
import {
  buildToolRegistry,
  createResponseState,
  type RouteHandlerRegistry,
} from "../tools/registry.js";
import { executeAgent, executeHandler } from "../agent/executor.js";
import type { RequestContext } from "../agent/prompt-assembler.js";

// Augment Hono context
declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    auth: AuthContext;
  }
}

export function createApp(
  config: Config,
  db: DbConnection,
  specStore: SpecStore,
  logger: Logger,
  /** Optional registry of hand-authored route handlers. When a matched spec
   *  declares `tool_handler: <key>` in its frontmatter and a matching handler
   *  exists in this registry, the handler runs instead of the LLM. */
  handlerRegistry?: RouteHandlerRegistry,
  /** Optional map of handler keys that failed to load at startup, for diagnostics.
   *  Populated by `loadHandlersSafe`; exposed via GET /admin/tool-registry. */
  handlerFailures?: Map<string, string>
): Hono {
  const app = new Hono();
  const registry = handlerRegistry ?? new Map();
  const failures = handlerFailures ?? new Map();

  // ── Global middleware ──────────────────────────────────────────────────────
  app.use("*", requestIdMiddleware);

  if (config.server.cors.enabled) {
    app.use("*", buildCorsMiddleware(config.server.cors));
  }

  app.use("*", buildAuthMiddleware(config.auth));

  // ── Admin / health endpoints ───────────────────────────────────────────────
  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.get("/readyz", async (c) => {
    const checks: Record<string, string> = {};

    // Database check
    try {
      const healthy = await db.isHealthy();
      checks["database"] = healthy ? "ok" : "error";
    } catch {
      checks["database"] = "error";
    }

    // Specs check
    const routes = specStore.getRoutes();
    checks["specs"] = routes.length > 0 ? "ok" : "warn";

    // LLM check — we don't call the LLM here to avoid cost; just report configured
    checks["llm"] =
      config.llm.provider === "bedrock"
        ? "configured"
        : config.llm.api_key
          ? "configured"
          : "not_configured";

    const allOk = Object.values(checks).every((v) => v === "ok" || v === "configured" || v === "warn");
    const status = allOk ? 200 : 503;

    return c.json(
      { status: allOk ? "ready" : "not_ready", checks },
      status
    );
  });

  app.get("/admin/specs", (c) => {
    const routes = specStore.getRoutes();
    const specs = specStore.getAllSpecs().map((s) => ({
      path: s.relativePath,
      has_frontmatter: Object.keys(s.frontmatter).length > 0,
    }));
    return c.json({ specs, routes });
  });

  app.post("/admin/reload", (c) => {
    specStore.reload();
    const routes = specStore.getRoutes();
    return c.json({ reloaded: true, route_count: routes.length });
  });

  app.get("/admin/tools", (_c) => {
    // Build a temporary registry just to list tools
    const tempState = createResponseState();
    const toolReg = buildToolRegistry(config, db, logger, tempState);
    return _c.json({ tools: toolReg.list() });
  });

  // ── Admin: tool-registry handler listing ──────────────────────────────────
  app.get("/admin/tool-registry", (c) => {
    const handlers = Array.from(registry.entries()).map(([key, h]) => ({
      key,
      description: h.description ?? null,
      status: "loaded" as const,
    }));
    const failedHandlers = Array.from(failures.entries()).map(([key, error]) => ({
      key,
      error,
      status: "failed" as const,
    }));
    return c.json({
      handler_count: handlers.length,
      failed_handler_count: failedHandlers.length,
      shadow_mode: config.tool_registry.shadow_mode,
      shadow_sample_rate: config.tool_registry.shadow_sample_rate,
      handlers,
      failed_handlers: failedHandlers,
    });
  });

  // ── Agent handler — all /api/* routes ─────────────────────────────────────
  app.all("*", async (c) => {
    const method = c.req.method;
    const urlPath = new URL(c.req.url).pathname;
    const requestId = c.get("requestId");
    const auth = c.get("auth");

    // Route lookup
    const match = specStore.getRoute(method, urlPath);
    if (!match) {
      return c.json(
        {
          error: {
            code: "not_found",
            message: `No route defined for ${method} ${urlPath}`,
          },
        },
        404
      );
    }

    const { spec: routeSpec, params: pathParams } = match;

    // Build request context
    const queryParams: Record<string, string> = {};
    for (const [k, v] of new URL(c.req.url).searchParams.entries()) {
      queryParams[k] = v;
    }

    let body: unknown = null;
    const contentType = c.req.header("Content-Type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        body = await c.req.json();
      } catch {
        body = null;
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.formData().catch(() => new FormData());
      body = Object.fromEntries(formData.entries());
    }

    // Filter headers to relevant subset
    const filteredHeaders: Record<string, string> = {
      "content-type": c.req.header("Content-Type") ?? "",
      "x-request-id": requestId,
    };
    const acceptHeader = c.req.header("Accept");
    if (acceptHeader) filteredHeaders["accept"] = acceptHeader;

    const requestContext: RequestContext = {
      method,
      path: urlPath,
      path_params: pathParams,
      query_params: queryParams,
      headers: filteredHeaders,
      body,
      auth: {
        authenticated: auth.authenticated,
        user_id: auth.user_id,
        role: auth.role,
        claims: auth.claims,
      },
      request_id: requestId,
    };

    const globalSpecs = specStore.getGlobalSpecs();

    // ── Decide: use a route handler or the LLM? ───────────────────────────
    const handlerKey = routeSpec.frontmatter["tool_handler"] as string | undefined;
    const handler = handlerKey ? registry.get(handlerKey) : undefined;

    const responseState = createResponseState();
    const toolRegistry = buildToolRegistry(config, db, logger, responseState);

    if (handler) {
      // ── Hot path: hand-authored handler ───────────────────────────────────
      const shadowEnabled = config.tool_registry.shadow_mode &&
        Math.random() < config.tool_registry.shadow_sample_rate;

      logger.info(
        { method, path: urlPath, requestId, handlerKey, shadow: shadowEnabled },
        "Handler invocation started"
      );

      let result;

      if (shadowEnabled) {
        // Run handler and LLM in parallel; return handler result immediately
        const [handlerResult, llmResult] = await Promise.all([
          executeHandler(handler, requestContext, toolRegistry, responseState, logger.child({ requestId })),
          executeAgent(config, routeSpec, globalSpecs, requestContext, toolRegistry, createResponseState(), logger.child({ requestId, shadow: true })),
        ]);

        // Compare: status and body must match for divergence detection
        const handlerBody = JSON.stringify(handlerResult.response.body);
        const llmBody = JSON.stringify(llmResult.response.body);
        const diverged =
          handlerResult.response.status !== llmResult.response.status ||
          handlerBody !== llmBody;

        if (diverged && config.tool_registry.shadow_log_divergences) {
          logger.warn(
            {
              method,
              path: urlPath,
              requestId,
              handlerKey,
              handler: { status: handlerResult.response.status, body: handlerResult.response.body },
              llm: { status: llmResult.response.status, body: llmResult.response.body },
            },
            "Shadow divergence detected: handler and LLM produced different results"
          );
        } else if (!diverged) {
          logger.debug({ method, path: urlPath, requestId, handlerKey }, "Shadow verification passed");
        }

        result = handlerResult;
      } else {
        result = await executeHandler(
          handler,
          requestContext,
          toolRegistry,
          responseState,
          logger.child({ requestId })
        );
      }

      logger.info(
        {
          method,
          path: urlPath,
          requestId,
          handlerKey,
          status: result.response.status,
          durationMs: result.durationMs,
        },
        "Handler invocation complete"
      );

      return buildHonoResponse(c, result, "handler");
    }

    // ── Cold path: LLM agent ──────────────────────────────────────────────
    logger.info(
      {
        method,
        path: urlPath,
        requestId,
        spec: routeSpec.relativePath,
        userId: auth.user_id,
      },
      "Agent invocation started"
    );

    const result = await executeAgent(
      config,
      routeSpec,
      globalSpecs,
      requestContext,
      toolRegistry,
      responseState,
      logger.child({ requestId })
    );

    logger.info(
      {
        method,
        path: urlPath,
        requestId,
        status: result.response.status,
        durationMs: result.durationMs,
        toolCalls: result.toolCallCount,
        tokens: result.tokenUsage,
      },
      "Agent invocation complete"
    );

    return buildHonoResponse(c, result, "llm");
  });

  return app;
}

// ─── Shared response builder ─────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildHonoResponse(c: any, result: Awaited<ReturnType<typeof executeHandler>>, mode: "handler" | "llm" = "llm") {
  const response = c.json(
    result.response.body,
    result.response.status as Parameters<typeof c.json>[1]
  );

  // Execution metadata headers (consumed by management UI test panel)
  response.headers.set("X-Execution-Mode", mode);
  response.headers.set("X-Token-Usage-Input", String(result.tokenUsage.input));
  response.headers.set("X-Token-Usage-Output", String(result.tokenUsage.output));
  response.headers.set("X-Duration-Ms", String(result.durationMs));

  // Apply extra headers
  for (const [name, value] of Object.entries(result.response.headers)) {
    response.headers.set(name, value);
  }

  // Apply cookies
  for (const cookie of result.responseState.cookies) {
    const parts = [`${cookie.name}=${encodeURIComponent(cookie.value)}`];
    const opts = cookie.options as Record<string, unknown>;
    if (opts["path"]) parts.push(`Path=${opts["path"]}`);
    if (opts["domain"]) parts.push(`Domain=${opts["domain"]}`);
    if (opts["max_age"]) parts.push(`Max-Age=${opts["max_age"]}`);
    if (opts["http_only"]) parts.push("HttpOnly");
    if (opts["secure"]) parts.push("Secure");
    if (opts["same_site"]) parts.push(`SameSite=${opts["same_site"]}`);
    response.headers.append("Set-Cookie", parts.join("; "));
  }

  return response;
}
