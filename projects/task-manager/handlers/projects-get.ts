/**
 * Handler: GET /api/projects/:id
 * Spec: specs/projects/get.md
 *
 * Returns a single project with task counts. Owner or admin only.
 */

import type { RouteHandler } from "../../../src/tools/registry.js";
import type { RequestContext } from "../../../src/agent/prompt-assembler.js";
import type { AgentResponse } from "../../../src/agent/response-parser.js";
import type { ToolRegistry } from "../../../src/tools/registry.js";
import { unauthorized, forbidden, notFound, badRequest, dbQuery } from "./shared.js";

const handler: RouteHandler = {
  description: "Get a single project with task counts — owner or admin only",

  async execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse> {
    if (!ctx.auth.authenticated) return unauthorized();

    const projectId = ctx.path_params["id"];
    if (!projectId) return badRequest("Missing project id");

    // 1. Query the project
    const projectResult = await dbQuery(
      tools,
      `SELECT id, name, description, owner_id, status, created_at, updated_at
       FROM projects
       WHERE id = ? AND deleted_at IS NULL`,
      [projectId]
    );

    if (projectResult.row_count === 0) return notFound("Project not found");

    const project = projectResult.rows[0]!;

    // 2. Authorization: admin or owner
    if (ctx.auth.role !== "admin" && project["owner_id"] !== ctx.auth.user_id) {
      return forbidden();
    }

    // 3. Task counts
    const countsResult = await dbQuery(
      tools,
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) as todo,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done
       FROM tasks
       WHERE project_id = ? AND deleted_at IS NULL`,
      [projectId]
    );

    const counts = countsResult.rows[0] ?? { total: 0, todo: 0, in_progress: 0, done: 0 };

    return {
      status: 200,
      headers: {},
      body: {
        data: {
          ...project,
          task_counts: {
            total: Number(counts["total"] ?? 0),
            todo: Number(counts["todo"] ?? 0),
            in_progress: Number(counts["in_progress"] ?? 0),
            done: Number(counts["done"] ?? 0),
          },
        },
      },
    };
  },
};

export default handler;
