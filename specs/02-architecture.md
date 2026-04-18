# Architecture Specification

## 1. System Overview

Agentic Service is a single deployable process composed of the following subsystems:

```
┌───────────────────────────────────────────────────────────────────┐
│                        Agentic Service Process                      │
│                                                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │  REST API    │  │  MCP Server │  │  Admin API               │ │
│  │  Server      │  │             │  │  (health, metrics, reload)│ │
│  └──────┬──────┘  └──────┬──────┘  └──────────────────────────┘ │
│         │                │                                       │
│         ▼                ▼                                       │
│  ┌────────────────────────────────────┐                         │
│  │         Request Router              │                         │
│  │  (matches request → spec files)     │                         │
│  └──────────────┬─────────────────────┘                         │
│                 │                                                 │
│                 ▼                                                 │
│  ┌────────────────────────────────────┐                         │
│  │       Prompt Assembler              │                         │
│  │  (system prompt + spec + context)   │                         │
│  └──────────────┬─────────────────────┘                         │
│                 │                                                 │
│                 ▼                                                 │
│  ┌────────────────────────────────────┐                         │
│  │       Agent Executor                │                         │
│  │  (LLM inference + tool call loop)   │                         │
│  └──────────────┬─────────────────────┘                         │
│                 │                                                 │
│                 ▼                                                 │
│  ┌────────────────────────────────────┐                         │
│  │       Tool Registry                 │                         │
│  │  ┌──────────┐ ┌──────────┐        │                         │
│  │  │ database │ │filesystem│        │                         │
│  │  └──────────┘ └──────────┘        │                         │
│  │  ┌──────────┐ ┌──────────┐        │                         │
│  │  │http_client│ │messaging│        │                         │
│  │  └──────────┘ └──────────┘        │                         │
│  │  ┌──────────┐ ┌──────────┐        │                         │
│  │  │  cache   │ │  crypto  │        │                         │
│  │  └──────────┘ └──────────┘        │                         │
│  │  ┌──────────┐ ┌──────────┐        │                         │
│  │  │  email   │ │  time    │        │                         │
│  │  └──────────┘ └──────────┘        │                         │
│  └────────────────────────────────────┘                         │
│                                                                   │
│  ┌────────────────────────────────────┐                         │
│  │       Spec Store                    │                         │
│  │  (loads, indexes, watches specs/)   │                         │
│  └────────────────────────────────────┘                         │
│                                                                   │
│  ┌────────────────────────────────────┐                         │
│  │       Configuration                 │                         │
│  │  (service.yaml / env vars)          │                         │
│  └────────────────────────────────────┘                         │
└───────────────────────────────────────────────────────────────────┘
```

## 2. Component Descriptions

### 2.1 REST API Server

An HTTP server that accepts incoming REST requests from external clients (mobile apps, web frontends, other services).

**Responsibilities:**
- Listen on a configurable port (default: 8080)
- Parse incoming HTTP requests (method, path, query params, headers, body)
- Enforce global middleware (CORS, rate limiting, request size limits)
- Pass parsed requests to the Request Router
- Return the agent-produced response to the caller
- Handle timeouts (return 504 if agent exceeds time budget)

**Technology choice:** Standard HTTP library of the implementation language. No framework opinion is imposed - this should be minimal.

### 2.2 MCP Server

An MCP (Model Context Protocol) server that exposes the service's capabilities as tools for external agents.

**Responsibilities:**
- Implement the MCP protocol (stdio or HTTP+SSE transport)
- Register tools that map to the service's API endpoints
- Accept tool invocations from external agents
- Route them through the same pipeline as REST requests
- Return structured results per MCP spec

This means every Agentic Service is simultaneously a REST API and an MCP tool provider. A mobile app calls it via REST; an AI agent calls it via MCP. Same business logic.

### 2.3 Admin API

Internal HTTP endpoints for operational concerns. Not routed through the agent.

**Endpoints:**
- `GET /healthz` - liveness check
- `GET /readyz` - readiness check (are specs loaded, DB connected, LLM reachable?)
- `GET /metrics` - Prometheus-format metrics
- `POST /admin/reload` - trigger spec reload without restart
- `GET /admin/specs` - list loaded specification files
- `GET /admin/tools` - list registered tools and their schemas

### 2.4 Request Router

Determines which specification files are relevant for a given request.

**How routing works:**

The router reads `specs/api-routes.md` (or a designated routing spec) at startup. This file maps URL patterns and methods to spec files:

```markdown
# API Routes

## Orders
- `POST /api/orders` → specs/orders/create-order.md
- `GET /api/orders` → specs/orders/list-orders.md
- `GET /api/orders/:id` → specs/orders/get-order.md
- `PUT /api/orders/:id/status` → specs/orders/update-order-status.md

## Products
- `GET /api/products` → specs/products/list-products.md
- `GET /api/products/:id` → specs/products/get-product.md
```

The router parses this into a route table. When a request arrives:

1. Match the request method + path against the route table
2. Extract path parameters (`:id` → actual value)
3. Load the referenced spec file(s)
4. Pass everything to the Prompt Assembler

If no route matches, return 404 without invoking the agent.

### 2.5 Prompt Assembler

Constructs the complete prompt for the agent from the request context, spec files, and system instructions.

**Prompt structure:**

```
[System Prompt]
  - You are a backend service agent
  - You must produce a valid HTTP response
  - You may only use the tools provided
  - Output format instructions
  - Constraints (time, tokens, security)

[Specification Context]
  - Domain model (if referenced)
  - The specific route spec file
  - Any shared specs (error handling, auth policies)

[Request Context]
  - HTTP method
  - Path (with resolved parameters)
  - Query parameters
  - Headers (filtered for relevance)
  - Request body
  - Authentication context (user ID, roles, claims)

[Tool Definitions]
  - JSON schemas for all available tools
```

The assembler also decides which spec files to include beyond the route-specific one. Rules:

- Always include: domain model, error handling policy
- Include auth policies if the route is not public
- Include shared workflow specs if referenced
- Respect a configurable maximum context size

### 2.6 Agent Executor

The core loop that handles LLM inference and tool execution.

**Execution flow:**

```
1. Send assembled prompt to LLM provider
2. Receive response
3. If response contains tool calls:
   a. Validate each tool call against the tool schema
   b. Execute each tool call via the Tool Registry
   c. Collect results
   d. Append tool calls + results to conversation
   e. Send updated conversation back to LLM (go to step 2)
4. If response contains final answer:
   a. Parse as structured HTTP response
   b. Validate response format
   c. Return to caller
5. If time/token budget exceeded:
   a. Return 504/500 with error details
```

**Concurrency model:**

Each request gets its own agent invocation. Multiple requests execute in parallel. The Agent Executor manages a pool of concurrent invocations bounded by configuration (`max_concurrent_requests`).

**Error handling within the loop:**

- Tool execution failure: the error is returned to the agent as a tool result, allowing it to handle or report the error
- LLM provider error: retry with exponential backoff up to a limit, then fail the request
- Malformed agent output: return 500 with diagnostic info
- Timeout: cancel the invocation, return 504

### 2.7 Tool Registry

Manages all available tools, their schemas, and their execution.

**Responsibilities:**
- Register tools at startup based on configuration
- Provide tool schemas to the Prompt Assembler (for inclusion in the prompt)
- Execute tool calls from the agent with validated parameters
- Enforce per-tool access controls and resource limits
- Record tool call metrics (call count, duration, errors)

Each tool is implemented as a module with:
- A name (e.g., `database`)
- A set of operations (e.g., `database.query`, `database.execute`)
- JSON schemas for inputs and outputs
- An execution function

### 2.8 Spec Store

Loads, indexes, and optionally watches specification files.

**Responsibilities:**
- Read all `.md` files from the `specs/` directory at startup
- Parse route definitions from the routing spec
- Build an index: file path → content, route pattern → file path
- Optionally watch for file changes and reload (hot reload)
- Validate structural requirements (required frontmatter, section headings)
- Provide spec content to the Prompt Assembler on demand

### 2.9 Configuration

Centralized configuration loaded from file and/or environment variables.

See [06-configuration.md](06-configuration.md) for the full specification.

### 2.10 Hot Path Engine

Observes agent execution patterns and compiles frequently-used routes into deterministic execution plans that bypass the LLM entirely.

**Responsibilities:**
- Record execution traces for cold-path requests
- Analyze traces to detect stable, repeatable patterns
- Compile patterns into parameterized execution plans
- Execute compiled plans directly (tool calls without LLM)
- Verify compiled plans against LLM output (shadow mode)
- Demote plans when specs change or plans produce errors

The Hot Path Engine is what makes Agentic Service production-viable at scale. Without it, every request requires LLM inference. With it, stable routes respond in 5-50ms instead of 1-5s.

See [09-hot-path.md](09-hot-path.md) for the full specification.

## 3. Request Lifecycle

### 3.1 Cold Path (LLM-Interpreted)

Used for new routes, recently changed specs, or complex logic that hasn't been compiled:

```
1.  Client sends: POST /api/orders { "customer_id": 42, "items": [...] }

2.  REST API Server receives the request
    - Parses method, path, headers, body
    - Applies global middleware (CORS headers, request ID generation)

3.  Request Router matches POST /api/orders → specs/orders/create-order.md

4.  Hot Path check: is there a compiled plan for this route?
    - No → continue to cold path (step 5)

5.  Authentication middleware extracts and validates the auth token
    - Populates auth context: { user_id: 42, roles: ["customer"] }

6.  Prompt Assembler builds the prompt:
    - System prompt (agent role, constraints, output format)
    - specs/domain.md (entity definitions)
    - specs/orders/create-order.md (the specific logic)
    - specs/error-handling.md (error response format)
    - Request context (method, path, body, auth)
    - Tool definitions (database, cache, etc.)

7.  Agent Executor sends prompt to LLM

8.  LLM responds with tool calls:
    - database.query("SELECT * FROM products WHERE id IN (1,2,3)")

9.  Agent Executor executes the tool call, gets result:
    - [{ id: 1, name: "Widget", price: 9.99, stock: 50 }, ...]

10. Agent Executor sends tool result back to LLM

11. LLM responds with more tool calls:
    - database.execute("INSERT INTO orders (...) VALUES (...) RETURNING id")
    - database.execute("INSERT INTO order_items (...) VALUES (...)")
    - database.execute("UPDATE products SET stock = stock - 2 WHERE id = 1")

12. Agent Executor executes all tool calls, returns results

13. LLM responds with final answer:
    - { status: 201, body: { id: 1, customer_id: 42, total: 29.97, ... } }

14. Agent Executor parses and validates the response

15. Hot Path tracer records the execution trace (tool calls, data origins, result)

16. REST API Server sends HTTP 201 with JSON body to client

17. Request metrics recorded (duration, token usage, tool calls)
```

### 3.2 Hot Path (Compiled Plan)

Used for routes with stable, compiled execution plans:

```
1.  Client sends: GET /api/projects/abc-123

2.  REST API Server receives, parses, applies middleware

3.  Request Router matches GET /api/projects/:id → specs/projects/get.md

4.  Hot Path check: compiled plan exists for this route
    - Yes → execute plan directly (step 5)

5.  Authentication middleware validates token

6.  Compiled plan executes:
    a. database.query("SELECT ... FROM projects WHERE id = $1", [path_params.id])
    b. Condition: row_count == 0? → return 404
    c. Condition: owner_id != auth.user_id && role != admin? → return 403
    d. database.query("SELECT COUNT(*) ... FROM tasks WHERE project_id = $1", [path_params.id])
    e. Return 200 with combined result

7.  REST API Server sends response (~15ms total)

8.  No LLM tokens consumed. No trace recorded (plan is already compiled).
```

## 4. Data Flow Diagram

```
                    ┌─────────┐
                    │  Client  │
                    └────┬────┘
                         │ HTTP Request
                         ▼
                 ┌───────────────┐
                 │  REST Server   │
                 │  / MCP Server  │
                 └───────┬───────┘
                         │
                    ┌────▼────┐
         ┌─────────│  Router  │──────────┐
         │ 404     └────┬────┘           │ match
         ▼              │                ▼
    ┌─────────┐   ┌─────▼────────┐  ┌──────────┐
    │  Error   │   │  Hot Path    │  │  Spec    │
    │  Response│   │  Check       │  │  Store   │
    └─────────┘   └──┬──────┬───┘  └──────────┘
                     │      │
              plan   │      │  no plan
              exists │      │
                     ▼      ▼
              ┌────────┐  ┌──────────┐
              │Compiled│  │  Prompt   │
              │Plan    │  │ Assembler │
              │Executor│  └────┬─────┘
              └───┬────┘       │
                  │       ┌────▼─────┐
                  │       │  Agent    │◀──────┐
                  │       │  Executor │───────┤
                  │       └────┬─────┘       │
                  │            │         ┌───▼────┐
                  │       ┌────▼────┐    │  LLM   │
                  └──────▶│  Tool    │    │Provider│
                          │ Registry │    └────────┘
                          └────┬────┘
               ┌───────┬───┴───┬────────┐
               ▼       ▼       ▼        ▼
           ┌──────┐┌──────┐┌──────┐┌──────┐
           │  DB  ││ Files ││ HTTP ││Cache │
           └──────┘└──────┘└──────┘└──────┘
```

## 5. Concurrency and Scaling

### Single Instance

- The process handles multiple requests concurrently
- Each request is an independent agent invocation
- Concurrency is bounded by `max_concurrent_requests` (default: 20)
- The bottleneck is LLM inference; tool calls are fast by comparison

### Horizontal Scaling

- The service is stateless at the logic layer (agent has no memory between requests)
- Multiple instances can run behind a load balancer
- State lives in the database, cache, and external systems
- Spec files are read from disk (can be mounted from a shared volume or git-synced)

### Resource Budgets Per Request

| Resource | Default Limit | Configurable |
|----------|--------------|-------------|
| Wall time | 30 seconds | Yes |
| LLM tokens (input) | 8,000 | Yes |
| LLM tokens (output) | 4,000 | Yes |
| Tool calls | 20 | Yes |
| Database queries | 10 | Yes |
| HTTP outbound requests | 5 | Yes |

Exceeding any limit terminates the agent invocation and returns an error response.

## 6. Deployment Model

```
┌──────────────────────────────────────────┐
│             Deployment Unit               │
│                                          │
│  ┌────────────────┐  ┌───────────────┐  │
│  │  Agentic Service │  │  specs/       │  │
│  │  Binary         │  │  (mounted)    │  │
│  └────────────────┘  └───────────────┘  │
│                                          │
│  ┌────────────────┐                     │
│  │  config.yaml    │                     │
│  └────────────────┘                     │
└──────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌──────────────┐    ┌──────────────────┐
│  PostgreSQL   │    │  LLM Provider    │
│  (or other DB)│    │  (API endpoint)  │
└──────────────┘    └──────────────────┘
```

Deployment options:
- **Container**: Docker image containing the binary + specs baked in or volume-mounted
- **Kubernetes**: Pod with binary container + specs ConfigMap/Volume + sidecar for spec sync
- **Bare metal**: Binary + specs directory + config file
- **Serverless**: Adapter wrapping the agent executor for Lambda/Cloud Functions (higher cold start)

## 7. Observability

### Logging

Structured JSON logs with fields:
- `request_id` - unique per request
- `method`, `path` - the HTTP request
- `spec_file` - which spec was loaded
- `tool_calls` - array of tool names called
- `token_usage` - input/output tokens consumed
- `duration_ms` - total request duration
- `status_code` - HTTP response status

### Metrics

Prometheus-compatible metrics:
- `agentic_request_duration_seconds` (histogram, labels: method, path, status)
- `agentic_tool_call_duration_seconds` (histogram, labels: tool, operation)
- `agentic_token_usage_total` (counter, labels: direction [input/output])
- `agentic_request_total` (counter, labels: method, path, status)
- `agentic_agent_errors_total` (counter, labels: error_type)
- `agentic_concurrent_requests` (gauge)

### Tracing

OpenTelemetry spans for:
- Full request lifecycle
- Spec loading
- Prompt assembly
- Each LLM inference call
- Each tool execution
- Response formatting

### Agent Reasoning Traces

For debugging, the full agent conversation (prompt, tool calls, tool results, final answer) can be logged per request. This is controlled by configuration and should be off in production by default due to volume and potential PII.

## 8. Failure Modes

| Failure | Behavior |
|---------|----------|
| LLM provider unreachable | Retry 3x with backoff, then return 503 |
| LLM returns invalid output | Return 500 with diagnostic info; log full conversation |
| Database unreachable | Tool call returns error to agent; agent should produce error response per spec |
| Spec file not found for route | Return 500 (misconfiguration); log error |
| Spec file has syntax issues | Logged at startup as warning; agent attempts best-effort interpretation |
| Token budget exceeded | Terminate invocation, return 500 with "token budget exceeded" |
| Time budget exceeded | Terminate invocation, return 504 |
| Agent enters infinite tool-call loop | Tool call limit terminates the loop |
