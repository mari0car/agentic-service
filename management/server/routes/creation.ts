import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { fromIni } from "@aws-sdk/credential-providers";
import { streamText, tool, stepCountIs } from "ai";
import { z } from "zod";

function createModel() {
  const bedrock = createAmazonBedrock({
    region: process.env.AWS_REGION || "eu-central-1",
    credentialProvider: fromIni({
      profile: process.env.AWS_PROFILE || "bedrock",
    }),
  });
  return bedrock(process.env.AGENTIC_LLM_MODEL || "eu.anthropic.claude-sonnet-4-6");
}
import {
  listProjects,
  getExamplesDir,
  readProjectFile,
  writeProjectFile,
} from "../services/project-scanner.js";
import type {
  CreationSession,
  ChatMessage,
  ProposedFile,
} from "../types.js";

export const creationRoutes = new Hono();

// In-memory session storage
const sessions = new Map<string, CreationSession>();

// Create a new creation session
creationRoutes.post("/sessions", async (c) => {
  const id = randomUUID();
  const session: CreationSession = {
    id,
    messages: [],
    proposedFiles: [],
    status: "active",
    createdAt: new Date().toISOString(),
  };
  sessions.set(id, session);
  return c.json({ data: session });
});

// Get session state
creationRoutes.get("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const session = sessions.get(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  return c.json({ data: session });
});

// List all active sessions
creationRoutes.get("/sessions", async (c) => {
  const allSessions = Array.from(sessions.values()).filter(
    (s) => s.status === "active"
  );
  return c.json({ data: allSessions });
});

// Send a message and get streaming response
creationRoutes.post("/sessions/:id/messages", async (c) => {
  const id = c.req.param("id");
  const session = sessions.get(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  if (session.status !== "active") {
    return c.json({ error: "Session is no longer active" }, 400);
  }

  const body = await c.req.json<{ content: string }>();
  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: body.content,
    timestamp: new Date().toISOString(),
  };
  session.messages.push(userMessage);

  // Build context from existing projects
  const existingProjects = await listProjects();
  const projectSummaries = existingProjects.map((p) => ({
    name: p.name,
    description: p.description,
    routes: p.routes,
    specFiles: p.specFiles,
    globalSpecs: p.globalSpecs,
    migrationFiles: p.migrationFiles,
    config: p.config
      ? {
          llm: p.config.llm,
          database: p.config.database,
          server: p.config.server,
        }
      : null,
  }));

  const systemPrompt = buildSystemPrompt(projectSummaries, session);

  const messages = session.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  return streamSSE(c, async (stream) => {
    let fullResponse = "";

    try {
      const result = streamText({
        model: createModel() as any,
        system: systemPrompt,
        messages,
        tools: {
          read_example_file: tool({
            description:
              "Read a file from an existing example project to understand its patterns",
            inputSchema: z.object({
              project: z.string().describe("The example project name"),
              filePath: z
                .string()
                .describe("Path relative to the project directory"),
            }),
            execute: async ({ project, filePath }) => {
              try {
                const examplesDir = await getExamplesDir();
                const projectPath = path.join(examplesDir, project);
                const content = await readProjectFile(projectPath, filePath);
                return { success: true, content };
              } catch {
                return { success: false, error: "File not found" };
              }
            },
          }),

          list_example_projects: tool({
            description:
              "List all existing example projects with their structure",
            inputSchema: z.object({}),
            execute: async () => {
              return { projects: projectSummaries };
            },
          }),

          propose_file: tool({
            description:
              "Propose a file to be created in the new project. The file will be shown in a preview panel for the user to review.",
            inputSchema: z.object({
              path: z
                .string()
                .describe(
                  "File path relative to the project directory (e.g. 'config.yaml', 'specs/service.md', 'migrations/001_create_users.sql')"
                ),
              content: z.string().describe("The full content of the file"),
              language: z
                .string()
                .describe(
                  "The language/format for syntax highlighting (e.g. 'yaml', 'markdown', 'sql', 'typescript')"
                ),
              description: z
                .string()
                .optional()
                .describe("Brief description of what this file does"),
            }),
            execute: async ({ path: filePath, content, language, description }) => {
              // Remove existing proposal for this path if it exists
              session.proposedFiles = session.proposedFiles.filter(
                (f) => f.path !== filePath
              );
              session.proposedFiles.push({
                path: filePath,
                content,
                language,
                description,
              });
              return {
                success: true,
                message: `File "${filePath}" has been proposed. The user can see it in the preview panel.`,
              };
            },
          }),

          update_proposed_file: tool({
            description: "Update a previously proposed file",
            inputSchema: z.object({
              path: z.string().describe("Path of the file to update"),
              content: z.string().describe("The updated content"),
            }),
            execute: async ({ path: filePath, content }) => {
              const file = session.proposedFiles.find(
                (f) => f.path === filePath
              );
              if (!file) {
                return { success: false, error: "File not found in proposals" };
              }
              file.content = content;
              return { success: true, message: `File "${filePath}" updated.` };
            },
          }),

          set_project_name: tool({
            description: "Set the name of the project being created",
            inputSchema: z.object({
              name: z
                .string()
                .describe(
                  "Project name (lowercase, hyphens, e.g. 'inventory-tracker')"
                ),
            }),
            execute: async ({ name }) => {
              session.projectName = name;
              return {
                success: true,
                message: `Project name set to "${name}"`,
              };
            },
          }),
        },
        stopWhen: stepCountIs(15),
      });

      for await (const part of result.textStream) {
        fullResponse += part;
        await stream.writeSSE({
          data: JSON.stringify({ type: "text", content: part }),
          event: "message",
        });
      }

      // Send proposed files update
      await stream.writeSSE({
        data: JSON.stringify({
          type: "files",
          files: session.proposedFiles,
          projectName: session.projectName,
        }),
        event: "message",
      });

      // Send done event
      await stream.writeSSE({
        data: JSON.stringify({ type: "done" }),
        event: "message",
      });

      // Store the assistant message
      const assistantMessage: ChatMessage = {
        id: randomUUID(),
        role: "assistant",
        content: fullResponse,
        timestamp: new Date().toISOString(),
      };
      session.messages.push(assistantMessage);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "LLM request failed";
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", content: errorMsg }),
        event: "message",
      });
    }
  });
});

// Apply the proposed files - create the project on disk
creationRoutes.post("/sessions/:id/apply", async (c) => {
  const id = c.req.param("id");
  const session = sessions.get(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  if (!session.projectName) {
    return c.json({ error: "Project name not set" }, 400);
  }
  if (session.proposedFiles.length === 0) {
    return c.json({ error: "No files proposed" }, 400);
  }

  const examplesDir = await getExamplesDir();
  const projectDir = path.join(examplesDir, session.projectName);

  // Check if directory already exists
  try {
    await fs.access(projectDir);
    return c.json(
      { error: `Project directory "${session.projectName}" already exists` },
      409
    );
  } catch {
    // Good - doesn't exist yet
  }

  // Write all proposed files
  await fs.mkdir(projectDir, { recursive: true });

  for (const file of session.proposedFiles) {
    await writeProjectFile(projectDir, file.path, file.content);
  }

  session.status = "applied";

  return c.json({
    data: {
      projectName: session.projectName,
      filesWritten: session.proposedFiles.length,
      path: projectDir,
    },
  });
});

// Discard a session
creationRoutes.delete("/sessions/:id", async (c) => {
  const id = c.req.param("id");
  const session = sessions.get(id);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  session.status = "discarded";
  sessions.delete(id);
  return c.json({ data: { discarded: true } });
});

function buildSystemPrompt(
  existingProjects: unknown[],
  session: CreationSession
): string {
  return `You are an expert assistant helping users create new Agentic Service projects. Agentic Service is a framework where backend business logic is defined in plain-language markdown specification files, and an LLM interprets those specs at runtime to handle API requests.

## Your Role
Guide the user step-by-step through creating a new project. Be conversational, ask clarifying questions, and make suggestions based on existing project patterns.

## Existing Projects
Here are the existing example projects for reference:
${JSON.stringify(existingProjects, null, 2)}

## Project Structure
Every Agentic Service project needs:
1. **config.yaml** - Service configuration (LLM provider, database, specs directory, auth, logging)
2. **specs/** directory containing:
   - **api-routes.md** - Maps HTTP routes to spec files
   - **Global spec files** (service.md, domain.md, data-model.md, error-handling.md, auth-policies.md)
   - **Endpoint spec files** in subdirectories (e.g., auth/register.md, tasks/create.md)
3. **migrations/** directory with numbered SQL files (001_create_*.sql, etc.)
4. **package.json** - Project dependencies and scripts
5. **tsconfig.json** - TypeScript configuration
6. **index.ts** - Entry point (library mode)
7. **.env.example** - Environment variable template

## Spec File Format
Each endpoint spec file has YAML frontmatter and markdown body:
\`\`\`markdown
---
route: POST /api/items
auth: required
---
# Create Item
## Endpoint
POST /api/items
## Input
- title (string, required)
- description (string, optional)
## Logic
1. Validate input...
2. Insert into database...
## Success Response (201)
{ "data": { "id": "...", ... } }
\`\`\`

## Important Guidelines
- Use the \`read_example_file\` tool to look at existing project files when you need to see exact patterns
- Use \`propose_file\` to create each file - the user sees them in real-time in a preview panel
- Use \`set_project_name\` once the user has confirmed a name
- Start by understanding what the user wants to build
- Suggest a domain model based on their description
- Help design the database schema (with proper indexes, foreign keys, soft deletes)
- Design the API routes (RESTful patterns)
- Create comprehensive spec files that the LLM can interpret correctly
- Include proper error handling, validation, and auth in specs
- Use SQLite as the default database driver (easy to get started)
- Follow the patterns from existing projects closely

## Current Session State
${session.projectName ? `Project name: ${session.projectName}` : "Project name: not yet set"}
Files proposed so far: ${session.proposedFiles.map((f) => f.path).join(", ") || "none"}

Be concise but thorough. After understanding the user's needs, propose files in a logical order: config.yaml first, then domain/service specs, then database migrations, then API routes, then individual endpoint specs.`;
}
