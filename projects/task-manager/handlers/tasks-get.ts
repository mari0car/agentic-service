/**
 * Handler: GET /api/projects/:project_id/tasks/:id
 * Spec: specs/tasks/get.md
 *
 * Returns a single task with assignee info.
 * Requires project membership (admin, owner, or any assignee in the project).
 */

import type { RouteHandler } from "../../../src/tools/registry.js";
import type { RequestContext } from "../../../src/agent/prompt-assembler.js";
import type { AgentResponse } from "../../../src/agent/response-parser.js";
import type { ToolRegistry } from "../../../src/tools/registry.js";
import { unauthorized, forbidden, notFound, badRequest, dbQuery } from "./shared.js";

const handler: RouteHandler = {
  description: "Get a single task with assignee info — project member access only",

  async execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse> {
    if (!ctx.auth.authenticated) return unauthorized();

    const projectId = ctx.path_params["project_id"];
    const taskId = ctx.path_params["id"];
    if (!projectId || !taskId) return badRequest("Missing path parameters");

    // 1. Query task with assignee (LEFT JOIN)
    const taskResult = await dbQuery(
      tools,
      `SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
              t.assignee_id, u.name as assignee_name, u.email as assignee_email,
              t.due_date, t.created_at, t.updated_at
       FROM tasks t
       LEFT JOIN users u ON t.assignee_id = u.id
       WHERE t.id = ? AND t.project_id = ? AND t.deleted_at IS NULL`,
      [taskId, projectId]
    );

    if (taskResult.row_count === 0) return notFound("Task not found");

    // 2. Verify project exists
    const projectResult = await dbQuery(
      tools,
      `SELECT id, owner_id FROM projects WHERE id = ? AND deleted_at IS NULL`,
      [projectId]
    );
    if (projectResult.row_count === 0) return notFound("Project not found");

    const project = projectResult.rows[0]!;

    // 3. Authorization: admin, owner, or assigned to any task in this project
    if (ctx.auth.role !== "admin" && project["owner_id"] !== ctx.auth.user_id) {
      const memberResult = await dbQuery(
        tools,
        `SELECT 1 FROM tasks WHERE project_id = ? AND assignee_id = ? AND deleted_at IS NULL LIMIT 1`,
        [projectId, ctx.auth.user_id]
      );
      if (memberResult.row_count === 0) return forbidden();
    }

    return {
      status: 200,
      headers: {},
      body: { data: taskResult.rows[0] },
    };
  },
};

export default handler;
