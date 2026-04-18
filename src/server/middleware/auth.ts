import { createMiddleware } from "hono/factory";
import jwt from "jsonwebtoken";
import type { AuthConfig } from "../../config/schema.js";

export type AuthContext = {
  authenticated: boolean;
  user_id?: string;
  role?: string;
  claims?: Record<string, unknown>;
};

/**
 * JWT / API key authentication middleware.
 * Populates c.get("auth") with the decoded auth context.
 * Does NOT reject requests — routes decide if auth is required.
 */
export function buildAuthMiddleware(config: AuthConfig) {
  return createMiddleware(async (c, next) => {
    const authCtx: AuthContext = { authenticated: false };

    // Try JWT Bearer token
    const authHeader = c.req.header("Authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      const secret = config.jwt.secret;
      if (secret && token) {
        try {
          const payload = jwt.verify(token, secret) as Record<string, unknown>;
          authCtx.authenticated = true;
          authCtx.user_id = payload["sub"] as string | undefined;
          authCtx.role = payload["role"] as string | undefined;
          authCtx.claims = payload;
        } catch {
          // Invalid token — leave as unauthenticated
        }
      }
    }

    // Try API key
    if (!authCtx.authenticated && config.api_keys.enabled) {
      const keyHeader = c.req.header(config.api_keys.header) ?? "";
      if (config.api_keys.keys.includes(keyHeader)) {
        authCtx.authenticated = true;
        authCtx.role = "service";
      }
    }

    c.set("auth", authCtx);
    await next();
  });
}
