/**
 * Route: POST /api/projects
 * Spec: projects/create.md
 */

import type { RouteHandler } from "../../../src/tools/registry.js";
import type { RequestContext } from "../../../src/agent/prompt-assembler.js";
import type { AgentResponse } from "../../../src/agent/response-parser.js";
import type { ToolRegistry } from "../../../src/tools/registry.js";
import { unauthorized, badRequest, dbQuery } from "./shared.js";

const handler: RouteHandler = {
  description: "Create a new project for the authenticated user",

  async execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse> {
    // Check authentication
    if (!ctx.auth.authenticated || !ctx.auth.user_id) {
      return unauthorized();
    }

    const body = ctx.body as Record<string, unknown> | undefined;

    // Step 1: Validate input
    const rawName = typeof body?.["name"] === "string" ? body["name"].trim() : undefined;
    const rawDescription =
      typeof body?.["description"] === "string" ? body["description"].trim() : undefined;

    const fieldErrors: { field: string; message: string }[] = [];

    if (!rawName || rawName.length === 0) {
      fieldErrors.push({ field: "name", message: "is required" });
    } else if (rawName.length > 100) {
      fieldErrors.push({ field: "name", message: "must be 100 characters or fewer" });
    }

    if (rawDescription !== undefined && rawDescription.length > 2000) {
      fieldErrors.push({ field: "description", message: "must be 2000 characters or fewer" });
    }

    if (fieldErrors.length > 0) {
      return {
        status: 400,
        headers: {},
        body: {
          error: {
            code: "validation_error",
            message: "Request validation failed",
            details: { fields: fieldErrors },
          },
        },
      };
    }

    const name = rawName!;
    const description = rawDescription ?? null;
    const ownerId = ctx.auth.user_id;

    // Step 2: Check for duplicate project name for this user
    const duplicateResult = await dbQuery(
      tools,
      `SELECT id FROM projects WHERE owner_id = $1 AND name = $2 AND deleted_at IS NULL`,
      [ownerId, name]
    );

    if (duplicateResult.row_count > 0) {
      return {
        status: 409,
        headers: {},
        body: {
          error: {
            code: "conflict",
            message: "You already have a project with this name",
          },
        },
      };
    }

    // Step 3: Generate UUID and get current timestamp
    const uuidResult = await tools.tools["crypto_generate_token"]!.execute({
      type: "uuid",
    }) as { token: string };

    const projectId = uuidResult.token;

    const timeResult = await tools.tools["time_now"]!.execute({}) as { iso: string };
    const now = timeResult.iso;

    // Step 4: Insert the project
    await tools.tools["database_execute"]!.execute({
      sql: `INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $5)`,
      params: [projectId, name, description, ownerId, now],
    });

    // Step 5: Query the inserted project back
    const projectResult = await dbQuery(
      tools,
      `SELECT id, name, description, owner_id, status, created_at, updated_at FROM projects WHERE id = $1`,
      [projectId]
    );

    const project = projectResult.rows[0];

    // Step 6: Return 201 with the created project
    return {
      status: 201,
      headers: {},
      body: {
        data: {
          id: project["id"],
          name: project["name"],
          description: project["description"] ?? null,
          owner_id: project["owner_id"],
          status: project["status"],
          created_at: project["created_at"],
          updated_at: project["updated_at"],
        },
      },
    };
  },
};

export default handler;