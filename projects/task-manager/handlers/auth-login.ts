/**
 * Route: POST /api/auth/login
 * Spec: auth/login.md
 */

import type { RouteHandler } from "../../../src/tools/registry.js";
import type { RequestContext } from "../../../src/agent/prompt-assembler.js";
import type { AgentResponse } from "../../../src/agent/response-parser.js";
import type { ToolRegistry } from "../../../src/tools/registry.js";
import { unauthorized, badRequest, dbQuery } from "./shared.js";

const handler: RouteHandler = {
  description: "Authenticate a user with email and password, returning a JWT token",

  async execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse> {
    const body = ctx.body as Record<string, unknown> | undefined;

    const email = typeof body?.["email"] === "string" ? body["email"].trim() : undefined;
    const password = typeof body?.["password"] === "string" ? body["password"] : undefined;

    // Step 1: Validate presence of email and password
    if (!email || !password) {
      return badRequest("email and password are required");
    }

    // Step 2: Query user by email
    const userResult = await dbQuery(
      tools,
      `SELECT id, email, name, role, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email]
    );

    if (userResult.row_count === 0 || !userResult.rows[0]) {
      return unauthorized();
    }

    const user = userResult.rows[0];

    // Step 3: Verify password
    const verifyResult = await tools.tools["crypto_verify_password"]!.execute({
      password,
      hash: user["password_hash"] as string,
    }) as { valid: boolean };

    if (!verifyResult.valid) {
      return unauthorized();
    }

    // Step 4: Generate JWT token
    const jwtResult = await tools.tools["crypto_jwt_sign"]!.execute({
      payload: {
        sub: user["id"] as string,
        role: user["role"] as string,
      },
      expires_in_seconds: 86400,
    }) as { token: string };

    // Step 5: Return 200 with user data and token
    return {
      status: 200,
      headers: {},
      body: {
        data: {
          user: {
            id: user["id"],
            email: user["email"],
            name: user["name"],
            role: user["role"],
          },
          token: jwtResult.token,
        },
      },
    };
  },
};

export default handler;