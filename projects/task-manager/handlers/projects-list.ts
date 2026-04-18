/**
 * Route: GET /api/projects
 * Spec: projects/list.md
 */

import type { RouteHandler } from "../../../src/tools/registry.js";
import type { RequestContext } from "../../../src/agent/prompt-assembler.js";
import type { AgentResponse } from "../../../src/agent/response-parser.js";
import type { ToolRegistry } from "../../../src/tools/registry.js";
import {
  unauthorized,
  badRequest,
  dbQuery,
  parsePositiveInt,
} from "./shared.js";

const handler: RouteHandler = {
  description: "List projects with pagination and optional status filter",

  async execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse> {
    // Auth check
    if (!ctx.auth.authenticated) {
      return unauthorized();
    }

    const userId = ctx.auth.user_id!;
    const role = ctx.auth.role!;

    // Parse pagination
    const pageParam = ctx.query_params?.["page"];
    const perPageParam = ctx.query_params?.["per_page"];
    const statusParam = ctx.query_params?.["status"];

    const page = parsePositiveInt(pageParam, 1, 1, Number.MAX_SAFE_INTEGER);
    if (page === null) {
      return badRequest("page must be a positive integer", "page");
    }

    const perPage = parsePositiveInt(perPageParam, 20, 1, 100);
    if (perPage === null) {
      return badRequest("per_page must be between 1 and 100", "per_page");
    }

    // Validate status filter
    let statusFilter: string | null = null;
    if (statusParam !== undefined && statusParam !== "") {
      if (statusParam !== "active" && statusParam !== "archived") {
        return badRequest('status must be "active" or "archived"', "status");
      }
      statusFilter = statusParam;
    }

    const offset = (page - 1) * perPage;

    let dataResult: { rows: Record<string, unknown>[]; row_count: number };
    let countResult: { rows: Record<string, unknown>[]; row_count: number };

    if (role === "admin") {
      // Admin sees all projects
      dataResult = await dbQuery(
        tools,
        `SELECT id, name, description, owner_id, status, created_at, updated_at
         FROM projects
         WHERE deleted_at IS NULL
           AND ($1 IS NULL OR status = $1)
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [statusFilter, perPage, offset]
      );

      countResult = await dbQuery(
        tools,
        `SELECT COUNT(*) as total
         FROM projects
         WHERE deleted_at IS NULL
           AND ($1 IS NULL OR status = $1)`,
        [statusFilter]
      );
    } else {
      // Member sees only their own projects
      dataResult = await dbQuery(
        tools,
        `SELECT id, name, description, owner_id, status, created_at, updated_at
         FROM projects
         WHERE owner_id = $1
           AND deleted_at IS NULL
           AND ($2 IS NULL OR status = $2)
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [userId, statusFilter, perPage, offset]
      );

      countResult = await dbQuery(
        tools,
        `SELECT COUNT(*) as total
         FROM projects
         WHERE owner_id = $1
           AND deleted_at IS NULL
           AND ($2 IS NULL OR status = $2)`,
        [userId, statusFilter]
      );
    }

    const total = Number(countResult.rows[0]?.["total"] ?? 0);

    return {
      status: 200,
      headers: {},
      body: {
        data: dataResult.rows,
        meta: {
          page,
          per_page: perPage,
          total,
        },
      },
    };
  },
};

export default handler;