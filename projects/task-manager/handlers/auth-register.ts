/**
 * Handler: POST /api/auth/register
 * Spec: specs/auth/register.md
 *
 * Registers a new user account and returns a signed JWT.
 */

import type { RouteHandler, ToolRegistry } from "../../../src/tools/registry.js";
import type { RequestContext } from "../../../src/agent/prompt-assembler.js";
import type { AgentResponse } from "../../../src/agent/response-parser.js";
import { badRequest, dbQuery } from "./shared.js";

const handler: RouteHandler = {
  description: "Register — create a new user account and return JWT token",

  async execute(ctx: RequestContext, tools: ToolRegistry): Promise<AgentResponse> {
    const body = (ctx.body as Record<string, unknown> | null) ?? {};

    // ── 1. Validate input ──────────────────────────────────────────────────────

    const fieldErrors: { field: string; message: string }[] = [];

    const rawEmail = typeof body["email"] === "string" ? body["email"].trim() : null;
    const rawName = typeof body["name"] === "string" ? body["name"].trim() : null;
    const rawPassword = typeof body["password"] === "string" ? body["password"] : null;

    if (!rawEmail) {
      fieldErrors.push({ field: "email", message: "is required" });
    } else {
      // Validate email format
      const emailValidResult = await tools.tools["validate_email"]?.execute({ email: rawEmail }) as { valid: boolean } | undefined;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const isValidEmail = emailValidResult ? emailValidResult.valid : emailRegex.test(rawEmail);
      if (!isValidEmail) {
        fieldErrors.push({ field: "email", message: "must be a valid email address" });
      }
    }

    if (!rawName) {
      fieldErrors.push({ field: "name", message: "is required" });
    } else if (rawName.length < 1 || rawName.length > 200) {
      fieldErrors.push({ field: "name", message: "must be between 1 and 200 characters" });
    }

    if (!rawPassword) {
      fieldErrors.push({ field: "password", message: "is required" });
    } else if (rawPassword.length < 8) {
      fieldErrors.push({ field: "password", message: "must be at least 8 characters" });
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

    const email = rawEmail!;
    const name = rawName!;
    const password = rawPassword!;

    // ── 2. Check for existing user ─────────────────────────────────────────────

    const existingResult = await dbQuery(
      tools,
      `SELECT id FROM users WHERE email = ? AND deleted_at IS NULL`,
      [email]
    );

    if (existingResult.row_count > 0) {
      return {
        status: 409,
        headers: {},
        body: {
          error: {
            code: "conflict",
            message: "A user with this email already exists",
          },
        },
      };
    }

    // ── 3. Hash the password ───────────────────────────────────────────────────

    const hashResult = await tools.tools["crypto_hash_password"]!.execute({
      password,
    }) as { hash: string };

    const passwordHash = hashResult.hash;

    // ── 4. Generate UUID and get current timestamp ─────────────────────────────

    const uuidResult = await tools.tools["crypto_generate_token"]!.execute({
      type: "uuid",
    }) as { value: string };

    const userId = uuidResult.value;

    const timeResult = await tools.tools["time_now"]!.execute({}) as { iso: string };
    const now = timeResult.iso;

    // ── 5. Insert the user ─────────────────────────────────────────────────────

    await tools.tools["database_execute"]!.execute({
      sql: `INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [userId, email, name, passwordHash, now, now],
    });

    // ── 6. Query back the user record ──────────────────────────────────────────

    const userResult = await dbQuery(
      tools,
      `SELECT id, email, name, role, created_at FROM users WHERE id = ?`,
      [userId]
    );

    const user = userResult.rows[0]!;

    // ── 7. Generate JWT token ──────────────────────────────────────────────────

    const jwtResult = await tools.tools["crypto_jwt_sign"]!.execute({
      payload: { sub: user["id"] as string, role: "member" },
      expires_in_seconds: 86400,
    }) as { token: string };

    // ── 8. Return 201 with user data and token ─────────────────────────────────

    return {
      status: 201,
      headers: {},
      body: {
        data: {
          user: {
            id: user["id"],
            email: user["email"],
            name: user["name"],
            role: user["role"],
            created_at: user["created_at"],
          },
          token: jwtResult.token,
        },
      },
    };
  },
};

export default handler;