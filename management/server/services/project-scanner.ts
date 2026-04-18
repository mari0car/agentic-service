import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import matter from "gray-matter";
import type {
  ProjectMeta,
  ProjectConfig,
  RouteEntry,
  SpecTree,
  MigrationFile,
} from "../types.js";

const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../../../projects");

export async function getExamplesDir(): Promise<string> {
  return EXAMPLES_DIR;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const entries = await fs.readdir(EXAMPLES_DIR, { withFileTypes: true });
  const projects: ProjectMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const project = await scanProject(entry.name);
    if (project) projects.push(project);
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function scanProject(
  name: string
): Promise<ProjectMeta | null> {
  const projectPath = path.join(EXAMPLES_DIR, name);

  try {
    await fs.access(projectPath);
  } catch {
    return null;
  }

  const config = await loadProjectConfig(projectPath);
  const hasPackageJson = await fileExists(
    path.join(projectPath, "package.json")
  );
  const hasStartScript = await fileExists(path.join(projectPath, "start.sh"));

  let routes: RouteEntry[] = [];
  let specFiles: string[] = [];
  let globalSpecs: string[] = [];
  let migrationFiles: string[] = [];

  if (config) {
    const specsDir = path.join(
      projectPath,
      config.specs?.directory || "./specs"
    );
    routes = await parseRoutes(specsDir, config);
    specFiles = await listSpecFiles(specsDir);
    globalSpecs = config.specs?.global_specs || [];

    const migrationsDir = getMigrationsDir(projectPath, config);
    if (migrationsDir) {
      migrationFiles = await listMigrations(migrationsDir);
    }
  }

  // Try to get description from README or package.json
  let description: string | undefined;
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, "package.json"), "utf-8")
      );
      description = pkg.description;
    } catch {
      // ignore
    }
  }

  return {
    name,
    path: projectPath,
    description,
    config,
    routes,
    specFiles,
    globalSpecs,
    migrationFiles,
    hasPackageJson,
    hasStartScript,
  };
}

async function loadProjectConfig(
  projectPath: string
): Promise<ProjectConfig | null> {
  const configPath = path.join(projectPath, "config.yaml");
  try {
    const content = await fs.readFile(configPath, "utf-8");
    return yaml.load(content) as ProjectConfig;
  } catch {
    return null;
  }
}

async function parseRoutes(
  specsDir: string,
  config: ProjectConfig
): Promise<RouteEntry[]> {
  const routesFile = config.specs?.routes_file || "api-routes.md";
  const routesPath = path.join(specsDir, routesFile);

  try {
    const content = await fs.readFile(routesPath, "utf-8");
    const routes: RouteEntry[] = [];

    // Parse route entries like: `GET /api/projects` -> projects/list.md
    const routePattern =
      /`(\w+)\s+(\/[^`]+)`\s*->\s*(\S+\.md)/g;
    let match;

    while ((match = routePattern.exec(content)) !== null) {
      const method = match[1]!;
      const routePath = match[2]!;
      const specFile = match[3]!;

      // Check if the spec file has a tool_handler in its frontmatter
      let handlerType: "llm" | "tool_handler" = "llm";
      let toolHandler: string | undefined;

      let specMissing = false;
      try {
        const specContent = await fs.readFile(
          path.join(specsDir, specFile),
          "utf-8"
        );
        const { data } = matter(specContent);
        if (data.tool_handler) {
          handlerType = "tool_handler";
          toolHandler = data.tool_handler;
        }
      } catch {
        // spec file doesn't exist yet
        specMissing = true;
      }

      routes.push({
        method,
        path: routePath,
        specFile,
        handlerType,
        toolHandler,
        specMissing,
      });
    }

    return routes;
  } catch {
    return [];
  }
}

async function listSpecFiles(specsDir: string): Promise<string[]> {
  try {
    return await walkDir(specsDir, specsDir);
  } catch {
    return [];
  }
}

async function walkDir(dir: string, baseDir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath, baseDir)));
    } else if (entry.name.endsWith(".md")) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

export async function getSpecTree(specsDir: string): Promise<SpecTree[]> {
  try {
    return await buildSpecTree(specsDir, specsDir);
  } catch {
    return [];
  }
}

async function buildSpecTree(
  dir: string,
  baseDir: string
): Promise<SpecTree[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const items: SpecTree[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      const children = await buildSpecTree(fullPath, baseDir);
      items.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children,
      });
    } else if (entry.name.endsWith(".md")) {
      items.push({
        name: entry.name,
        path: relativePath,
        type: "file",
      });
    }
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readSpecFile(
  specsDir: string,
  filePath: string
): Promise<{ content: string; frontmatter: Record<string, unknown> }> {
  const fullPath = path.join(specsDir, filePath);
  // Prevent directory traversal
  if (!fullPath.startsWith(specsDir)) {
    throw new Error("Invalid path");
  }
  const raw = await fs.readFile(fullPath, "utf-8");
  const { content, data } = matter(raw);
  return { content: raw, frontmatter: data };
}

export async function writeSpecFile(
  specsDir: string,
  filePath: string,
  content: string
): Promise<void> {
  const fullPath = path.join(specsDir, filePath);
  if (!fullPath.startsWith(specsDir)) {
    throw new Error("Invalid path");
  }
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

export async function deleteSpecFile(
  specsDir: string,
  filePath: string
): Promise<void> {
  const fullPath = path.join(specsDir, filePath);
  if (!fullPath.startsWith(specsDir)) {
    throw new Error("Invalid path");
  }
  await fs.unlink(fullPath);
}

export async function listMigrationFiles(
  projectPath: string,
  config: ProjectConfig
): Promise<MigrationFile[]> {
  const migrationsDir = getMigrationsDir(projectPath, config);
  if (!migrationsDir) return [];

  try {
    const entries = await fs.readdir(migrationsDir);
    const migrations: MigrationFile[] = [];

    for (const name of entries.sort()) {
      if (!name.endsWith(".sql")) continue;
      const content = await fs.readFile(
        path.join(migrationsDir, name),
        "utf-8"
      );
      migrations.push({
        name,
        path: path.relative(projectPath, path.join(migrationsDir, name)),
        content,
      });
    }

    return migrations;
  } catch {
    return [];
  }
}

function getMigrationsDir(
  projectPath: string,
  config: ProjectConfig
): string | null {
  const dbConfig = config.database as Record<string, unknown> | undefined;
  if (!dbConfig) return null;
  const migrations = dbConfig.migrations as
    | Record<string, unknown>
    | undefined;
  if (!migrations?.directory) return null;
  return path.join(projectPath, migrations.directory as string);
}

export async function writeMigrationFile(
  projectPath: string,
  config: ProjectConfig,
  filename: string,
  content: string
): Promise<void> {
  const migrationsDir = getMigrationsDir(projectPath, config);
  if (!migrationsDir) throw new Error("Migrations directory not configured");
  const fullPath = path.join(migrationsDir, filename);
  if (!fullPath.startsWith(migrationsDir)) throw new Error("Invalid path");
  await fs.mkdir(migrationsDir, { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

export async function deleteMigrationFile(
  projectPath: string,
  config: ProjectConfig,
  filename: string
): Promise<void> {
  const migrationsDir = getMigrationsDir(projectPath, config);
  if (!migrationsDir) throw new Error("Migrations directory not configured");
  const fullPath = path.join(migrationsDir, filename);
  if (!fullPath.startsWith(migrationsDir)) throw new Error("Invalid path");
  await fs.unlink(fullPath);
}

async function listMigrations(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return [];
  }
}

export async function readProjectFile(
  projectPath: string,
  filePath: string
): Promise<string> {
  const fullPath = path.join(projectPath, filePath);
  if (!fullPath.startsWith(projectPath)) {
    throw new Error("Invalid path");
  }
  return fs.readFile(fullPath, "utf-8");
}

export async function writeProjectFile(
  projectPath: string,
  filePath: string,
  content: string
): Promise<void> {
  const fullPath = path.join(projectPath, filePath);
  if (!fullPath.startsWith(projectPath)) {
    throw new Error("Invalid path");
  }
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ─── Tool Registry / Handler Code Utilities ──────────────────────────────────

/**
 * Locate the tool-registry.ts file in a project.
 * Checks common locations: root, src/, lib/.
 */
export async function findToolRegistryFile(
  projectPath: string
): Promise<string | null> {
  const candidates = [
    "tool-registry.ts",
    "src/tool-registry.ts",
    "lib/tool-registry.ts",
  ];
  for (const candidate of candidates) {
    const fullPath = path.join(projectPath, candidate);
    if (await fileExists(fullPath)) return candidate;
  }
  return null;
}

// ─── Split-handler layout support ────────────────────────────────────────────
//
// When handlers are split into individual files under handlers/ (e.g.
// handlers/projects-list.ts), the monolithic read/write functions don't work.
// These utilities detect that layout and operate on the per-handler files
// directly.

/**
 * Returns true when the project uses the split-handler layout:
 * a tool-registry.ts that delegates to files in a handlers/ sub-directory.
 * Detection: a handlers/ directory exists at the same level as tool-registry.ts.
 */
export async function isSplitHandlerLayout(projectPath: string): Promise<boolean> {
  const registryFile = await findToolRegistryFile(projectPath);
  if (!registryFile) return false;
  // Derive the directory containing tool-registry.ts
  const registryDir = path.join(projectPath, path.dirname(registryFile));
  return fileExists(path.join(registryDir, "handlers"));
}

/**
 * Convert a handler key (e.g. "projects/list") to the filename used in the
 * split-handler layout (e.g. "projects-list.ts").
 */
export function handlerKeyToFilename(handlerKey: string): string {
  return handlerKey.replace(/\//g, "-") + ".ts";
}

/**
 * Given a project and a handler key, return the relative path to the
 * per-handler file (e.g. "handlers/projects-list.ts").
 * Returns null if the file does not exist.
 */
export async function findHandlerFile(
  projectPath: string,
  handlerKey: string
): Promise<string | null> {
  const registryFile = await findToolRegistryFile(projectPath);
  if (!registryFile) return null;
  const registryDir = path.dirname(registryFile);
  const filename = handlerKeyToFilename(handlerKey);
  const relative = path.join(registryDir, "handlers", filename);
  if (await fileExists(path.join(projectPath, relative))) return relative;
  return null;
}

/**
 * Read a single per-handler file's full content (split-handler layout).
 */
export async function readHandlerFile(
  projectPath: string,
  handlerKey: string
): Promise<{ content: string; filePath: string } | null> {
  const filePath = await findHandlerFile(projectPath, handlerKey);
  if (!filePath) return null;
  const content = await fs.readFile(path.join(projectPath, filePath), "utf-8");
  return { content, filePath };
}

/**
 * Read handlers/shared.ts as the "helpers" section (split-handler layout).
 */
export async function readSharedHelpersFile(
  projectPath: string
): Promise<string | null> {
  const registryFile = await findToolRegistryFile(projectPath);
  if (!registryFile) return null;
  const registryDir = path.dirname(registryFile);
  const sharedPath = path.join(projectPath, registryDir, "handlers", "shared.ts");
  if (!(await fileExists(sharedPath))) return null;
  return fs.readFile(sharedPath, "utf-8");
}

/**
 * Write updated handler code back to its per-handler file (split-handler layout).
 */
export async function writeHandlerFile(
  projectPath: string,
  handlerKey: string,
  content: string
): Promise<string> {
  const registryFile = await findToolRegistryFile(projectPath);
  if (!registryFile) throw new Error("No tool-registry.ts found");
  const registryDir = path.dirname(registryFile);
  const filename = handlerKeyToFilename(handlerKey);
  const relative = path.join(registryDir, "handlers", filename);
  await fs.mkdir(path.join(projectPath, path.dirname(relative)), { recursive: true });
  await fs.writeFile(path.join(projectPath, relative), content, "utf-8");
  return relative;
}

/**
 * Create a new per-handler file and register it in tool-registry.ts
 * (split-handler layout).
 *
 * The generated file exports a default RouteHandler. The tool-registry.ts
 * loader gets a new loadHandlerSafe entry appended to its declarations array.
 */
export async function addHandlerToSplitRegistry(
  projectPath: string,
  handlerKey: string,
  handlerCode: string
): Promise<void> {
  const registryFilePath = await findToolRegistryFile(projectPath);
  if (!registryFilePath) throw new Error("No tool-registry.ts found");

  // Write the per-handler file
  const filename = handlerKeyToFilename(handlerKey);
  const registryDir = path.dirname(registryFilePath);
  const handlerRelative = path.join(registryDir, "handlers", filename);
  await fs.mkdir(
    path.join(projectPath, path.dirname(handlerRelative)),
    { recursive: true }
  );
  await fs.writeFile(
    path.join(projectPath, handlerRelative),
    handlerCode,
    "utf-8"
  );

  // Update tool-registry.ts: add a new loadHandlerSafe entry
  const registryContent = await fs.readFile(
    path.join(projectPath, registryFilePath),
    "utf-8"
  );

  // Derive the import path relative to tool-registry.ts
  const importPath = `./${path.join("handlers", filename).replace(/\\/g, "/")}`;

  // Insert a new entry into the declarations array before the closing `]`
  const newEntry = `      { key: "${handlerKey}", load: () => import("${importPath.replace(".ts", ".js")}") },`;
  const updated = registryContent.replace(
    /(\s*\],\s*\n\s*logger\s*\))/,
    `\n${newEntry}$1`
  );

  await fs.writeFile(
    path.join(projectPath, registryFilePath),
    updated,
    "utf-8"
  );
}

/**
 * Read the full content of the tool-registry.ts file for a project.
 * Also indicates whether the project uses the split-handler layout.
 */
export async function readToolRegistry(
  projectPath: string
): Promise<{ content: string; filePath: string; isSplit: boolean } | null> {
  const registryFile = await findToolRegistryFile(projectPath);
  if (!registryFile) return null;
  const fullPath = path.join(projectPath, registryFile);
  const content = await fs.readFile(fullPath, "utf-8");
  const isSplit = await isSplitHandlerLayout(projectPath);
  return { content, filePath: registryFile, isSplit };
}

/**
 * From the registry Map export, find the variable name for a given handler key.
 * e.g. for key "projects/list" in `["projects/list", listProjects]` returns "listProjects"
 */
export function findHandlerVariableName(
  registryContent: string,
  handlerKey: string
): string | null {
  // Match: ["projects/list", listProjects] or ["projects/list", listProjects ],
  const escaped = handlerKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\["${escaped}"\\s*,\\s*(\\w+)\\s*\\]`,
    "m"
  );
  const match = registryContent.match(pattern);
  return match ? match[1]! : null;
}

/**
 * Extract a single handler's code block from tool-registry.ts.
 * Finds `const <varName>: RouteHandler = { ... };` by counting braces.
 * Also captures the comment block immediately preceding it.
 */
export function extractHandlerCode(
  registryContent: string,
  handlerKey: string
): { code: string; variableName: string; startIndex: number; endIndex: number } | null {
  const varName = findHandlerVariableName(registryContent, handlerKey);
  if (!varName) return null;

  // Find the handler declaration: "const listProjects: RouteHandler = {"
  const declPattern = new RegExp(
    `((?:\\/\\/[^\\n]*\\n)*)\\s*const\\s+${varName}\\s*:\\s*RouteHandler\\s*=\\s*\\{`,
    "m"
  );
  const declMatch = declPattern.exec(registryContent);
  if (!declMatch) return null;

  // Start from the opening brace of the object
  const commentBlock = declMatch[1] || "";
  const fullMatchStart = declMatch.index!;
  const braceStart = registryContent.indexOf("{", fullMatchStart + commentBlock.length);

  // Count braces to find the matching closing brace
  let depth = 0;
  let i = braceStart;
  for (; i < registryContent.length; i++) {
    const ch = registryContent[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
    // Skip strings (simple approach for single/double/template literals)
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < registryContent.length) {
        if (registryContent[i] === "\\") {
          i++; // skip escaped char
        } else if (registryContent[i] === quote) {
          break;
        }
        i++;
      }
    }
  }

  // i is now at the closing brace; include the semicolon if present
  let endIndex = i + 1;
  if (registryContent[endIndex] === ";") endIndex++;

  const code = registryContent.slice(fullMatchStart, endIndex).trim();
  return { code, variableName: varName, startIndex: fullMatchStart, endIndex };
}

/**
 * Extract the shared helpers section from tool-registry.ts.
 * This is everything between the imports and the first handler declaration.
 */
export function extractSharedHelpers(registryContent: string): string {
  // Find the last import line
  const lines = registryContent.split("\n");
  let lastImportEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (
      line.startsWith("import ") ||
      line.startsWith("} from ") ||
      line.startsWith("import{")
    ) {
      lastImportEnd = i + 1;
    }
  }

  // Find the first handler declaration (const xxx: RouteHandler)
  const firstHandlerPattern = /^const\s+\w+\s*:\s*RouteHandler\s*=/m;
  // Search including comment lines before the handler
  const handlerCommentPattern = /^\/\/ ─── Handler:/m;
  const handlerMatch = registryContent.match(handlerCommentPattern);
  const firstHandlerMatch = registryContent.match(firstHandlerPattern);

  let endPos: number;
  if (handlerMatch && firstHandlerMatch) {
    endPos = Math.min(handlerMatch.index!, firstHandlerMatch.index!);
  } else if (handlerMatch) {
    endPos = handlerMatch.index!;
  } else if (firstHandlerMatch) {
    endPos = firstHandlerMatch.index!;
  } else {
    return "";
  }

  // Get the text between imports and first handler
  const afterImports = registryContent.slice(
    lines.slice(0, lastImportEnd).join("\n").length
  );
  const helpers = afterImports.slice(
    0,
    endPos - lines.slice(0, lastImportEnd).join("\n").length
  );

  return helpers.trim();
}

/**
 * Update (replace) a handler's code in the registry file.
 * Returns the updated full file content.
 */
export function updateHandlerInRegistry(
  registryContent: string,
  handlerKey: string,
  newCode: string
): string | null {
  const extracted = extractHandlerCode(registryContent, handlerKey);
  if (!extracted) return null;

  return (
    registryContent.slice(0, extracted.startIndex) +
    newCode +
    registryContent.slice(extracted.endIndex)
  );
}

/**
 * Add a new handler to the registry file.
 * Inserts the handler code before the registry export and adds it to the Map.
 * Returns the updated full file content.
 */
export function addHandlerToRegistry(
  registryContent: string,
  handlerKey: string,
  handlerCode: string,
  variableName: string
): string {
  // Find the registry export: "export const registry: RouteHandlerRegistry = new Map(["
  const exportPattern =
    /export\s+const\s+registry\s*:\s*RouteHandlerRegistry\s*=\s*new\s+Map\s*\(\s*\[/;
  const exportMatch = exportPattern.exec(registryContent);

  if (!exportMatch) {
    // No registry export found -- append handler + create new registry
    return (
      registryContent +
      "\n\n" +
      handlerCode +
      "\n\n" +
      `export const registry: RouteHandlerRegistry = new Map([\n` +
      `  ["${handlerKey}", ${variableName}],\n` +
      `]);\n`
    );
  }

  // Insert handler code before the export block
  const insertPos = exportMatch.index!;
  const before = registryContent.slice(0, insertPos);
  const after = registryContent.slice(insertPos);

  const withHandler = before + handlerCode + "\n\n" + after;

  // Add entry to the Map -- find the closing "])" of the Map
  const mapClosePattern = /\]\s*\)\s*;/;
  const mapCloseMatch = mapClosePattern.exec(
    withHandler.slice(insertPos + handlerCode.length)
  );

  if (!mapCloseMatch) return withHandler;

  const mapClosePos =
    insertPos + handlerCode.length + mapCloseMatch.index!;

  // Find the last entry line before the close to match indentation
  const beforeClose = withHandler.slice(0, mapClosePos);
  const lastBracket = beforeClose.lastIndexOf("]");

  // Insert new entry after the last entry
  const newEntry = `\n  ["${handlerKey}", ${variableName}],`;

  // Find where to insert: after the last "]," inside the Map
  const mapStart = withHandler.indexOf(
    "new Map([",
    insertPos + handlerCode.length
  );
  const mapBody = withHandler.slice(
    mapStart,
    mapClosePos + mapCloseMatch[0].length
  );

  // Find the last entry in the map
  const entries = [...mapBody.matchAll(/\[("[^"]+",\s*\w+)\]/g)];
  if (entries.length > 0) {
    const lastEntry = entries[entries.length - 1]!;
    const lastEntryEnd = mapStart + lastEntry.index! + lastEntry[0].length;
    // Check if there's a comma after
    let insertAt = lastEntryEnd;
    if (withHandler[insertAt] === ",") insertAt++;

    return (
      withHandler.slice(0, insertAt) +
      newEntry +
      withHandler.slice(insertAt)
    );
  }

  // Empty map -- insert inside
  const bracketPos = withHandler.indexOf("[", mapStart + 8) + 1;
  return (
    withHandler.slice(0, bracketPos) +
    newEntry + "\n" +
    withHandler.slice(bracketPos)
  );
}

/**
 * Create a brand new tool-registry.ts file with a single handler.
 */
export function createToolRegistryFile(
  handlerKey: string,
  handlerCode: string,
  variableName: string
): string {
  return `/**
 * Tool Registry — Fast Handlers
 *
 * Hand-authored or LLM-generated route handlers that bypass the LLM at runtime.
 * Each handler is a TypeScript reimplementation of its corresponding spec's Logic section.
 */

import type {
  RouteHandler,
  RouteHandlerRegistry,
  ToolRegistry,
} from "../../src/tools/registry.js";
import type { RequestContext } from "../../src/agent/prompt-assembler.js";
import type { AgentResponse } from "../../src/agent/response-parser.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Standard error response helper */
function errorResponse(status: number, code: string, message: string): AgentResponse {
  return { status, headers: {}, body: { error: { code, message } } };
}

/** Execute a database SELECT query via the tool registry. */
async function dbQuery(
  tools: ToolRegistry,
  sql: string,
  params?: unknown[]
): Promise<{ rows: Record<string, unknown>[]; row_count: number }> {
  const result = await tools.tools["database_query"]!.execute({ sql, params });
  return result as { rows: Record<string, unknown>[]; row_count: number };
}

${handlerCode}

// ─── Registry export ──────────────────────────────────────────────────────────

export const registry: RouteHandlerRegistry = new Map([
  ["${handlerKey}", ${variableName}],
]);
`;
}

/**
 * Add a route entry to the api-routes.md file.
 * If a section is specified, appends under that section header.
 * Otherwise appends at the end.
 */
export async function addRouteToRoutesFile(
  specsDir: string,
  routesFile: string,
  route: { method: string; path: string; specFile: string },
  section?: string
): Promise<void> {
  const routesPath = path.join(specsDir, routesFile);
  let content: string;

  try {
    content = await fs.readFile(routesPath, "utf-8");
  } catch {
    // File doesn't exist, create it
    content = "# API Routes\n";
  }

  const routeLine = `- \`${route.method} ${route.path}\` -> ${route.specFile}`;

  if (section) {
    // Find the section header and append after the last line in that section
    const sectionPattern = new RegExp(
      `^(## ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\s*$`,
      "m"
    );
    const sectionMatch = sectionPattern.exec(content);

    if (sectionMatch) {
      // Find the end of this section (next ## header or end of file)
      const sectionStart = sectionMatch.index! + sectionMatch[0].length;
      const nextSection = content.indexOf("\n## ", sectionStart);
      const insertPos = nextSection !== -1 ? nextSection : content.length;

      // Ensure we end the previous content with a newline
      const before = content.slice(0, insertPos).trimEnd();
      const after = content.slice(insertPos);

      content = before + "\n" + routeLine + "\n" + after;
    } else {
      // Section doesn't exist, create it
      content = content.trimEnd() + "\n\n## " + section + "\n" + routeLine + "\n";
    }
  } else {
    // Append at the end
    content = content.trimEnd() + "\n" + routeLine + "\n";
  }

  await fs.writeFile(routesPath, content, "utf-8");
}

/**
 * Parse the sections (## headers) from api-routes.md.
 */
export async function parseRouteSections(
  specsDir: string,
  routesFile: string
): Promise<string[]> {
  const routesPath = path.join(specsDir, routesFile);
  try {
    const content = await fs.readFile(routesPath, "utf-8");
    const sections: string[] = [];
    const pattern = /^## (.+)$/gm;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      sections.push(match[1]!);
    }
    return sections;
  } catch {
    return [];
  }
}
