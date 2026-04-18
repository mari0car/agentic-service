# Hot Path: Automatic Logic Compilation

## 1. The Problem

Every request through the LLM costs time (~500ms-5s) and money (tokens). For a production service handling hundreds of requests per second, this is unsustainable. Most business logic endpoints follow repeatable patterns: the same spec produces the same sequence of tool calls with different parameter values.

## 2. The Idea

The runtime observes the agent's behavior and learns execution patterns. When a pattern is stable and repeatable, it compiles it into a deterministic execution plan that runs without the LLM. This is analogous to a JIT compiler: interpret first, compile when hot.

```
                  Cold Path (LLM)                    Hot Path (Compiled)
                  ─────────────────                  ───────────────────
Request ──┬──▶  Prompt Assembly                     Execution Plan
          │     ▶ LLM Inference      ──learn──▶     ▶ Direct tool calls
          │     ▶ Tool call loop                    ▶ Condition evaluation
          │     ▶ Response (~1-5s)                  ▶ Response (~5-50ms)
          │
          └──▶  Route has compiled plan? ──yes──▶   Hot Path
               └──no──▶ Cold Path
```

## 3. Execution Traces

### 3.1 What Is a Trace

Every cold-path request produces an **execution trace**: the complete record of what the agent did. A trace captures:

```typescript
type ExecutionTrace = {
  // Identity
  route: string              // "POST /api/orders"
  spec_hash: string          // SHA256 of the spec file(s) used
  timestamp: string

  // Request shape (not values)
  request_shape: {
    path_params: string[]    // ["id"]
    query_params: string[]   // ["page", "per_page"]
    body_schema: object      // Inferred JSON schema of the body
  }

  // Steps the agent took
  steps: TraceStep[]

  // Outcome
  response_status: number
  response_body_schema: object
  success: boolean           // Did the agent complete without error
}

type TraceStep =
  | ToolCallStep
  | ConditionStep
  | ResponseStep

type ToolCallStep = {
  type: "tool_call"
  tool: string               // "database.query"
  input_template: object     // Parameterized input (see 3.2)
  output_shape: object       // Schema of the result
}

type ConditionStep = {
  type: "condition"
  expression: string         // "step[0].result.row_count == 0"
  branch: boolean            // Which branch was taken
}

type ResponseStep = {
  type: "response"
  status: number
  body_template: object      // Parameterized response body
}
```

### 3.2 Parameterization

The key to learning is replacing concrete values with references to their origin. During tracing, the runtime tracks data flow:

**Input origins** - where did each tool call parameter come from?

```
Concrete:  database.query("SELECT * FROM products WHERE id = $1", ["abc-123"])
                                                                    ^^^^^^^^
Traced:    database.query("SELECT * FROM products WHERE id = $1", [request.path_params.id])
                                                                   ^^^^^^^^^^^^^^^^^^^^^^^
                                                                   origin reference
```

**Origin types:**

| Origin | Example | Meaning |
|--------|---------|---------|
| `request.path_params.<name>` | `request.path_params.id` | URL path parameter |
| `request.query_params.<name>` | `request.query_params.page` | Query string parameter |
| `request.body.<path>` | `request.body.customer_id` | Request body field |
| `request.auth.<field>` | `request.auth.user_id` | Auth context |
| `step[N].result.<path>` | `step[0].result.rows[0].id` | Result of a previous tool call |
| `literal:<value>` | `literal:pending` | Constant value |
| `computed` | | Value computed by the agent (cannot be traced) |

**The `computed` origin is the limit of automatic learning.** If the agent performs arithmetic, string manipulation, or complex data transformation that can't be traced to a direct mapping, that step is marked `computed` and prevents full compilation.

### 3.3 Origin Detection

How the runtime determines where a value came from:

1. **Exact match**: search all request fields and prior tool results for the exact value
2. **Type + position heuristics**: if a UUID in params[0] matches `request.path_params.id`, that's likely the origin
3. **SQL template matching**: parse the SQL and map `$N` positions to their logical meaning
4. **Constant detection**: if the same literal appears across all traces for this route, it's a constant

When a value's origin can't be determined, it's marked `computed`. A step with `computed` origins cannot be compiled into the hot path unless all observed traces show the same computed value (making it effectively a constant).

## 4. Pattern Recognition

### 4.1 Trace Grouping

Traces are grouped by:
- **Route** (method + path pattern)
- **Spec hash** (same spec version)
- **Outcome branch** (which response status was produced)

Within a group, the runtime compares traces to find the common pattern.

### 4.2 Pattern Matching Algorithm

Two traces match if:
1. Same number of steps
2. Same tool calls in the same order
3. Same SQL templates (ignoring parameter values)
4. Same condition expressions and branch directions
5. Same response status

Parameter values differ - that's expected. What must be stable is the *structure*.

### 4.3 Branch Discovery

Different request inputs lead to different execution paths. The runtime discovers branches by:

1. Collecting traces with different step counts or different condition outcomes
2. Identifying the divergence point (e.g., step 3 branches on `row_count == 0`)
3. Building a decision tree:

```
step[0]: database.query("SELECT ... WHERE id = $1", [request.path_params.id])
  │
  ├── condition: step[0].result.row_count == 0
  │     └── true:  response(404, { error: "not_found" })
  │
  └── condition: step[0].result.row_count > 0
        │
        step[1]: database.query("SELECT ... WHERE owner_id = $1", [request.auth.user_id])
          │
          ├── condition: step[0].result.rows[0].owner_id != request.auth.user_id
          │     └── true:  response(403, { error: "forbidden" })
          │
          └── step[2]: response(200, { data: step[0].result.rows[0] })
```

## 5. Compilation Tiers

Like a JIT compiler, the runtime promotes execution plans through tiers:

### Tier 0: Interpreted (Cold Path)

All requests start here. The LLM interprets the spec for every request. Traces are recorded.

### Tier 1: Traced

After `min_traces` (default: 10) successful traces for a route, the runtime has enough data to analyze patterns. It still uses the LLM but begins pattern analysis in the background.

### Tier 2: Template Plan

When a stable pattern is identified across `compilation_threshold` (default: 25) traces with `consistency_ratio` (default: 0.9, meaning 90% of traces match), the runtime generates a **template execution plan**.

A template plan is a parameterized script:

```typescript
// Auto-generated plan for: GET /api/projects/:id
async function execute(ctx: RequestContext, tools: ToolRegistry): Promise<Response> {
  // Step 1: Query project
  const step0 = await tools.database.query({
    sql: "SELECT id, name, description, owner_id, status, created_at, updated_at FROM projects WHERE id = $1 AND deleted_at IS NULL",
    params: [ctx.pathParams.id]
  });

  // Branch: not found
  if (step0.row_count === 0) {
    return { status: 404, body: { error: { code: "not_found", message: "Project not found" } } };
  }

  // Branch: authorization
  if (step0.rows[0].owner_id !== ctx.auth.user_id && ctx.auth.role !== "admin") {
    return { status: 403, body: { error: { code: "forbidden", message: "Not authorized" } } };
  }

  // Step 2: Get task counts
  const step1 = await tools.database.query({
    sql: `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'todo') as todo,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
          COUNT(*) FILTER (WHERE status = 'done') as done
          FROM tasks WHERE project_id = $1 AND deleted_at IS NULL`,
    params: [ctx.pathParams.id]
  });

  // Response
  return {
    status: 200,
    body: {
      data: {
        ...step0.rows[0],
        task_counts: step1.rows[0]
      }
    }
  };
}
```

This plan is executed directly. No LLM involved. Response time drops from seconds to milliseconds.

### Tier 3: Optimized Plan (Future)

Further optimizations on the template plan:
- Combine multiple sequential database queries into a single query with JOINs
- Pre-compile SQL prepared statements
- Inline constant values
- Remove redundant validation steps

### Tier Summary

| Tier | Name | LLM Required | Latency | When |
|------|------|-------------|---------|------|
| 0 | Interpreted | Yes | 1-5s | Always (default) |
| 1 | Traced | Yes | 1-5s | After first request |
| 2 | Template Plan | No | 5-50ms | After pattern is stable |
| 3 | Optimized Plan | No | 2-20ms | Future optimization |

## 6. Promotion and Demotion

### 6.1 Promotion Criteria

A route is promoted from Tier 0/1 to Tier 2 when:

1. **Sufficient traces**: at least `compilation_threshold` traces (default: 25)
2. **Pattern stability**: at least `consistency_ratio` (default: 90%) of traces match the same pattern
3. **No computed origins**: all parameter origins are traceable (or consistent constants)
4. **All branches covered**: the decision tree covers all observed response statuses
5. **Spec unchanged**: the spec hash hasn't changed since traces were collected

### 6.2 Demotion Triggers

A compiled plan is demoted back to Tier 0 (cold path) when:

1. **Spec change**: the spec file is modified (detected by hash change). All traces and plans for this route are invalidated.
2. **Plan failure**: the plan produces an error that the cold path wouldn't (e.g., SQL error from a schema change). After `max_plan_failures` (default: 3) failures, demote.
3. **Validation failure**: if the runtime has a verification mode (see 7), and the plan's output diverges from what the LLM would produce.
4. **Manual invalidation**: operator triggers a reload.

### 6.3 Demotion Recovery

After demotion, the route starts collecting fresh traces. If the new traces produce a stable pattern again, a new plan is compiled. This handles:
- Spec updates (new logic → new plan)
- Database schema changes (new SQL → new plan)
- Bug fixes in specs

## 7. Verification Mode

To build confidence in compiled plans, the runtime supports **shadow verification**:

1. Execute the compiled plan (fast)
2. Also execute the cold path in the background (slow)
3. Compare the results
4. If they diverge, log a warning and consider demotion

This runs for a configurable percentage of requests (`verification_sample_rate`, default: 0.05 = 5%) after a plan is first compiled. It provides a safety net during the transition from cold to hot.

Verification is expensive (doubles the cost) and should be reduced or disabled once confidence is high.

## 8. What Can and Cannot Be Compiled

### Compilable Patterns

| Pattern | Example | Compilable? |
|---------|---------|------------|
| Simple CRUD | GET/POST/PUT/DELETE with direct field mapping | Yes |
| Conditional branches | "If not found, return 404" | Yes |
| Multiple sequential queries | Query + insert + update | Yes |
| Auth checks | "If not owner, return 403" | Yes |
| Pagination | LIMIT/OFFSET from query params | Yes |
| Input validation | Required fields, type checks, length limits | Yes |
| Constant values | `status = 'pending'`, `role = 'member'` | Yes |

### Not Compilable (Stay on Cold Path)

| Pattern | Example | Why |
|---------|---------|-----|
| Dynamic computation | Calculate tax based on complex rules | Agent does math that can't be traced |
| Natural language in response | "Generate a friendly error message" | Output is creative, not templated |
| External API calls with dynamic URLs | URL constructed from multiple inputs | Can't template the URL safely |
| Highly variable logic | Different tool calls depending on input content | Too many branches to cover |
| Specs referencing other specs dynamically | "Follow the workflow in the referenced spec" | Cross-spec references complicate tracing |

### Partially Compilable

Some routes have a compilable "happy path" and non-compilable error/edge cases. The plan handles the common cases and falls back to the LLM for rare ones:

```
Request arrives
  → Plan handles: validation, main query, success response (95% of requests)
  → Falls back to LLM for: complex error recovery, edge cases (5% of requests)
```

## 9. Trace Storage

Traces are stored in the service's database (or a separate SQLite file for zero-config):

```sql
CREATE TABLE _traces (
  id uuid PRIMARY KEY,
  route varchar(200) NOT NULL,
  spec_hash varchar(64) NOT NULL,
  request_shape jsonb NOT NULL,
  steps jsonb NOT NULL,
  response_status integer NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE _compiled_plans (
  id uuid PRIMARY KEY,
  route varchar(200) NOT NULL UNIQUE,
  spec_hash varchar(64) NOT NULL,
  plan jsonb NOT NULL,             -- The execution plan (or generated code)
  tier integer NOT NULL DEFAULT 2,
  trace_count integer NOT NULL,
  consistency_ratio real NOT NULL,
  failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  demoted_at timestamptz           -- NULL if active
);

CREATE INDEX idx_traces_route ON _traces(route, spec_hash);
CREATE INDEX idx_plans_route ON _compiled_plans(route) WHERE demoted_at IS NULL;
```

### Storage Limits

- Max traces per route: 100 (oldest are pruned)
- Total trace storage: configurable (`max_trace_storage_mb`, default: 100 MB)
- Traces older than `trace_retention_days` (default: 7) are pruned

## 10. Configuration

```yaml
hot_path:
  enabled: true

  # Tracing
  trace_all_requests: true          # Record traces for cold-path requests
  max_traces_per_route: 100         # Max traces to keep per route

  # Compilation thresholds
  min_traces: 10                    # Minimum traces before analysis begins
  compilation_threshold: 25         # Traces needed to compile
  consistency_ratio: 0.9            # Pattern match ratio required (0.0 - 1.0)

  # Verification
  verification_enabled: true
  verification_sample_rate: 0.05    # Verify 5% of hot-path requests
  verification_duration: 86400      # Seconds to run verification after compilation (24h)

  # Demotion
  max_plan_failures: 3              # Failures before demotion

  # Storage
  storage: "database"               # "database" (uses main DB) or "sqlite" (separate file)
  sqlite_path: "./_traces.db"       # If storage = sqlite
  trace_retention_days: 7
  max_trace_storage_mb: 100

  # Exclusions
  exclude_routes: []                # Routes that should never be compiled
  # Example: ["/api/reports/generate"]  (too complex, always use LLM)
```

## 11. Observability

### Metrics

```
agentic_hot_path_requests_total     (counter, labels: route, tier)
agentic_hot_path_compilations_total (counter, labels: route)
agentic_hot_path_demotions_total    (counter, labels: route, reason)
agentic_hot_path_fallbacks_total    (counter, labels: route, reason)
agentic_hot_path_verification_mismatches_total (counter, labels: route)
agentic_plan_duration_seconds       (histogram, labels: route)
```

### Admin API

```
GET  /admin/hot-path/status         # Overview: routes, tiers, trace counts
GET  /admin/hot-path/plans          # List all compiled plans
GET  /admin/hot-path/plans/:route   # Details of a specific plan
POST /admin/hot-path/demote/:route  # Manually demote a plan
POST /admin/hot-path/reset          # Clear all traces and plans
```

## 12. Lifecycle Example

```
t=0     Service starts. All routes at Tier 0 (cold path).

t=1m    10 requests to GET /api/projects/:id
        → 10 traces recorded. Tier 1 (traced).

t=5m    25 requests total. 23 traces match the same pattern.
        → consistency_ratio = 23/25 = 0.92 (> 0.9 threshold)
        → All parameter origins traced successfully
        → Compile to Tier 2. Plan generated.

t=5m+   Requests to GET /api/projects/:id now use the compiled plan.
        → Response time: ~15ms instead of ~2s
        → 5% of requests shadow-verified against LLM

t=6m    Spec author edits specs/projects/get.md
        → Spec hash changes
        → Plan demoted. Route returns to Tier 0.
        → New traces collected.

t=10m   25 new traces collected. New pattern stable.
        → New plan compiled. Route back to Tier 2.
```
