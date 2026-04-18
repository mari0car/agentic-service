# API Layer Specification

This document specifies how Agentic Service exposes its capabilities to the outside world: REST API for traditional clients, MCP for agent-to-agent communication, and the admin API for operations.

## 1. REST API

### 1.1 Request Handling

Every REST request follows this pipeline:

```
HTTP Request
  → Global Middleware (CORS, request ID, logging, rate limiting)
    → Authentication Middleware (extract + validate token)
      → Route Matching (URL + method → spec file)
        → Agent Invocation (spec + context + tools → response)
          → Response Serialization (agent output → HTTP response)
```

### 1.2 Request Format

**Supported content types:**
- `application/json` (default, required for request bodies)
- `multipart/form-data` (for file uploads, passed to agent as metadata)
- `application/x-www-form-urlencoded` (parsed into key-value pairs)

**Request context provided to agent:**

```json
{
  "method": "POST",
  "path": "/api/orders",
  "path_params": { "id": "abc-123" },
  "query_params": { "page": "1", "per_page": "20" },
  "headers": {
    "content-type": "application/json",
    "x-request-id": "req-uuid"
  },
  "body": { "customer_id": 42, "items": [...] },
  "auth": {
    "authenticated": true,
    "user_id": "user-uuid",
    "role": "member",
    "claims": { ... }
  }
}
```

### 1.3 Response Format

The agent must produce a response in this structure:

```json
{
  "status": 201,
  "headers": {
    "X-Custom-Header": "value"
  },
  "body": {
    "data": { ... }
  }
}
```

The runtime:
- Sets `Content-Type: application/json` by default
- Adds `X-Request-Id` header
- Adds CORS headers per configuration
- Serializes `body` as JSON

If the agent produces a plain object without the `status` wrapper, the runtime wraps it as `{ status: 200, body: <agent output> }`.

### 1.4 URL Routing

Routes are defined in `specs/api-routes.md` or via frontmatter in individual spec files.

**Route syntax:**
```
METHOD /path/with/:params → spec-file.md
```

**Parameter types:**
- `:param` - path parameter (e.g., `/api/orders/:id`)
- Query parameters are not part of routing, they're passed through

**Route matching priority:**
1. Exact path match
2. Parameterized path match (most specific first)
3. 404 if no match

**Example route table:**
```markdown
# API Routes

GET  /api/health           → specs/health.md
POST /api/auth/register    → specs/auth/register.md
POST /api/auth/login       → specs/auth/login.md

GET  /api/projects         → specs/projects/list.md
POST /api/projects         → specs/projects/create.md
GET  /api/projects/:id     → specs/projects/get.md
PUT  /api/projects/:id     → specs/projects/update.md

GET  /api/projects/:project_id/tasks      → specs/tasks/list.md
POST /api/projects/:project_id/tasks      → specs/tasks/create.md
GET  /api/projects/:project_id/tasks/:id  → specs/tasks/get.md
PUT  /api/projects/:project_id/tasks/:id  → specs/tasks/update.md
```

### 1.5 Global Middleware

Applied to all requests before routing:

**Request ID:**
- Generate a UUID for each request
- Set as `X-Request-Id` response header
- Pass to agent as part of request context
- Include in all log entries

**CORS:**
- Configurable allowed origins, methods, headers
- Preflight (OPTIONS) handled automatically, not routed to agent

**Rate Limiting:**
- Global rate limit per IP or per authenticated user
- Configurable: requests per window (e.g., 100 requests per minute)
- Returns 429 with `Retry-After` header when exceeded

**Request Size Limit:**
- Default: 1 MB
- Configurable per route if needed

**Timeout:**
- Default: 30 seconds per request
- Configurable globally and per route
- Returns 504 if exceeded

### 1.6 Streaming Responses (Future)

For long-running operations, the REST API may support streaming responses via Server-Sent Events (SSE). The agent would emit partial results as tool calls complete:

```
GET /api/reports/generate?format=csv
Accept: text/event-stream

data: {"progress": 0.2, "message": "Querying orders..."}
data: {"progress": 0.6, "message": "Processing 5000 records..."}
data: {"progress": 1.0, "url": "/api/files/report-123.csv"}
```

This is a future capability and not required for the initial implementation.

---

## 2. MCP Server

Agentic Service natively implements the Model Context Protocol (MCP), allowing external AI agents to discover and invoke the service's capabilities.

### 2.1 How It Works

Each API endpoint defined in the spec files is automatically exposed as an MCP tool. The MCP server:

1. Reads the route table at startup
2. Generates MCP tool definitions from route specs
3. Accepts MCP connections (via stdio or HTTP+SSE transport)
4. Routes tool invocations through the same pipeline as REST requests

### 2.2 Tool Generation from Routes

A route like:
```markdown
POST /api/projects/:project_id/tasks → specs/tasks/create.md
```

Becomes an MCP tool:
```json
{
  "name": "create_task",
  "description": "Create a new task in a project",
  "inputSchema": {
    "type": "object",
    "properties": {
      "project_id": { "type": "string", "description": "Project UUID" },
      "title": { "type": "string", "description": "Task title, 1-200 characters" },
      "description": { "type": "string", "description": "Task description" },
      "priority": { "type": "string", "enum": ["low", "medium", "high"] },
      "assignee_id": { "type": "string", "description": "User UUID to assign" },
      "due_date": { "type": "string", "format": "date" }
    },
    "required": ["project_id", "title"]
  }
}
```

### 2.3 MCP Tool Naming

Tools are named by converting routes to snake_case identifiers:

| Route | MCP Tool Name |
|-------|--------------|
| `GET /api/projects` | `list_projects` |
| `POST /api/projects` | `create_project` |
| `GET /api/projects/:id` | `get_project` |
| `PUT /api/projects/:id` | `update_project` |
| `DELETE /api/projects/:id` | `delete_project` |

Naming rules:
1. Method maps to verb: GET (list/get), POST (create), PUT (update), DELETE (delete)
2. Resource name from path segments (pluralized for list, singular for single)
3. Nested resources: `create_project_task` for `POST /api/projects/:id/tasks`

Authors can override tool names in spec frontmatter:
```yaml
---
mcp_tool_name: submit_order
mcp_description: Submit a new order for processing
---
```

### 2.4 MCP Tool Schema Generation

Input schemas for MCP tools are derived from:
1. Path parameters (from the route pattern)
2. The `Input` section of the spec file
3. Frontmatter overrides

The runtime parses the `Input` section of spec files to extract field names, types, required/optional status, and constraints. This parsing is best-effort - if the spec is ambiguous, the schema is permissive and the agent handles validation.

### 2.5 MCP Transports

**stdio (default for local development):**
```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | agentic-service --mcp-stdio
```

**HTTP+SSE (for remote agents):**
```
MCP endpoint: http://localhost:8080/mcp
```

The MCP server runs on the same port as the REST server at a dedicated path (`/mcp`), or on a separate port if configured.

### 2.6 MCP Authentication

External agents authenticate MCP requests using the same mechanism as REST:
- Bearer token in the MCP request metadata
- Or configured API keys for service-to-service communication

### 2.7 MCP Resources (Optional)

In addition to tools, the MCP server can expose resources:

- **Spec files**: expose the business logic specs as MCP resources so external agents can read what the service does
- **Schema**: expose the domain model and data model as resources
- **API documentation**: auto-generated OpenAPI spec as a resource

---

## 3. Admin API

Operational endpoints not routed through the agent. Implemented directly in the runtime.

### 3.1 Health Checks

**Liveness:**
```
GET /healthz
Response: 200 { "status": "ok" }
```
Returns 200 if the process is running. No dependency checks.

**Readiness:**
```
GET /readyz
Response: 200 { "status": "ready", "checks": { "database": "ok", "llm": "ok", "specs": "ok" } }
Response: 503 { "status": "not_ready", "checks": { "database": "ok", "llm": "error", "specs": "ok" } }
```
Returns 200 only if all dependencies are accessible.

### 3.2 Metrics

```
GET /metrics
Response: Prometheus text format
```

See Architecture spec section 7 (Observability) for metric definitions.

### 3.3 Spec Management

**List loaded specs:**
```
GET /admin/specs
Response: 200 {
  "specs": [
    { "path": "specs/orders/create-order.md", "route": "POST /api/orders", "loaded_at": "..." },
    ...
  ]
}
```

**Reload specs:**
```
POST /admin/reload
Response: 200 { "reloaded": true, "spec_count": 15, "errors": [] }
Response: 200 { "reloaded": true, "spec_count": 14, "errors": ["specs/foo.md: referenced but not found"] }
```

### 3.4 Tool Introspection

**List available tools:**
```
GET /admin/tools
Response: 200 {
  "tools": [
    { "name": "database", "operations": ["query", "execute", "transaction"], "enabled": true },
    { "name": "http_client", "operations": ["request"], "enabled": true },
    ...
  ]
}
```

### 3.5 Admin Authentication

Admin endpoints are protected separately from the main API:
- Disabled by default (only accessible from localhost)
- Optionally protected by a static API key (`admin_api_key` in config)
- Can be exposed on a separate port for network-level isolation

---

## 4. OpenAPI Generation

The runtime can auto-generate an OpenAPI 3.0 specification from the loaded route table and spec files:

```
GET /admin/openapi.json
```

Generation process:
1. Parse routes from `api-routes.md`
2. For each route, parse the spec file's Input and Response sections
3. Generate path operations with request/response schemas
4. Include authentication requirements
5. Include error response schemas

This is best-effort. Complex specs may produce incomplete schemas. The generated spec can be used for:
- Client SDK generation
- API documentation (Swagger UI)
- Integration testing
- External agent consumption

---

## 5. WebSocket Support (Future)

For real-time features (chat, notifications, live updates), a WebSocket layer may be added:

```
WS /ws
```

The agent would handle WebSocket messages similarly to HTTP requests, with specs defining:
- Connection handling (on connect, on disconnect)
- Message routing (message type → spec file)
- Room/channel management
- Broadcast logic

This is a future capability and not required for the initial implementation.
