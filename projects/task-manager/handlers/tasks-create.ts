/**
 * Handler: POST /api/projects/:project_id/tasks
 * Spec: specs/tasks/create.md
 *
 * Creates a task in a project. Owner or admin only; project must be active.
 */

import type { RouteHandler } from "../../../src/tools/registry.js";
import type { RequestContext } from "../../../src/agent/prompt-assembler.js";
import type { AgentResponse } from "../../../src/agent/response-parser.js";
import type { ToolRegistry } from "../../../src/tools/registry.js";
import { unauthorized, forbidden, notFound, badRequest, dbQuery } from "./shared.js";

const handler: RouteHandler = {
  description: "Create a task in a project — owner or admin only, project must be active",

  async execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse> {
    if (!ctx.auth.authenticated) return unauthorized();

    const projectId = ctx.path_params["project_id"];
    if (!projectId) return badRequest("Missing project_id");

    const body = (ctx.body as Record<string, unknown> | null) ?? {};

    // ── 1. Validate input ──────────────────────────────────────────────────────

    // title
    const rawTitle = typeof body["title"] === "string" ? body["title"].trim() : null;
    if (rawTitle === null || rawTitle === "") {
      return badRequest("title is required", "title");
    }
    if (rawTitle.length > 200) {
      return badRequest("title must be 200 characters or fewer", "title");
    }

    // description
    let description: string | null = null;
    if (body["description"] !== undefined && body["description"] !== null) {
      if (typeof body["description"] !== "string") {
        return badRequest("description must be a string", "description");
      }
      description = body["description"].trim();
      if (description.length > 5000) {
        return badRequest("description must be 5000 characters or fewer", "description");
      }
      if (description === "") description = null;
    }

    // priority
    const validPriorities = ["low", "medium", "high"];
    let priority = "medium";
    if (body["priority"] !== undefined && body["priority"] !== null) {
      if (typeof body["priority"] !== "string" || !validPriorities.includes(body["priority"])) {
        return badRequest("priority must be one of: low, medium, high", "priority");
      }
      priority = body["priority"];
    }

    // assignee_id
    let assigneeId: string | null = null;
    if (body["assignee_id"] !== undefined && body["assignee_id"] !== null) {
      if (typeof body["assignee_id"] !== "string") {
        return badRequest("assignee_id must be a valid UUID", "assignee_id");
      }
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(body["assignee_id"])) {
        return badRequest("assignee_id must be a valid UUID", "assignee_id");
      }
      assigneeId = body["assignee_id"];
    }

    // due_date (basic format validation — deeper check happens after time_now)
    let dueDate: string | null = null;
    if (body["due_date"] !== undefined && body["due_date"] !== null) {
      if (typeof body["due_date"] !== "string") {
        return badRequest("due_date must be a valid date (YYYY-MM-DD)", "due_date");
      }
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(body["due_date"])) {
        return badRequest("due_date must be a valid date (YYYY-MM-DD)", "due_date");
      }
      const parsed = new Date(body["due_date"]);
      if (isNaN(parsed.getTime())) {
        return badRequest("due_date must be a valid date (YYYY-MM-DD)", "due_date");
      }
      dueDate = body["due_date"];
    }

    // ── 2. Verify project exists and is active ─────────────────────────────────

    const projectResult = await dbQuery(
      tools,
      `SELECT id, owner_id, status FROM projects WHERE id = ? AND deleted_at IS NULL`,
      [projectId]
    );

    if (projectResult.row_count === 0) return notFound("Project not found");

    const project = projectResult.rows[0]!;

    if (project["status"] === "archived") {
      return badRequest("Cannot add tasks to an archived project");
    }

    // ── 3. Authorization: owner or admin ───────────────────────────────────────

    if (ctx.auth.role !== "admin" && project["owner_id"] !== ctx.auth.user_id) {
      return forbidden();
    }

    // ── 4. Validate assignee if provided ───────────────────────────────────────

    if (assigneeId !== null) {
      // Check user exists
      const userResult = await dbQuery(
        tools,
        `SELECT id FROM users WHERE id = ? AND deleted_at IS NULL`,
        [assigneeId]
      );
      if (userResult.row_count === 0) {
        return badRequest("Assignee not found", "assignee_id");
      }

      // Check project membership (owner is always valid)
      if (assigneeId !== project["owner_id"]) {
        const memberResult = await dbQuery(
          tools,
          `SELECT 1 FROM tasks WHERE project_id = ? AND assignee_id = ? AND deleted_at IS NULL LIMIT 1`,
          [projectId, assigneeId]
        );
        if (memberResult.row_count === 0) {
          return badRequest("Assignee is not a project member", "assignee_id");
        }
      }
    }

    // ── 5. Validate due_date against today ─────────────────────────────────────

    if (dueDate !== null) {
      const nowResult = await tools.tools["time_now"]!.execute({ format: "iso" }) as { result: string };
      const todayStr = nowResult.result.substring(0, 10); // YYYY-MM-DD
      if (dueDate < todayStr) {
        return badRequest("Due date must be today or in the future", "due_date");
      }
    }

    // ── 6. Generate UUID and timestamp ────────────────────────────────────────

    const uuidResult = await tools.tools["crypto_generate_token"]!.execute({ type: "uuid" }) as { result: string };
    const taskId = uuidResult.result;

    const timeResult = await tools.tools["time_now"]!.execute({ format: "iso" }) as { result: string };
    const now = timeResult.result;

    // ── 7. Insert the task ────────────────────────────────────────────────────

    await tools.tools["database_execute"]!.execute({
      sql: `INSERT INTO tasks (id, project_id, title, description, priority, assignee_id, due_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [taskId, projectId, rawTitle, description, priority, assigneeId, dueDate, now, now],
    });

    // ── 8. Query the inserted task back ───────────────────────────────────────

    const taskResult = await dbQuery(
      tools,
      `SELECT id, project_id, title, description, status, priority, assignee_id, due_date, created_at, updated_at
       FROM tasks WHERE id = ?`,
      [taskId]
    );

    const task = taskResult.rows[0]!;

    // ── 9. Fetch assignee name if applicable ──────────────────────────────────

    let assigneeName: string | null = null;
    if (assigneeId !== null) {
      const assigneeResult = await dbQuery(
        tools,
        `SELECT name FROM users WHERE id = ?`,
        [assigneeId]
      );
      if (assigneeResult.row_count > 0) {
        assigneeName = assigneeResult.rows[0]!["name"] as string;
      }
    }

    // ── 10. Return 201 ────────────────────────────────────────────────────────

    return {
      status: 201,
      headers: {},
      body: {
        data: {
          ...task,
          assignee_name: assigneeName,
        },
      },
    };
  },
};

export default handler;
