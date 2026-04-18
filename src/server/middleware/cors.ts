import { createMiddleware } from "hono/factory";
import type { CorsConfig } from "./types.js";

export function buildCorsMiddleware(config: CorsConfig) {
  return createMiddleware(async (c, next) => {
    const origin = c.req.header("Origin") ?? "";
    const allowedOrigins = config.allowed_origins ?? ["*"];

    let allowOrigin = "";
    if (allowedOrigins.includes("*")) {
      allowOrigin = "*";
    } else if (allowedOrigins.includes(origin)) {
      allowOrigin = origin;
    }

    if (allowOrigin) {
      c.header("Access-Control-Allow-Origin", allowOrigin);
    }
    c.header(
      "Access-Control-Allow-Methods",
      (config.allowed_methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).join(", ")
    );
    c.header(
      "Access-Control-Allow-Headers",
      (config.allowed_headers ?? ["Authorization", "Content-Type"]).join(", ")
    );
    c.header(
      "Access-Control-Expose-Headers",
      (config.expose_headers ?? [
        "X-Request-Id",
        "X-Execution-Mode",
        "X-Token-Usage-Input",
        "X-Token-Usage-Output",
        "X-Duration-Ms",
      ]).join(", ")
    );
    c.header("Access-Control-Max-Age", String(config.max_age ?? 86400));

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  });
}
