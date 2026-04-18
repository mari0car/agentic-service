import { createMiddleware } from "hono/factory";
import { randomUUID } from "node:crypto";

export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const requestId = (c.req.header("X-Request-Id") as string | undefined) ?? randomUUID();
  c.set("requestId", requestId);
  await next();
  c.header("X-Request-Id", requestId);
});
