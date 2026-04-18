import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { SpecsConfig } from "../config/schema.js";
import type { Logger } from "pino";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SpecFile = {
  relativePath: string;   // e.g. "orders/create-order.md"
  content: string;        // Full markdown content (without frontmatter)
  frontmatter: Record<string, unknown>;
};

export type RouteEntry = {
  method: string;         // "GET", "POST", etc.
  pattern: string;        // "/api/orders/:id"
  specPath: string;       // "orders/get-order.md"
};

export type SpecStore = {
  getSpec(relativePath: string): SpecFile | undefined;
  getRoute(method: string, path: string): { spec: SpecFile; params: Record<string, string> } | null;
  getGlobalSpecs(): SpecFile[];
  getRoutes(): RouteEntry[];
  getAllSpecs(): SpecFile[];
  reload(): void;
};

// ─── Route parser ─────────────────────────────────────────────────────────────

/**
 * Parse api-routes.md into a list of RouteEntry objects.
 *
 * Supports two formats:
 *   - `METHOD /path → spec-file.md`         (arrow style)
 *   - `- \`METHOD /path\` -> spec-file.md`   (list with backticks)
 */
function parseRoutesFile(content: string): RouteEntry[] {
  const routes: RouteEntry[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Match: `GET /api/foo` -> bar.md  OR  GET /api/foo → bar.md
    const backtickMatch = line.match(
      /[`*]?(GET|POST|PUT|PATCH|DELETE|HEAD)\s+([^\s`*]+)[`*]?\s*(?:->|→)\s*(.+\.md)/i
    );
    if (backtickMatch) {
      routes.push({
        method: backtickMatch[1]!.toUpperCase(),
        pattern: backtickMatch[2]!,
        specPath: backtickMatch[3]!.trim(),
      });
    }
  }

  return routes;
}

// ─── URL matcher ─────────────────────────────────────────────────────────────

function matchRoute(
  pattern: string,
  urlPath: string
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const urlParts = urlPath.split("?")[0]!.split("/").filter(Boolean);

  if (patternParts.length !== urlParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!;
    const up = urlParts[i]!;
    if (pp.startsWith(":")) {
      params[pp.slice(1)] = decodeURIComponent(up);
    } else if (pp !== up) {
      return null;
    }
  }

  return params;
}

// ─── Spec store ───────────────────────────────────────────────────────────────

export function createSpecStore(
  specsConfig: SpecsConfig,
  logger: Logger
): SpecStore {
  let specs = new Map<string, SpecFile>();
  let routes: RouteEntry[] = [];

  function load(): void {
    const newSpecs = new Map<string, SpecFile>();
    const specsDir = path.resolve(process.cwd(), specsConfig.directory);

    if (!fs.existsSync(specsDir)) {
      logger.warn({ specsDir }, "Specs directory not found");
      return;
    }

    // Recursively load all .md files
    function loadDir(dir: string, base: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          loadDir(path.join(dir, entry.name), path.join(base, entry.name));
        } else if (entry.name.endsWith(".md")) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(base, entry.name).replace(/\\/g, "/");
          try {
            const raw = fs.readFileSync(fullPath, "utf-8");
            const parsed = matter(raw);
            newSpecs.set(relativePath, {
              relativePath,
              content: parsed.content.trim(),
              frontmatter: parsed.data as Record<string, unknown>,
            });
          } catch (err) {
            logger.warn({ file: fullPath, err }, "Failed to load spec file");
          }
        }
      }
    }

    loadDir(specsDir, "");
    specs = newSpecs;

    // Parse routes
    const routesFile = specsConfig.routes_file;
    const routesSpec = newSpecs.get(routesFile);
    if (routesSpec) {
      routes = parseRoutesFile(routesSpec.content);
      logger.info({ count: routes.length }, "Routes loaded");
    } else {
      // Try to build routes from frontmatter
      routes = [];
      for (const spec of newSpecs.values()) {
        const fm = spec.frontmatter;
        if (fm["route"] && typeof fm["route"] === "string") {
          const parts = (fm["route"] as string).trim().split(/\s+/);
          if (parts.length >= 2) {
            routes.push({
              method: parts[0]!.toUpperCase(),
              pattern: parts[1]!,
              specPath: spec.relativePath,
            });
          }
        }
      }
      if (routes.length > 0) {
        logger.info({ count: routes.length }, "Routes inferred from spec frontmatter");
      } else {
        logger.warn({ routesFile }, "Routes file not found and no frontmatter routes");
      }
    }

    logger.info({ count: newSpecs.size }, "Spec files loaded");
  }

  load();

  return {
    getSpec(relativePath: string): SpecFile | undefined {
      return specs.get(relativePath);
    },

    getRoute(
      method: string,
      urlPath: string
    ): { spec: SpecFile; params: Record<string, string> } | null {
      const upperMethod = method.toUpperCase();

      // Sort routes: exact matches first, then parameterized
      const sorted = [...routes].sort((a, b) => {
        const aScore = (a.pattern.match(/:/g) ?? []).length;
        const bScore = (b.pattern.match(/:/g) ?? []).length;
        return aScore - bScore;
      });

      for (const route of sorted) {
        if (route.method !== upperMethod) continue;
        const params = matchRoute(route.pattern, urlPath);
        if (params !== null) {
          const spec = specs.get(route.specPath);
          if (!spec) {
            logger.warn(
              { specPath: route.specPath },
              "Route references missing spec file"
            );
            continue;
          }
          return { spec, params };
        }
      }
      return null;
    },

    getGlobalSpecs(): SpecFile[] {
      return specsConfig.global_specs
        .map((p) => specs.get(p))
        .filter((s): s is SpecFile => s !== undefined);
    },

    getRoutes(): RouteEntry[] {
      return routes;
    },

    getAllSpecs(): SpecFile[] {
      return [...specs.values()];
    },

    reload(): void {
      load();
    },
  };
}
