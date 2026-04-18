import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { projectRoutes } from "./routes/projects.js";
import { runtimeRoutes } from "./routes/runtime.js";
import { creationRoutes } from "./routes/creation.js";
import { stopAllProjects } from "./services/process-manager.js";
import path from "path";
import fs from "fs";

const app = new Hono();

// Middleware
app.use("*", cors({
  origin: ["http://localhost:5173", "http://localhost:3100"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));
app.use("*", logger());

// API routes
app.route("/api/projects", projectRoutes);
app.route("/api/runtime", runtimeRoutes);
app.route("/api/creation", creationRoutes);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok" }));

// Serve static files in production (built Vite output)
const staticDir = path.resolve(import.meta.dirname, "../dist/ui");
if (fs.existsSync(staticDir)) {
  app.use("/*", serveStatic({ root: "./dist/ui" }));
  // SPA fallback
  app.get("*", async (c) => {
    const indexPath = path.join(staticDir, "index.html");
    const html = fs.readFileSync(indexPath, "utf-8");
    return c.html(html);
  });
}

const PORT = 3100;

console.log(`Agentic Service Management Server starting on port ${PORT}`);

const server = serve({
  fetch: app.fetch,
  port: PORT,
});

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    console.log(`\n${signal} received. Shutting down...`);
    await stopAllProjects();
    server.close();
    process.exit(0);
  });
}

console.log(`Management UI: http://localhost:${PORT}`);
console.log(`Management API: http://localhost:${PORT}/api`);
