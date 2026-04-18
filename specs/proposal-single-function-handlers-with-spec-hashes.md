# Single-Function Handlers with Spec Hashes

## The Core Idea in One Sentence

Every markdown spec compiles to exactly one pure JavaScript function that a dev-side LLM generates and continuously maintains; production is a directory of these functions served by a minimal hash-map router, where each function embeds a cryptographic hash of the spec it was generated from so it can self-detect staleness and fail loudly instead of silently.

---

## Why This Idea Exists

Agentic-service today has two execution paths:

1. **Cold path** -- an LLM reads the spec at runtime, calls tools, and assembles a response. Correct but slow (~2-5s), expensive (tokens), and non-deterministic.
2. **Hot path** -- a hand-authored TypeScript handler (`RouteHandler`) runs instead. Fast (<50ms), deterministic, free. But someone has to write and maintain it by hand.

The hot path already proves the key insight: **once you know what the LLM would do, you do not need the LLM.** Today the hot-path handlers are written by humans. MI3 asks: what if the LLM on the dev machine writes and maintains them instead, and production never needs an LLM at all?

---

## Two Systems

```
+------------------------------------------+     +----------------------------------+
|          DEVELOPMENT MACHINE              |     |       PRODUCTION RUNTIME          |
|                                           |     |                                  |
|  specs/*.md  -- source of truth           |     |  handlers/*.mjs  -- artifacts    |
|      |                                    |     |      |                           |
|      v                                    |     |      v                           |
|  [LLM Generator]                          |     |  [Hash-Map Router]               |
|      |                                    |     |      |                           |
|      +---> handler.mjs  (pure function)   |---->|  request -> match -> execute     |
|      +---> handler.test.mjs (shadow test) |     |      |                           |
|      |                                    |     |  if hash diverges -> 503 Stale   |
|  [Shadow Verifier]                        |     |                                  |
|      compares handler output vs LLM       |     |  Zero LLM dependency             |
|      on synthetic + real requests         |     |  Zero token cost                 |
|                                           |     |  Deterministic                   |
+------------------------------------------+     +----------------------------------+
```

**Development machine** has full LLM access. It reads specs, generates handler functions, verifies them via shadow testing, and pushes artifacts to production.

**Production runtime** has zero LLM dependency. It loads a directory of `.mjs` files, routes requests to them, and serves responses. If a function's embedded hash does not match the current spec, it returns 503 instead of executing stale logic.

---

## The Artifact: One Pure Function Per Spec

Each spec compiles to a single `.mjs` file that exports one async function. The function has the exact same shape as today's `RouteHandler.execute`:

```typescript
// handlers/tasks/create.mjs
// 
// Generated from: specs/tasks/create.md
// Spec hash: sha256:a7f3e2...b4c1d9
// Generated at: 2026-04-16T08:44:15Z

const SPEC_HASH = "sha256:a7f3e2d8c5b9a1f0e3d7c6b8a4f2e1d0c9b8a7f6e5d4c3b2a1f0e3d7c6b4c1d9";

export default {
  description: "Create a task in a project",
  specHash: SPEC_HASH,

  async execute(ctx, tools) {
    // Authentication
    if (!ctx.auth.authenticated) {
      return { status: 401, headers: {}, body: { error: { code: "unauthorized", message: "Authentication required" } } };
    }

    const projectId = ctx.path_params["project_id"];
    if (!projectId) {
      return { status: 400, headers: {}, body: { error: { code: "validation_error", message: "Missing project_id" } } };
    }

    const body = ctx.body ?? {};

    // 1. Validate input
    const rawTitle = typeof body["title"] === "string" ? body["title"].trim() : null;
    if (rawTitle === null || rawTitle === "") {
      return { status: 400, headers: {}, body: { error: { code: "validation_error", message: "title is required", field: "title" } } };
    }
    if (rawTitle.length > 200) {
      return { status: 400, headers: {}, body: { error: { code: "validation_error", message: "title must be 200 characters or fewer", field: "title" } } };
    }

    // ... (full validation for description, priority, assignee_id, due_date)

    // 2. Verify project exists and is active
    const projectResult = await tools.tools["database_query"].execute({
      sql: "SELECT id, owner_id, status FROM projects WHERE id = ? AND deleted_at IS NULL",
      params: [projectId],
    });
    if (projectResult.row_count === 0) {
      return { status: 404, headers: {}, body: { error: { code: "not_found", message: "Project not found" } } };
    }
    const project = projectResult.rows[0];
    if (project["status"] === "archived") {
      return { status: 400, headers: {}, body: { error: { code: "validation_error", message: "Cannot add tasks to an archived project" } } };
    }

    // 3. Authorization
    if (ctx.auth.role !== "admin" && project["owner_id"] !== ctx.auth.user_id) {
      return { status: 403, headers: {}, body: { error: { code: "forbidden", message: "Not authorized" } } };
    }

    // 4. Validate assignee (if provided) ...
    // 5. Validate due_date ...
    // 6. Generate UUID and timestamp
    const uuidResult = await tools.tools["crypto_generate_token"].execute({ type: "uuid" });
    const taskId = uuidResult.result;
    const timeResult = await tools.tools["time_now"].execute({ format: "iso" });
    const now = timeResult.result;

    // 7. Insert
    await tools.tools["database_execute"].execute({
      sql: `INSERT INTO tasks (id, project_id, title, description, priority, assignee_id, due_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [taskId, projectId, rawTitle, description, priority, assigneeId, dueDate, now, now],
    });

    // 8. Query back
    const taskResult = await tools.tools["database_query"].execute({
      sql: `SELECT id, project_id, title, description, status, priority, assignee_id, due_date, created_at, updated_at
            FROM tasks WHERE id = ?`,
      params: [taskId],
    });
    const task = taskResult.rows[0];

    // 9. Fetch assignee name if applicable ...

    // 10. Return 201
    return { status: 201, headers: {}, body: { data: { ...task, assignee_name: assigneeName } } };
  },
};
```

Notice: this is structurally identical to what exists today in `projects/task-manager/handlers/tasks-create.ts`. The difference is **who wrote it** (the dev-side LLM, not a human) and the embedded `SPEC_HASH` constant.

---

## The Production Runtime

Production is a lightweight server that does three things:

1. **Load** -- scan a directory of `.mjs` files, dynamically import each one
2. **Route** -- match incoming HTTP requests to handlers via a route manifest
3. **Guard** -- check spec hashes before executing, reject stale handlers

### Router Architecture

```
                         +--------------------+
                         |   Route Manifest   |
  HTTP Request -------->  | POST /api/...tasks |------> handlers/tasks/create.mjs
  GET /api/projects       | GET /api/projects  |------> handlers/projects/list.mjs
                         | ...                |
                         +--------------------+
                                  |
                           match found?
                          /            \
                        yes             no
                         |               |
                   hash check?        404
                   /         \
                 match      diverge
                  |           |
               execute      503 Stale
                  |         + X-Stale-Spec header
               response
```

The route manifest is derived from the same `api-routes.md` file that agentic-service already uses, but pointing to `.mjs` files instead of `.md` specs:

```
POST /api/projects/:project_id/tasks -> handlers/tasks/create.mjs
GET  /api/projects                   -> handlers/projects/list.mjs
GET  /api/projects/:id               -> handlers/projects/get.mjs
...
```

### The Hash Guard

This is the mechanism that makes the system self-aware of staleness. Before executing any handler, the runtime:

1. Reads the current spec file from a mounted `specs/` directory (or a manifest of spec hashes shipped alongside the handlers)
2. Computes `SHA-256(spec file content)`
3. Compares it against the handler's embedded `SPEC_HASH` constant
4. If they match: execute the handler normally
5. If they diverge: return `503 Service Unavailable` with:
   - `X-Stale-Spec: tasks/create.md` header
   - `X-Spec-Hash-Expected: sha256:a7f3e2...` header
   - Body: `{ "error": { "code": "stale_handler", "message": "Handler is out of date with its spec. Regeneration required." } }`

The 503 is deliberate. It means:

- **Loud failure** -- monitoring and health checks catch it immediately
- **Recoverable** -- the dev system sees the staleness signal and regenerates
- **Safe** -- stale logic never executes, never serves wrong data silently
- **Standard** -- 503 is the correct HTTP status for "temporarily unavailable"

### Comparison: What Happens Today vs MI3

| Scenario | Today (agentic-service) | MI3 |
|---|---|---|
| Handler matches spec | Hot path executes (fast, free) | Same -- handler executes |
| Spec changes, handler not updated | LLM fallback (slow, expensive) | 503 Stale -- loud failure |
| Handler has a bug | Shadow mode detects divergence | Shadow mode detects divergence (same) |
| Handler fails to load | Falls back to LLM | 503 -- no LLM to fall back to |
| No handler exists for a route | LLM serves it (cold path) | Build error -- every route must have a handler |

The key difference: today, the LLM is the safety net. In MI3, the LLM does not exist in production. The safety net is **refusing to serve stale logic** instead.

---

## The Development System

The dev side is where the LLM lives. It has three responsibilities:

### 1. Generation: Spec -> Handler

When a spec is created or modified, the dev system:

```
Read spec file (markdown)
     |
     v
Assemble prompt:
  - The spec content
  - The RequestContext type definition
  - The ToolRegistry interface (available tools)
  - The AgentResponse type (expected return shape)
  - The shared helpers pattern (unauthorized(), badRequest(), dbQuery())
  - Examples of existing handlers (few-shot)
     |
     v
LLM generates a complete handler function
     |
     v
Compute SHA-256 of the spec content
     |
     v
Embed the hash as a constant in the generated file
     |
     v
Write handlers/{route}.mjs
```

The generation prompt to the LLM would look roughly like:

```
You are generating a deterministic HTTP request handler from a markdown specification.

## Spec
{spec file content}

## Contract
- Input: a RequestContext object with { method, path, path_params, query_params, headers, body, auth, request_id }
- Available tools: database_query, database_execute, crypto_generate_token, crypto_hash, time_now, time_parse, validate_json_schema
- Output: { status: number, headers: Record<string, string>, body: unknown }

## Rules
- The handler must be a pure function of its inputs (request context + tool calls). No side effects beyond tool calls.
- All tool calls go through the tools parameter. Do not import external modules.
- Follow the spec exactly. Every validation, every error code, every response shape must match.
- Handle every error path described in the spec.

## Examples
{2-3 existing handler files as few-shot examples}

Generate a single default export implementing this spec.
```

### 2. Verification: Shadow Testing

After generating a handler, the dev system verifies it before promoting to production:

```
For each spec:
  Generate N synthetic requests (happy path, edge cases, error paths)
     |
     v
  Run each request through BOTH:
    - The generated handler (via executeHandler)
    - The LLM cold path (via executeAgent)
     |
     v
  Compare responses:
    - Status codes must match
    - Response body structure must match
    - Error codes must match
     |
     v
  If 100% agreement: handler is verified -> promote
  If divergence found: log the failing case -> regenerate or flag for human review
```

This is exactly the shadow mode mechanism that already exists in `app.ts` (lines 217-246), but run proactively on synthetic traffic rather than reactively on live traffic.

The dev system generates synthetic requests by analyzing the spec:

- **Happy path**: valid inputs that should produce 201
- **Validation errors**: missing required fields, too-long strings, invalid enums
- **Auth errors**: unauthenticated, wrong role, non-owner
- **Business logic errors**: archived project, non-existent assignee, past due date
- **Edge cases**: empty strings, boundary values, null vs undefined

### 3. Continuous Maintenance: Watch -> Regenerate -> Verify -> Deploy

The dev system runs as a persistent watcher:

```
Watch specs/*.md for changes
     |
     +-- file changed?
     |     |
     |     v
     |   Compute new spec hash
     |     |
     |     v
     |   Does handler exist with matching hash?
     |     |           |
     |    yes          no
     |     |           |
     |   (skip)     Regenerate handler
     |                 |
     |                 v
     |              Shadow-test new handler
     |                 |
     |              pass?
     |              /     \
     |            yes      no
     |             |        |
     |          Deploy    Retry (up to 3x)
     |             |        |
     |             v     Flag for human review
     |          Atomic file swap
     |
     +-- new spec file?
     |     |
     |     v
     |   Generate handler from scratch
     |   Shadow-test, deploy (same flow)
     |
     +-- spec deleted?
           |
           v
         Remove handler file
         Update route manifest
```

---

## File Layout: What Ships to Production

```
production/
  handlers/
    auth/
      register.mjs           # generated from specs/auth/register.md
      login.mjs               # generated from specs/auth/login.md
    projects/
      list.mjs                # generated from specs/projects/list.md
      create.mjs              # generated from specs/projects/create.md
      get.mjs                 # generated from specs/projects/get.md
      update.mjs              # generated from specs/projects/update.md
    tasks/
      list.mjs                # generated from specs/tasks/list.md
      create.mjs              # generated from specs/tasks/create.md
      get.mjs                 # generated from specs/tasks/get.md
      update.mjs              # generated from specs/tasks/update.md
  manifest.json               # route table + spec hashes
  runtime.mjs                 # the ~200-line router
  package.json                # no LLM dependencies
```

The `manifest.json` is the compiled route table:

```json
{
  "routes": [
    {
      "method": "POST",
      "pattern": "/api/auth/register",
      "handler": "auth/register.mjs",
      "specHash": "sha256:a1b2c3..."
    },
    {
      "method": "POST",
      "pattern": "/api/auth/login",
      "handler": "auth/login.mjs",
      "specHash": "sha256:d4e5f6..."
    },
    {
      "method": "GET",
      "pattern": "/api/projects",
      "handler": "projects/list.mjs",
      "specHash": "sha256:g7h8i9..."
    }
  ],
  "generatedAt": "2026-04-16T08:44:15Z",
  "generatorVersion": "1.0.0"
}
```

### What Does NOT Ship to Production

- No `@anthropic-ai/sdk` or Vercel AI SDK
- No `specs/*.md` files (unless you want runtime hash checking against live specs)
- No LLM config (api_key, model, provider)
- No prompt-assembler, no executor cold-path logic
- The tool registry (`database_query`, `crypto_generate_token`, `time_now`, etc.) **does** ship -- handlers call tools the same way they do today

---

## The Production Runtime: How Small Is It?

The production runtime replaces the current `app.ts` with something much thinner. It no longer needs:

- LLM provider instantiation
- Prompt assembly
- Token tracking
- Cold-path/hot-path branching
- Shadow mode (that is a dev concern now)

What remains:

```
HTTP server (Hono)
  + request ID middleware
  + CORS middleware
  + auth middleware
  + route matching (from manifest.json)
  + handler loading (dynamic import of .mjs files)
  + hash guard (compare manifest hash vs handler hash)
  + response builder
  + health / readiness endpoints
```

This is roughly 200-300 lines of code. No LLM. The runtime dependencies shrink from:

```
Current production:
  hono, @anthropic-ai/sdk (or @ai-sdk/anthropic), ai (vercel), 
  gray-matter, postgres/better-sqlite3, zod, pino, ...

MI3 production:
  hono, postgres/better-sqlite3, zod, pino
```

---

## Deployment Model

### Option A: Static Build (simplest)

```
Dev machine:
  1. npm run generate          # LLM generates/regenerates all handlers
  2. npm run verify            # shadow-test all handlers against LLM
  3. npm run build:production  # bundle handlers + manifest + runtime
  4. docker build -t myapp .   # standard container build
  5. docker push               # deploy
```

This is the traditional CI/CD model. The LLM runs during the build step on the dev machine, and the artifact is a standard container with no LLM.

### Option B: Continuous Sync (the vision)

```
Dev machine (always running):
  - Watches specs/ for changes
  - Auto-regenerates affected handlers
  - Shadow-tests
  - On success: pushes handler files to production via:
    - git commit + deploy pipeline
    - file sync (rsync, S3)
    - container rebuild + rolling update
    - direct file swap (if production mounts a shared volume)

Production (always running):
  - Serves from handlers/ directory
  - Optionally watches for file changes and hot-reloads
  - Hash guard catches any race condition during swap
```

### Option C: Hybrid (pragmatic starting point)

Keep the current agentic-service architecture. Add a `generate` command that:

1. Reads all specs
2. For each spec, generates a handler `.mjs` file
3. Embeds the spec hash
4. Shadow-tests against the LLM
5. Writes to `handlers/` directory

The existing handler-loader already loads these files. The existing shadow mode already verifies them. The only new thing is: **the LLM writes the handlers instead of a human**.

Production can then run with `tool_handler` in every spec's frontmatter, meaning every route uses the hot path. If LLM config is removed from `config.yaml`, the server still starts -- it just has no fallback. The hash guard ensures stale handlers fail instead of serving wrong responses.

---

## Fault Isolation and Failure Modes

### What happens when things go wrong?

| Failure | What Happens | Recovery |
|---|---|---|
| Spec changes, handler not regenerated yet | 503 Stale with `X-Stale-Spec` header | Dev system auto-regenerates; or manual `npm run generate` |
| Generated handler has a bug | Shadow testing catches it before promotion; if it slips through, standard error monitoring catches wrong responses | Dev system regenerates with the failing case as a new test fixture |
| Handler throws an unhandled exception | `executeHandler` catch block returns 500 (same as today, `executor.ts` line 102-112) | Error logged; dev system alerted |
| Handler file fails to load (syntax error) | `loadHandlerSafe` returns null (same as today, `handler-loader.ts` line 49-66) | Route returns 503; dev system alerted to fix generation |
| Database is down | Tool call fails inside handler; handler returns 500 | Same as any backend -- standard DB monitoring |
| One handler is stale, others are fine | Only the stale route returns 503; all other routes serve normally | Per-route isolation -- no cascade |

### Per-Route Isolation

Each handler is an independent `.mjs` file. A failure in one handler cannot affect another handler because:

- No shared mutable state between handlers (each gets its own `ResponseState`)
- Each handler is loaded independently via `loadHandlerSafe` (failure is isolated, `handler-loader.ts` line 78-113)
- The hash guard operates per-route (a stale spec for one route does not affect others)
- `Promise.allSettled` in `loadHandlersSafe` means one broken import does not prevent others from loading

---

## Relationship to Existing Codebase

MI3 is not a rewrite. It is a natural extension of what already exists:

| Existing Component | MI3 Role |
|---|---|
| `specs/*.md` | Still the source of truth -- unchanged |
| `api-routes.md` | Still defines the route table -- unchanged |
| `RouteHandler` type (`registry.ts:35-39`) | Still the contract for handler functions -- unchanged |
| `handler-loader.ts` | Still loads handlers from `.mjs` files -- unchanged |
| `executeHandler` (`executor.ts:82-116`) | Still executes handlers and wraps errors -- unchanged |
| `tool-registry.ts` (task-manager) | Still registers handlers by key -- unchanged |
| `buildToolRegistry` | Still provides DB/crypto/time tools to handlers -- unchanged |
| `shared.ts` helpers | Still used for `unauthorized()`, `badRequest()`, `dbQuery()` -- unchanged |
| `app.ts` hot path (line 205-270) | This IS the production path now -- it just runs for every route, not just some |
| `app.ts` cold path (line 274-308) | **Removed in production**. Only exists on the dev machine for shadow testing |
| Shadow mode (`app.ts:217-246`) | **Moved to dev time**. Runs during verification, not in production |
| `config.yaml` `llm:` section | **Not needed in production**. Only on the dev machine |

### What Changes

1. **New: `generate` command** -- reads specs, calls LLM, writes handler `.mjs` files
2. **New: Spec hash embedding** -- each generated handler includes `SPEC_HASH` constant
3. **New: Hash guard middleware** -- runtime checks hash before executing
4. **New: `manifest.json`** -- compiled route table with hashes for the production runtime
5. **Modified: production config** -- no `llm:` section needed; no LLM dependencies in production `package.json`

Everything else stays the same.

---

## What the Developer Experience Looks Like

### Day-to-Day Workflow

```
1. Developer edits specs/tasks/create.md
   "Add a new optional 'tags' field, array of strings, max 10 tags"

2. Dev system detects the change (file watcher or manual trigger)

3. Dev system re-generates handlers/tasks/create.mjs
   - LLM reads the updated spec
   - Generates new handler with tags validation and DB insert
   - Embeds new spec hash

4. Dev system shadow-tests the new handler
   - Generates synthetic requests (with and without tags)
   - Runs through handler AND LLM cold path
   - Compares outputs

5. All tests pass -> new handler.mjs is ready

6. Developer reviews the diff (optional but recommended):
   $ diff handlers/tasks/create.mjs handlers/tasks/create.mjs.prev
   + tags validation logic
   + tags field in INSERT
   + tags field in SELECT
   (everything else unchanged)

7. Deploy to production:
   $ npm run build:production && docker build && docker push
   (or: automatic via CI/CD pipeline)

8. Production starts serving the new handler immediately.
   No LLM involved. No runtime cost increase.
```

### When Things Go Wrong

```
1. Developer edits a spec

2. Dev system generates a handler

3. Shadow test FAILS:
   - Handler returns 400 for a valid request that the LLM handles correctly
   - Logged: "Shadow divergence: handler returned 400, LLM returned 201 for input {...}"

4. Dev system retries generation (up to 3x, with the failing case included as a test fixture)

5. If retries fail: developer is notified
   "Failed to generate a verified handler for tasks/create.md after 3 attempts.
    Divergence: [details]. Please review the spec for ambiguity or add clarification."

6. Developer reviews, maybe clarifies the spec prose, dev system retries.
```

---

## Strengths

- **Minimal new machinery.** The existing handler-loader, executor, tool registry, and shadow mode do 90% of the work already. MI3 adds generation + hash guard on top.
- **Highest feasibility.** Both evaluators scored it 0.88-0.89 on feasibility -- you could build this incrementally starting today.
- **Zero runtime cost.** No LLM tokens in production. No API keys. No latency. No non-determinism.
- **Loud failure.** The hash guard means stale logic never executes. 503 is visible, monitorable, and recoverable.
- **Incremental adoption.** You can generate handlers for one route at a time. Routes without generated handlers still use the LLM (during the transition period on the dev machine).
- **Debuggable.** The generated handlers are plain JavaScript. You can read them, diff them, set breakpoints, step through them. No intermediate representation to learn.
- **Standard deployment.** The output is a Node.js app in a Docker container. No novel runtime, no custom executor, no FSM interpreter.

## Weaknesses and Open Questions

- **Generated code correctness.** The LLM might generate a handler that is subtly wrong in ways that shadow testing does not catch (edge cases never covered by synthetic requests). Mitigation: expand test generation over time; add the existing `test:e2e` suite as a gate.
- **Complex specs.** For specs with deeply interleaved logic (like `tasks/create.md` with its 10-step flow), the generated handler is ~180 lines of TypeScript. LLMs are generally good at this scale, but correctness degrades for very long/complex handlers. Mitigation: keep specs focused and composable.
- **Connection pools and shared state.** Pure functions cannot own a database connection pool. The tool registry solves this (it already injects `db` via closure in `buildToolRegistry`), but the handler must not try to manage its own connections.
- **ES module hot-swap.** Atomically swapping a `.mjs` file in a running Node process requires either a process restart or dynamic `import()` with cache-busting query strings. Both work, but add a small amount of deploy-time complexity.
- **Evaluator novelty scores were low (0.53).** This is the "obvious" approach -- essentially automating what humans already do manually in the hot-path pattern. Its power comes from practical viability, not conceptual novelty.

---

## How It Could Combine With Other Ideas

MI3 is a **runtime and deployment model**. It pairs naturally with ideas that improve the **generation** side:

- **+ PR2 (Spec-as-Contract with Bidirectional Compilation):** Instead of the LLM generating the handler directly, it produces a small IR (~50 lines YAML) that deterministic templates expand into the handler `.mjs` file. This makes the LLM's output smaller, more auditable, and more reliable -- while MI3's hash-router serves the final artifact.

- **+ CDA3 (Palimpsest / Layered Erasure):** During the transition period, routes can exist at different maturity levels. L0 = LLM-only (dev machine). L2 = generated handler in MI3's hash-router (production). The layered model provides a principled path for migrating each route independently.

- **+ FU2 (Adversarial Twin Loop):** After the LLM generates a handler, a second LLM (Falsifier) tries to break it with adversarial inputs. Failed attacks become new test fixtures. This strengthens the shadow-testing phase that MI3 relies on for verification.
