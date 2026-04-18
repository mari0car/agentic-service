import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  listProjects,
  scanProject,
  getSpecTree,
  readSpecFile,
  writeSpecFile,
  deleteSpecFile,
  listMigrationFiles,
  writeMigrationFile,
  deleteMigrationFile,
  readProjectFile,
  writeProjectFile,
  readToolRegistry,
  extractHandlerCode,
  extractSharedHelpers,
  updateHandlerInRegistry,
  addHandlerToRegistry,
  createToolRegistryFile,
  addRouteToRoutesFile,
  parseRouteSections,
  readHandlerFile,
  readSharedHelpersFile,
  writeHandlerFile,
  addHandlerToSplitRegistry,
} from "../services/project-scanner.js";
import type { RouteDetail, AddRouteRequest } from "../types.js";
import {
  getProjectStatus,
  stopProject,
  startProject,
} from "../services/process-manager.js";
import path from "path";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromIni } from "@aws-sdk/credential-providers";
import { streamText } from "ai";

function createModel() {
  const bedrock = createAmazonBedrock({
    region: process.env.AWS_REGION || "eu-central-1",
    credentialProvider: fromIni({
      profile: process.env.AWS_PROFILE || "bedrock",
    }),
  });
  return bedrock(process.env.AGENTIC_LLM_MODEL || "eu.anthropic.claude-sonnet-4-6");
}

const EXAMPLES_DIR = path.resolve(import.meta.dirname, "../../../projects");

/** Calls /admin/reload on a running project to pick up spec file changes without restart. */
async function reloadProjectSpecs(name: string): Promise<boolean> {
  const status = getProjectStatus(name);
  if (!status.running || !status.port) return false;
  try {
    const res = await fetch(`http://localhost:${status.port}/admin/reload`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Restarts a running project to pick up new handler modules. */
async function restartProject(projectPath: string, name: string): Promise<void> {
  const status = getProjectStatus(name);
  if (status.running) {
    await stopProject(name);
  }
  const port = status.port ?? 8080;
  await startProject(projectPath, name, port);
}

export const projectRoutes = new Hono();

// List all projects
projectRoutes.get("/", async (c) => {
  const projects = await listProjects();
  return c.json({ data: projects });
});

// Get single project detail
projectRoutes.get("/:name", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }
  return c.json({ data: project });
});

// Get spec tree for a project
projectRoutes.get("/:name/specs", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }
  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );
  const tree = await getSpecTree(specsDir);
  return c.json({ data: tree });
});

// Read a spec file
projectRoutes.get("/:name/specs/*", async (c) => {
  const name = c.req.param("name");
  const filePath = c.req.path.replace(`/api/projects/${name}/specs/`, "");
  if (!filePath) {
    return c.json({ error: "File path required" }, 400);
  }

  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );

  try {
    const spec = await readSpecFile(specsDir, filePath);
    return c.json({ data: spec });
  } catch {
    return c.json({ error: "Spec file not found" }, 404);
  }
});

// Create or update a spec file
projectRoutes.put("/:name/specs/*", async (c) => {
  const name = c.req.param("name");
  const filePath = c.req.path.replace(`/api/projects/${name}/specs/`, "");
  if (!filePath) {
    return c.json({ error: "File path required" }, 400);
  }

  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );

  const body = await c.req.json<{ content: string }>();
  await writeSpecFile(specsDir, filePath, body.content);
  return c.json({ data: { path: filePath, saved: true } });
});

// Delete a spec file
projectRoutes.delete("/:name/specs/*", async (c) => {
  const name = c.req.param("name");
  const filePath = c.req.path.replace(`/api/projects/${name}/specs/`, "");
  if (!filePath) {
    return c.json({ error: "File path required" }, 400);
  }

  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );

  try {
    await deleteSpecFile(specsDir, filePath);
    return c.json({ data: { path: filePath, deleted: true } });
  } catch {
    return c.json({ error: "Failed to delete spec file" }, 500);
  }
});

// ─── Route Detail & Handler Management ────────────────────────────────────────

// Get route sections from api-routes.md (must be before /:name/routes/:index)
projectRoutes.get("/:name/routes/sections", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );
  const routesFile = project.config.specs?.routes_file || "api-routes.md";
  const sections = await parseRouteSections(specsDir, routesFile);
  return c.json({ data: sections });
});

// Get route detail (spec + handler code)
projectRoutes.get("/:name/routes/:index", async (c) => {
  const name = c.req.param("name");
  const index = parseInt(c.req.param("index"), 10);
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  if (isNaN(index) || index < 0 || index >= project.routes.length) {
    return c.json({ error: "Route not found" }, 404);
  }

  const route = project.routes[index]!;
  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );

  // Read spec content
  let specContent = "";
  let specFrontmatter: Record<string, unknown> = {};
  try {
    const spec = await readSpecFile(specsDir, route.specFile);
    specContent = spec.content;
    specFrontmatter = spec.frontmatter;
  } catch {
    // spec file may not exist yet
  }

  // Read handler code if this is a tool_handler route
  let handlerCode: string | undefined;
  let handlerHelpers: string | undefined;
  let handlerVariableName: string | undefined;
  let registryExists = false;

  const registry = await readToolRegistry(project.path);
  if (registry) {
    registryExists = true;
    if (route.toolHandler) {
      if (registry.isSplit) {
        // Split-handler layout: each handler lives in its own file
        const handlerFile = await readHandlerFile(project.path, route.toolHandler);
        if (handlerFile) {
          handlerCode = handlerFile.content;
          // variableName is not meaningful for split files; use the key as label
          handlerVariableName = route.toolHandler;
        }
        const shared = await readSharedHelpersFile(project.path);
        if (shared) handlerHelpers = shared;
      } else {
        // Monolithic layout: carve handler out of the single registry file
        const extracted = extractHandlerCode(registry.content, route.toolHandler);
        if (extracted) {
          handlerCode = extracted.code;
          handlerVariableName = extracted.variableName;
        }
        handlerHelpers = extractSharedHelpers(registry.content);
      }
    }
  }

  const detail: RouteDetail = {
    route,
    specContent,
    specFrontmatter,
    handlerCode,
    handlerHelpers,
    handlerVariableName,
    registryExists,
  };

  return c.json({ data: detail });
});

// Save handler code for a route
projectRoutes.put("/:name/routes/:index/handler", async (c) => {
  const name = c.req.param("name");
  const index = parseInt(c.req.param("index"), 10);
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  if (isNaN(index) || index < 0 || index >= project.routes.length) {
    return c.json({ error: "Route not found" }, 404);
  }

  const route = project.routes[index]!;
  const body = await c.req.json<{
    code: string;
    variableName: string;
    handlerKey: string;
    activateInSpec?: boolean;
  }>();

  const registry = await readToolRegistry(project.path);

  if (registry) {
    if (registry.isSplit) {
      // Split-handler layout: write directly to the per-handler file
      if (route.toolHandler || body.handlerKey) {
        const key = route.toolHandler ?? body.handlerKey;
        await writeHandlerFile(project.path, key, body.code);
      }
    } else {
      // Monolithic layout: update or add handler in the single registry file
      let newContent: string | null;

      if (route.toolHandler) {
        // Update existing handler
        newContent = updateHandlerInRegistry(
          registry.content,
          route.toolHandler,
          body.code
        );
        if (!newContent) {
          // Handler not found in file -- add it
          newContent = addHandlerToRegistry(
            registry.content,
            body.handlerKey,
            body.code,
            body.variableName
          );
        }
      } else {
        // Add new handler
        newContent = addHandlerToRegistry(
          registry.content,
          body.handlerKey,
          body.code,
          body.variableName
        );
      }

      await writeProjectFile(project.path, registry.filePath, newContent);
    }
  } else {
    // Create new registry file (monolithic, for projects that don't yet have one)
    const newContent = createToolRegistryFile(
      body.handlerKey,
      body.code,
      body.variableName
    );
    await writeProjectFile(project.path, "tool-registry.ts", newContent);
  }

  // Optionally activate in the spec's frontmatter
  if (body.activateInSpec) {
    const specsDir = path.join(
      project.path,
      project.config.specs?.directory || "./specs"
    );
    try {
      const spec = await readSpecFile(specsDir, route.specFile);
      let content = spec.content;
      // Add tool_handler to frontmatter if not already present
      if (!spec.frontmatter["tool_handler"]) {
        // Insert tool_handler line into the YAML frontmatter
        const frontmatterEnd = content.indexOf("---", 3);
        if (frontmatterEnd !== -1) {
          content =
            content.slice(0, frontmatterEnd) +
            `tool_handler: ${body.handlerKey}\n` +
            content.slice(frontmatterEnd);
        }
      }
      await writeSpecFile(specsDir, route.specFile, content);
    } catch {
      // ignore -- spec might not exist
    }

    // New handler being activated: restart so the module is imported into the registry.
    const status = getProjectStatus(name);
    if (status.running) {
      try {
        await restartProject(project.path, name);
        return c.json({ data: { saved: true, handlerKey: body.handlerKey, restarted: true } });
      } catch {
        // Restart failed — return saved=true so the UI knows the file is written
        return c.json({ data: { saved: true, handlerKey: body.handlerKey, restarted: false, restartError: "Restart failed — please restart the project manually" } });
      }
    }
  }

  return c.json({ data: { saved: true, handlerKey: body.handlerKey, restarted: false } });
});

// Toggle the fast handler on/off for a route (adds/removes tool_handler from spec frontmatter)
projectRoutes.patch("/:name/routes/:index/handler/toggle", async (c) => {
  const name = c.req.param("name");
  const index = parseInt(c.req.param("index"), 10);
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  if (isNaN(index) || index < 0 || index >= project.routes.length) {
    return c.json({ error: "Route not found" }, 404);
  }

  const route = project.routes[index]!;

  // A route can only be toggled if it already has a toolHandler key registered
  if (!route.toolHandler) {
    return c.json(
      { error: "Route has no fast handler to toggle. Generate and save a handler first." },
      400
    );
  }

  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );

  let spec: { content: string; frontmatter: Record<string, unknown> };
  try {
    spec = await readSpecFile(specsDir, route.specFile);
  } catch {
    return c.json({ error: "Spec file not found" }, 404);
  }

  const isCurrentlyActive = route.handlerType === "tool_handler";
  let content = spec.content;

  if (isCurrentlyActive) {
    // Deactivate: remove the tool_handler line from frontmatter
    content = content.replace(/^tool_handler:.*\n?/m, "");
  } else {
    // Activate: insert tool_handler into frontmatter
    const frontmatterEnd = content.indexOf("---", 3);
    if (frontmatterEnd !== -1) {
      content =
        content.slice(0, frontmatterEnd) +
        `tool_handler: ${route.toolHandler}\n` +
        content.slice(frontmatterEnd);
    } else {
      return c.json({ error: "Spec file has no YAML frontmatter" }, 400);
    }
  }

  await writeSpecFile(specsDir, route.specFile, content);

  // Reload specs in the running project so the toggle takes effect immediately.
  await reloadProjectSpecs(name);

  return c.json({
    data: {
      toggled: true,
      active: !isCurrentlyActive,
      handlerKey: route.toolHandler,
    },
  });
});

// Add a new route (creates entry in api-routes.md + spec file)
projectRoutes.post("/:name/routes", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<AddRouteRequest>();

  if (!body.method || !body.path || !body.specFile || !body.specContent) {
    return c.json(
      { error: "method, path, specFile, and specContent are required" },
      400
    );
  }

  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );
  const routesFile = project.config.specs?.routes_file || "api-routes.md";

  // Check if route already exists
  const existingRoute = project.routes.find(
    (r) => r.method === body.method && r.path === body.path
  );
  if (existingRoute) {
    return c.json(
      { error: `Route ${body.method} ${body.path} already exists` },
      409
    );
  }

  // 1. Create the spec file
  await writeSpecFile(specsDir, body.specFile, body.specContent);

  // 2. Add the route entry to api-routes.md
  await addRouteToRoutesFile(
    specsDir,
    routesFile,
    { method: body.method, path: body.path, specFile: body.specFile },
    body.section
  );

  return c.json({
    data: {
      created: true,
      method: body.method,
      path: body.path,
      specFile: body.specFile,
    },
  });
});

// ─── LLM Generation Endpoints ─────────────────────────────────────────────────

// Generate a fast handler from a route's spec via LLM (SSE streaming)
projectRoutes.post("/:name/routes/generate-handler", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<{ routeIndex: number }>();
  const index = body.routeIndex;

  if (isNaN(index) || index < 0 || index >= project.routes.length) {
    return c.json({ error: "Route not found" }, 404);
  }

  const route = project.routes[index]!;
  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );

  // Read the spec content
  let specContent = "";
  try {
    const spec = await readSpecFile(specsDir, route.specFile);
    specContent = spec.content;
  } catch {
    return c.json({ error: "Spec file not found" }, 404);
  }

  // Read global specs for context
  const globalSpecs: string[] = [];
  for (const globalSpecFile of project.config.specs?.global_specs || []) {
    try {
      const gs = await readSpecFile(specsDir, globalSpecFile);
      globalSpecs.push(`--- ${globalSpecFile} ---\n${gs.content}`);
    } catch {
      // skip missing global specs
    }
  }

  // Read existing handler code for pattern reference
  let existingHandlers = "";
  let sharedHelpers = "";
  let isSplit = false;
  const registry = await readToolRegistry(project.path);
  if (registry) {
    isSplit = registry.isSplit;
    if (registry.isSplit) {
      // Split-handler layout: read shared.ts and a sample handler file for context
      const shared = await readSharedHelpersFile(project.path);
      if (shared) sharedHelpers = shared;
      for (const r of project.routes) {
        if (r.toolHandler) {
          const handlerFile = await readHandlerFile(project.path, r.toolHandler);
          if (handlerFile) {
            existingHandlers = `// Example existing handler (${r.toolHandler}):\n${handlerFile.content}`;
            break;
          }
        }
      }
    } else {
      // Monolithic layout
      sharedHelpers = extractSharedHelpers(registry.content);
      for (const r of project.routes) {
        if (r.toolHandler) {
          const extracted = extractHandlerCode(registry.content, r.toolHandler);
          if (extracted) {
            existingHandlers = `// Example existing handler (${r.toolHandler}):\n${extracted.code}`;
            break;
          }
        }
      }
    }
  }

  // Build a handler key suggestion from the spec file path
  const suggestedKey = route.specFile
    .replace(/\.md$/, "")
    .replace(/\\/g, "/");

  // Build a variable name suggestion
  const suggestedVarName = suggestedKey
    .split("/")
    .map((part, i) =>
      i === 0
        ? part
        : part.charAt(0).toUpperCase() + part.slice(1)
    )
    .join("")
    .replace(/[^a-zA-Z0-9]/g, "");

  const systemPrompt = `You are an expert TypeScript developer. You are generating a Fast Handler (RouteHandler) for an Agentic Service project.

A Fast Handler is a hand-coded TypeScript function that replaces the LLM at runtime for a specific API endpoint. It must faithfully implement the business logic described in the markdown spec.

## Handler Interface

Each handler implements the RouteHandler interface:

\`\`\`typescript
interface RouteHandler {
  description: string;
  execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse>;
}
\`\`\`

Where:
- \`RequestContext\` has: \`method\`, \`path\`, \`path_params\`, \`query_params\`, \`body\`, \`headers\`, \`auth\` (with \`.authenticated\`, \`.user_id\`, \`.role\`)
- \`ToolRegistry\` provides tools like \`database_query\` and \`database_execute\`
- \`AgentResponse\` is: \`{ status: number, headers: Record<string, string>, body: unknown }\`

## Available Database Tools

- \`tools.tools["database_query"]!.execute({ sql, params })\` — for SELECT queries, returns \`{ rows, row_count }\`
- \`tools.tools["database_execute"]!.execute({ sql, params })\` — for INSERT/UPDATE/DELETE, returns \`{ rows_affected }\`

${sharedHelpers ? `## Shared Helpers Already Available\n\nThese helpers are importable from \`./shared.js\` and can be used:\n\n\`\`\`typescript\n${sharedHelpers}\n\`\`\`` : ""}

${existingHandlers ? `## Existing Handler Example\n\n\`\`\`typescript\n${existingHandlers}\n\`\`\`` : ""}

${globalSpecs.length > 0 ? `## Global Specs (Domain Context)\n\n${globalSpecs.join("\n\n")}` : ""}

## Instructions

${isSplit ? `This project uses the split-handler layout (one file per handler). Generate a COMPLETE standalone TypeScript module:
1. Include the file-level JSDoc comment (route, spec path)
2. Include all necessary imports from "../../../src/tools/registry.js", "../../../src/agent/prompt-assembler.js", "../../../src/agent/response-parser.js", and from "./shared.js" for any shared helpers you use
3. Implement the RouteHandler as \`const handler: RouteHandler = { ... };\`
4. End with \`export default handler;\`
5. Do NOT include a registry Map export` : `1. Generate ONLY the handler constant declaration (e.g. \`const ${suggestedVarName}: RouteHandler = { ... };\`)
2. Include the comment header line (e.g. \`// ─── Handler: ${route.method} ${route.path} ───\`)
3. Include \`// Spec: ${route.specFile}\` comment
4. Do NOT include imports — they are already in the file
5. Do NOT include the registry Map export — it will be added automatically`}
- Implement the exact business logic from the spec
- Use the shared helpers if available (dbQuery, unauthorized, forbidden, notFound, badRequest, etc.)
- If shared helpers are not available, define inline helper functions
- Output ONLY the TypeScript code, no markdown fences, no explanations`;

  const userPrompt = `Generate a Fast Handler for this endpoint:

**Route:** ${route.method} ${route.path}
**Handler key:** ${suggestedKey}
**Variable name:** ${suggestedVarName}

**Spec file (${route.specFile}):**

${specContent}`;

  return streamSSE(c, async (stream) => {
    try {
      const result = streamText({
        model: createModel() as any,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      let fullText = "";
      for await (const part of result.textStream) {
        fullText += part;
        await stream.writeSSE({
          data: JSON.stringify({ type: "text", content: part }),
          event: "message",
        });
      }

      // Send metadata alongside the done event
      await stream.writeSSE({
        data: JSON.stringify({
          type: "done",
          handlerKey: suggestedKey,
          variableName: suggestedVarName,
          fullText,
        }),
        event: "message",
      });
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "LLM generation failed";
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", content: errorMsg }),
        event: "message",
      });
    }
  });
});

// Generate a spec from a description via LLM (SSE streaming)
projectRoutes.post("/:name/routes/generate-spec", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<{
    description: string;
    method: string;
    path: string;
    specFile: string;
  }>();

  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );

  // Read global specs for context
  const globalSpecs: string[] = [];
  for (const globalSpecFile of project.config.specs?.global_specs || []) {
    try {
      const gs = await readSpecFile(specsDir, globalSpecFile);
      globalSpecs.push(`--- ${globalSpecFile} ---\n${gs.content}`);
    } catch {
      // skip
    }
  }

  // Read an existing spec as a pattern reference
  let exampleSpec = "";
  if (project.routes.length > 0) {
    try {
      const firstRoute = project.routes[0]!;
      const spec = await readSpecFile(specsDir, firstRoute.specFile);
      exampleSpec = `## Example Spec (${firstRoute.specFile})\n\n${spec.content}`;
    } catch {
      // skip
    }
  }

  const systemPrompt = `You are an expert API designer writing endpoint specification files for an Agentic Service project. Agentic Service is a framework where backend APIs are defined in markdown, and an LLM interprets the spec at runtime to handle requests.

## Spec File Format

Each spec file has YAML frontmatter and a markdown body:

\`\`\`markdown
---
route: METHOD /path
auth: required
---
# Endpoint Title

## Endpoint
METHOD /path

## Authentication
Required / Not required

## Input / Path Parameters / Query Parameters
- Describe inputs, types, validation

## Logic
1. Step-by-step business logic
2. Include SQL queries in code blocks
3. Be precise about validation, error handling

## Success Response (status code)
\`\`\`json
{ "data": { ... } }
\`\`\`

## Error Responses
Describe error cases
\`\`\`

${globalSpecs.length > 0 ? `## Global Specs (Domain Context)\n\n${globalSpecs.join("\n\n")}` : ""}

${exampleSpec}

## Instructions

1. Generate a complete spec file following the format above
2. Include YAML frontmatter with route and auth fields
3. Write detailed step-by-step logic that an LLM can follow
4. Include SQL queries where appropriate
5. Include validation rules and error responses
6. Follow patterns from the example spec if provided
7. Output ONLY the markdown content, no extra wrapping`;

  const userPrompt = `Generate a spec for:

**Route:** ${body.method} ${body.path}
**Spec file:** ${body.specFile}
**Description:** ${body.description}`;

  return streamSSE(c, async (stream) => {
    try {
      const result = streamText({
        model: createModel() as any,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      let fullText = "";
      for await (const part of result.textStream) {
        fullText += part;
        await stream.writeSSE({
          data: JSON.stringify({ type: "text", content: part }),
          event: "message",
        });
      }

      await stream.writeSSE({
        data: JSON.stringify({ type: "done", fullText }),
        event: "message",
      });
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "LLM generation failed";
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", content: errorMsg }),
        event: "message",
      });
    }
  });
});

// Get project config
projectRoutes.get("/:name/config", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  try {
    const raw = await readProjectFile(project.path, "config.yaml");
    return c.json({ data: { raw, parsed: project.config } });
  } catch {
    return c.json({ error: "Config not found" }, 404);
  }
});

// Update project config
projectRoutes.put("/:name/config", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<{ content: string }>();
  await writeProjectFile(project.path, "config.yaml", body.content);
  return c.json({ data: { saved: true } });
});

// Get migrations
projectRoutes.get("/:name/migrations", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const migrations = await listMigrationFiles(project.path, project.config);
  return c.json({ data: migrations });
});

// Generate migration SQL via LLM (SSE streaming)
projectRoutes.post("/:name/migrations/generate", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<{ description: string }>();

  // Read existing migrations for context
  const existingMigrations = await listMigrationFiles(project.path, project.config);
  const existingContext = existingMigrations.length > 0
    ? existingMigrations.map((m) => `--- ${m.name} ---\n${m.content}`).join("\n\n")
    : "";

  // Read global specs (schema context)
  const specsDir = path.join(
    project.path,
    project.config.specs?.directory || "./specs"
  );
  const globalSpecs: string[] = [];
  for (const globalSpecFile of project.config.specs?.global_specs || []) {
    try {
      const gs = await readSpecFile(specsDir, globalSpecFile);
      globalSpecs.push(`--- ${globalSpecFile} ---\n${gs.content}`);
    } catch {
      // skip missing global specs
    }
  }

  // Determine next migration number
  const lastNum = existingMigrations.reduce((max, m) => {
    const match = m.name.match(/^(\d+)/);
    return match ? Math.max(max, parseInt(match[1]!, 10)) : max;
  }, 0);
  const nextNum = String(lastNum + 1).padStart(3, "0");

  const dbDriver = (project.config.database as Record<string, unknown>)?.driver as string | undefined;

  const systemPrompt = `You are an expert database engineer writing SQL migration files for a project.
${dbDriver ? `The database is: **${dbDriver}**.` : ""}

## Instructions

1. Write a single SQL migration file
2. Include both forward migration statements
3. Use IF NOT EXISTS / IF EXISTS guards where appropriate
4. For SQLite: avoid unsupported features (no ADD CONSTRAINT, no DROP COLUMN in older SQLite, use TEXT for most types)
5. For PostgreSQL: use proper types (SERIAL/BIGSERIAL, TIMESTAMP WITH TIME ZONE, UUID, etc.)
6. Output ONLY the raw SQL, no markdown fences, no explanations

${existingContext ? `## Existing Migrations (for context)\n\n${existingContext}` : ""}

${globalSpecs.length > 0 ? `## Global Specs (Domain Context)\n\n${globalSpecs.join("\n\n")}` : ""}`;

  const userPrompt = `Generate a migration SQL file for: ${body.description}

Suggested filename: ${nextNum}_<short_description>.sql

First line of your response must be a SQL comment with the suggested filename, e.g.:
-- filename: ${nextNum}_create_users.sql

Then the SQL:`;

  return streamSSE(c, async (stream) => {
    try {
      const result = streamText({
        model: createModel() as any,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      let fullText = "";
      for await (const part of result.textStream) {
        fullText += part;
        await stream.writeSSE({
          data: JSON.stringify({ type: "text", content: part }),
          event: "message",
        });
      }

      // Extract suggested filename from first line comment
      const firstLine = fullText.split("\n")[0] ?? "";
      const filenameMatch = firstLine.match(/--\s*filename:\s*(\S+\.sql)/i);
      const suggestedFilename = filenameMatch ? filenameMatch[1] : `${nextNum}_migration.sql`;

      await stream.writeSSE({
        data: JSON.stringify({ type: "done", fullText, suggestedFilename }),
        event: "message",
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "LLM generation failed";
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", content: errorMsg }),
        event: "message",
      });
    }
  });
});

// Create migration file
projectRoutes.post("/:name/migrations", async (c) => {
  const name = c.req.param("name");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<{ filename: string; content: string }>();
  if (!body.filename || !body.filename.endsWith(".sql")) {
    return c.json({ error: "Filename must end with .sql" }, 400);
  }

  await writeMigrationFile(project.path, project.config, body.filename, body.content ?? "");
  return c.json({ data: { saved: true } });
});

// Save (update) migration file
projectRoutes.put("/:name/migrations/:filename", async (c) => {
  const name = c.req.param("name");
  const filename = c.req.param("filename");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  const body = await c.req.json<{ content: string }>();
  await writeMigrationFile(project.path, project.config, filename, body.content);
  return c.json({ data: { saved: true } });
});

// Delete migration file
projectRoutes.delete("/:name/migrations/:filename", async (c) => {
  const name = c.req.param("name");
  const filename = c.req.param("filename");
  const project = await scanProject(name);
  if (!project || !project.config) {
    return c.json({ error: "Project not found" }, 404);
  }

  await deleteMigrationFile(project.path, project.config, filename);
  return c.json({ data: { deleted: true } });
});
