/**
 * Handler: GET /api/projects/:project_id/tasks
 * Spec: specs/tasks/list.md
 *
 * Paginated task list with status/priority/assignee filters.
 * Requires project membership (admin, owner, or assignee).
 */

import type { RouteHandler } from "../../../src/tools/registry.js";
import type { RequestContext } from "../../../src/agent/prompt-assembler.js";
import type { AgentResponse } from "../../../src/agent/response-parser.js";
import type { ToolRegistry } from "../../../src/tools/registry.js";
import { unauthorized, forbidden, notFound, badRequest, dbQuery, parsePositiveInt } from "./shared.js";

const handler: RouteHandler = {
  description: "List tasks in a project — paginated with status/priority/assignee filters",

  async execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse> {
    if (!ctx.auth.authenticated) return unauthorized();

    const projectId = ctx.path_params["project_id"];
    if (!projectId) return badRequest("Missing project_id");

    // Pagination
    const page = parsePositiveInt(ctx.query_params["page"], 1, 1, Number.MAX_SAFE_INTEGER);
    if (page === null) return badRequest("page must be a positive integer", "page");

    const perPage = parsePositiveInt(ctx.query_params["per_page"], 20, 1, 100);
    if (perPage === null) return badRequest("per_page must be between 1 and 100", "per_page");

    // Optional filters — validate enum values
    const status = ctx.query_params["status"] ?? null;
    if (status !== null && !["todo", "in_progress", "done"].includes(status)) {
      return badRequest("status must be one of: todo, in_progress, done", "status");
    }

    const priority = ctx.query_params["priority"] ?? null;
    if (priority !== null && !["low", "medium", "high"].includes(priority)) {
      return badRequest("priority must be one of: low, medium, high", "priority");
    }

    const assigneeId = ctx.query_params["assignee_id"] ?? null;

    const offset = (page - 1) * perPage;

    // 1. Verify project exists
    const projectResult = await dbQuery(
      tools,
      `SELECT id, owner_id FROM projects WHERE id = ? AND deleted_at IS NULL`,
      [projectId]
    );
    if (projectResult.row_count === 0) return notFound("Project not found");

    const project = projectResult.rows[0]!;

    // 2. Authorization: admin, owner, or assigned to a task in this project
    if (ctx.auth.role !== "admin" && project["owner_id"] !== ctx.auth.user_id) {
      const memberResult = await dbQuery(
        tools,
        `SELECT 1 FROM tasks WHERE project_id = ? AND assignee_id = ? AND deleted_at IS NULL LIMIT 1`,
        [projectId, ctx.auth.user_id]
      );
      if (memberResult.row_count === 0) return forbidden();
    }

    // 3. Query tasks with optional filters
    const dataResult = await dbQuery(
      tools,
      `SELECT t.id, t.title, t.description, t.status, t.priority,
              t.assignee_id, u.name as assignee_name,
              t.due_date, t.created_at, t.updated_at
       FROM tasks t
       LEFT JOIN users u ON t.assignee_id = u.id
       WHERE t.project_id = ?
         AND t.deleted_at IS NULL
         AND (? IS NULL OR t.status = ?)
         AND (? IS NULL OR t.priority = ?)
         AND (? IS NULL OR t.assignee_id = ?)
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [projectId, status, status, priority, priority, assigneeId, assigneeId, perPage, offset]
    );

    // 4. Count with same filters
    const countResult = await dbQuery(
      tools,
      `SELECT COUNT(*) as total
       FROM tasks t
       WHERE t.project_id = ?
         AND t.deleted_at IS NULL
         AND (? IS NULL OR t.status = ?)
         AND (? IS NULL OR t.priority = ?)
         AND (? IS NULL OR t.assignee_id = ?)`,
      [projectId, status, status, priority, priority, assigneeId, assigneeId]
    );

    const total = Number((countResult.rows[0] as { total: number })?.total ?? 0);

    return {
      status: 200,
      headers: {},
      body: {
        data: dataResult.rows,
        meta: { page, per_page: perPage, total },
      },
    };
  },
};

export default handler;
