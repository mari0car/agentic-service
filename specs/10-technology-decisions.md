# Technology Decisions

## 1. Language: TypeScript on Node.js

**Decision:** TypeScript running on Node.js (v22+).

**Rationale:**

| Factor | Assessment |
|--------|-----------|
| LLM SDK ecosystem | Best available. OpenAI SDK, Anthropic SDK, Vercel AI SDK (multi-provider, streaming, tool calling). All first-class TypeScript. |
| MCP support | Official `@modelcontextprotocol/sdk` is TypeScript. First-party, maintained by the protocol authors. |
| Async I/O model | Native. Agentic Service is almost entirely I/O-bound (waiting on LLM inference, DB queries, HTTP calls). Node's event loop handles this well. |
| Developer pool | Largest. Lowers contribution barrier. |
| Type safety | TypeScript provides it. Tool schemas, request/response types, execution plans are all type-checkable. |
| Deployment | Docker image. Not a single binary like Go, but container deployment eliminates this gap. |
| Performance | Adequate. The bottleneck is LLM inference (seconds), not CPU. Hot path execution is direct tool calls (DB queries, HTTP), which Node handles at native driver speed. |

**What we give up vs Go:** single-binary deployment, lower memory footprint, goroutine-level concurrency. None of these are blockers for the workload.

**What we give up vs Rust:** maximum throughput under extreme load. Not relevant - the LLM is the bottleneck.

**Runtime target:** Node.js 22 LTS (stable, native fetch, native test runner available but we'll use Vitest).

Consider **Bun** as a future optimization. Same TypeScript code, faster startup, native SQLite. But Node.js has the maturity and ecosystem stability needed for v1.

---

## 2. Package Manager

**Decision:** pnpm

Faster installs, strict dependency resolution, efficient disk usage via content-addressable storage. Monorepo-friendly if the project grows.

---

## 3. Build System

**Decision:** tsup (backed by esbuild)

- Fast compilation (esbuild speed)
- Produces clean ESM output
- Handles TypeScript path aliases
- Single-file or chunked output for deployment

```
src/ → tsup → dist/index.js (ESM bundle)
```

Alternative considered: `tsx` for development (no build step, direct execution). Use `tsx` for `dev` mode, `tsup` for production builds.

---

## 4. HTTP Server

**Decision:** Hono

| Option | Considered | Verdict |
|--------|-----------|---------|
| Express | Mature, huge ecosystem | Legacy API design. Callback-based. Slow. |
| Fastify | Fast, schema-based | Good option. Heavier than needed. Plugin system adds complexity. |
| **Hono** | Lightweight, fast, multi-runtime | **Selected.** Minimal API, excellent performance, native Web Standard Request/Response, works on Node/Bun/Deno/Cloudflare. Future-proof. |
| Koa | Minimal | Aging. Smaller ecosystem than Hono. |
| h3/Nitro | UnJS ecosystem | Good, but more opinionated. |

Hono's middleware model is clean and its router is one of the fastest. It runs on Web Standards, which means the same code works if we later move to Bun or edge runtimes.

```typescript
import { Hono } from "hono";

const app = new Hono();
app.use("*", corsMiddleware);
app.use("*", requestIdMiddleware);
app.use("/api/*", authMiddleware);
app.all("/api/*", agentHandler);     // All API routes go through the agent
app.route("/admin", adminRouter);     // Admin routes are direct
app.route("/mcp", mcpRouter);         // MCP endpoint
```

---

## 5. LLM Integration

**Decision:** Vercel AI SDK (`ai` package)

| Option | Considered | Verdict |
|--------|-----------|---------|
| OpenAI SDK only | Simple, well-maintained | Locks to one provider |
| Anthropic SDK only | Good tool use | Locks to one provider |
| LangChain | Feature-rich | Over-engineered for this use case. Too many abstractions. |
| **Vercel AI SDK** | Multi-provider, streaming, tool calling | **Selected.** Clean API, supports OpenAI/Anthropic/Bedrock/Azure/Ollama/Google via provider packages. First-class tool calling with schemas. |
| LiteLLM (proxy) | Provider abstraction via proxy | Adds a network hop and another service to manage. |

The Vercel AI SDK gives us:
- `generateText()` with tool definitions and automatic tool call loops
- Provider-agnostic: swap models by changing config
- Streaming support (future: SSE responses)
- Structured output (JSON mode)
- Token usage tracking

```typescript
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = await generateText({
  model: openai("gpt-4o"),
  system: systemPrompt,
  messages: [{ role: "user", content: assembledPrompt }],
  tools: registeredTools,
  maxSteps: 20,       // Max tool call rounds
  temperature: 0,
});
```

---

## 6. MCP Server

**Decision:** `@modelcontextprotocol/sdk`

The official TypeScript MCP SDK. No alternatives worth considering - this is the reference implementation by the protocol authors.

Supports:
- stdio transport (for local/CLI usage)
- HTTP+SSE transport (for remote agents)
- Tool registration with JSON Schema
- Resource exposure

---

## 7. Database

### 7.1 Driver

**Decision:** Postgres.js (`postgres`) for PostgreSQL, `better-sqlite3` for SQLite.

| Option | Considered | Verdict |
|--------|-----------|---------|
| node-postgres (pg) | Most popular | Older API, callback origins, connection pool management overhead |
| **Postgres.js** | Modern, fast, tagged templates | **Selected.** Fastest Node.js Postgres driver. Clean API. Native parameter binding. Connection pooling built in. |
| Drizzle ORM | Type-safe ORM | Too much abstraction. The agent writes raw SQL. |
| Prisma | Popular ORM | Way too heavy. Generates a query engine binary. |
| Knex | Query builder | Useful for hot path plan generation (see 7.2), but not as the primary driver. |

For SQLite (used for lightweight deployments and trace storage):
- `better-sqlite3`: synchronous, fast, native bindings, well-maintained.

### 7.2 Query Building for Hot Path

When the hot path compiles an execution plan, it generates parameterized SQL strings directly. No query builder needed at Tier 2 - the SQL templates come from the recorded traces.

At Tier 3 (future), a query builder like Kysely could optimize queries (combine sequential queries into JOINs). This is a future concern.

### 7.3 Migrations

**Decision:** Custom minimal migration runner.

Options considered: Drizzle Kit, Knex migrations, node-pg-migrate, golang-migrate. All are either too tied to an ORM or too opinionated. Since migrations are plain SQL files, a simple runner that:
1. Reads `.sql` files from `migrations/` in order
2. Tracks applied migrations in a `_migrations` table
3. Supports `up` and `down`

This is ~100 lines of code and has zero dependencies.

---

## 8. Schema Validation

**Decision:** Zod for runtime validation, with JSON Schema interop via `zod-to-json-schema`.

Zod is used for:
- Validating config at startup
- Validating tool call inputs from the agent
- Validating agent response structure
- Generating JSON Schema for MCP tool definitions

```typescript
import { z } from "zod";

const DatabaseQueryInput = z.object({
  sql: z.string(),
  params: z.array(z.unknown()).optional(),
});
```

---

## 9. Configuration

**Decision:** `dotenv` + `js-yaml` + Zod validation.

- `.env` files for local development (loaded by dotenv)
- `config.yaml` parsed by js-yaml
- Environment variable overrides (mapped by convention)
- Full config schema validated by Zod at startup

No framework (like `convict` or `config`). The config schema is simple enough that Zod handles it cleanly.

---

## 10. Logging

**Decision:** pino

Fastest structured JSON logger for Node.js. Used by Fastify (and compatible with Hono). Zero-overhead when log level is above threshold.

```typescript
import pino from "pino";

const logger = pino({
  level: config.logging.level,
  transport: config.logging.format === "text"
    ? { target: "pino-pretty" }    // Dev mode
    : undefined                     // JSON for production
});
```

---

## 11. Testing

**Decision:** Vitest

- Fast (Vite-based, ESM-native)
- Compatible with Jest API (low migration cost if anyone comes from Jest)
- Built-in TypeScript support
- Watch mode, coverage, mocking

Test types:
- **Unit tests**: tool implementations, router, prompt assembler, trace analyzer
- **Integration tests**: full request lifecycle with a test database
- **Behavioral tests**: spec-based tests (the `agentic-service test` command)

---

## 12. Cache

**Decision:** Built-in `Map` for in-process cache, `ioredis` for Redis.

For the in-process cache:
- A `Map` with TTL eviction (via `lru-cache` package if needed)
- Sufficient for single-instance deployments

For Redis:
- `ioredis`: mature, full Redis feature support, Cluster/Sentinel aware

---

## 13. HTTP Client (Outbound)

**Decision:** Native `fetch` (Node.js 22 built-in)

Node.js 22 has a stable, performant `fetch` implementation (undici-based). No need for axios or node-fetch.

```typescript
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
  signal: AbortSignal.timeout(timeoutMs),
});
```

---

## 14. Messaging (Future)

Not in Phase 1. When needed:
- NATS: `nats.js` (official client)
- RabbitMQ: `amqplib`
- Kafka: `kafkajs`

---

## 15. Email (Future)

Not in Phase 1. When needed:
- SMTP: `nodemailer`
- SendGrid/SES: respective SDKs

---

## 16. Observability

- **Metrics**: `prom-client` (Prometheus client for Node.js)
- **Tracing**: `@opentelemetry/sdk-node` (OpenTelemetry SDK)
- Both are opt-in and configured via config.

---

## 17. Project Structure

```
agentic-service/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
│
├── src/
│   ├── index.ts                    # Entry point: start server
│   ├── config/
│   │   ├── schema.ts               # Zod config schema
│   │   └── loader.ts               # Load config from file + env
│   │
│   ├── server/
│   │   ├── app.ts                  # Hono app setup
│   │   ├── middleware/
│   │   │   ├── auth.ts             # JWT/API key auth
│   │   │   ├── cors.ts             # CORS
│   │   │   ├── rate-limit.ts       # Rate limiting
│   │   │   └── request-id.ts       # Request ID generation
│   │   ├── admin.ts                # Admin API routes
│   │   └── mcp.ts                  # MCP server setup
│   │
│   ├── router/
│   │   ├── route-table.ts          # Parse api-routes.md → route table
│   │   └── matcher.ts              # URL pattern matching
│   │
│   ├── specs/
│   │   ├── store.ts                # Load, index, watch spec files
│   │   ├── parser.ts               # Parse frontmatter + content
│   │   └── validator.ts            # Structural validation
│   │
│   ├── agent/
│   │   ├── executor.ts             # Agent execution loop
│   │   ├── prompt-assembler.ts     # Build prompt from spec + context
│   │   └── response-parser.ts      # Parse agent output → HTTP response
│   │
│   ├── tools/
│   │   ├── registry.ts             # Tool registration and dispatch
│   │   ├── database.ts             # database.query, database.execute, ...
│   │   ├── filesystem.ts           # filesystem.read, filesystem.write, ...
│   │   ├── http-client.ts          # http_client.request
│   │   ├── cache.ts                # cache.get, cache.set, cache.delete
│   │   ├── crypto.ts               # crypto.hash, crypto.jwt_sign, ...
│   │   ├── time.ts                 # time.now, time.parse, time.format
│   │   ├── log.ts                  # log.write
│   │   ├── validate.ts             # validate.json_schema, validate.email
│   │   └── response.ts             # response.set_header, response.set_cookie
│   │
│   ├── hot-path/
│   │   ├── tracer.ts               # Record execution traces
│   │   ├── analyzer.ts             # Pattern recognition + origin detection
│   │   ├── compiler.ts             # Generate execution plans
│   │   ├── executor.ts             # Execute compiled plans
│   │   ├── verifier.ts             # Shadow verification
│   │   └── store.ts                # Trace + plan storage
│   │
│   ├── db/
│   │   ├── connection.ts           # Database connection management
│   │   └── migrator.ts             # Migration runner
│   │
│   └── cli/
│       ├── serve.ts                # `agentic-service serve`
│       ├── validate.ts             # `agentic-service validate`
│       ├── migrate.ts              # `agentic-service migrate`
│       ├── routes.ts               # `agentic-service routes`
│       └── test.ts                 # `agentic-service test`
│
├── tests/
│   ├── unit/
│   │   ├── router/
│   │   ├── specs/
│   │   ├── tools/
│   │   └── hot-path/
│   └── integration/
│       ├── agent-execution.test.ts
│       └── hot-path-lifecycle.test.ts
│
└── docs/
    ├── specs/                      # (the specification documents)
    └── examples/
```

---

## 18. Build Phases

### Phase 1: Core Runtime (MVP)

Get a working service that can handle requests via the LLM.

| Component | Technology | Priority |
|-----------|-----------|----------|
| HTTP server | Hono | Must have |
| Config loading | js-yaml + Zod + dotenv | Must have |
| Spec store | fs-based loader | Must have |
| Route parser | Custom parser for api-routes.md | Must have |
| Prompt assembler | String template construction | Must have |
| Agent executor | Vercel AI SDK `generateText` | Must have |
| Tool: database | Postgres.js (query + execute) | Must have |
| Tool: crypto | Node.js `crypto` module + `jsonwebtoken` | Must have |
| Tool: time | Native `Date` + `Intl` | Must have |
| Tool: validate | Zod + ajv | Must have |
| Tool: log | pino integration | Must have |
| Tool: response | In-memory response builder | Must have |
| Auth middleware | JWT verification | Must have |
| Admin API | Health, readiness, spec list | Must have |
| CLI: serve | Start server | Must have |
| CLI: validate | Validate spec files | Must have |
| Structured logging | pino | Must have |

**Deliverable:** A working `agentic-service serve` that handles REST requests by routing them through the LLM agent with database, crypto, time, validate, log, and response tools. Supports JWT auth. Runs the task manager example end-to-end.

### Phase 2: Hot Path + Additional Tools

Make it production-viable with the hot path and expand tool coverage.

| Component | Technology | Priority |
|-----------|-----------|----------|
| Hot path: tracer | Custom | Must have |
| Hot path: analyzer | Custom | Must have |
| Hot path: compiler (Tier 2) | Custom code generation | Must have |
| Hot path: executor | Custom | Must have |
| Hot path: verifier | Custom | Should have |
| Tool: database.transaction | Postgres.js | Must have |
| Tool: filesystem | Node.js `fs` (sandboxed) | Must have |
| Tool: http_client | Native fetch | Must have |
| Tool: cache | lru-cache (in-process) | Must have |
| Migration runner | Custom | Must have |
| CLI: migrate | Migration commands | Must have |
| CLI: routes | Print route table | Should have |
| Rate limiting | Custom middleware | Should have |
| Metrics | prom-client | Should have |

**Deliverable:** Hot path automatically compiles stable routes. Database transactions, filesystem, HTTP client, and cache tools working. Migrations. The service can handle production-like workloads with hot paths reducing LLM costs by 80%+ on common endpoints.

### Phase 3: MCP + Operational Maturity

Agent-to-agent communication and production hardening.

| Component | Technology | Priority |
|-----------|-----------|----------|
| MCP server | @modelcontextprotocol/sdk | Must have |
| MCP tool generation | Custom (routes → MCP tools) | Must have |
| OpenAPI generation | Custom | Should have |
| Spec testing framework | Custom test runner | Should have |
| CLI: test | Behavioral test runner | Should have |
| OpenTelemetry tracing | @opentelemetry/sdk-node | Should have |
| Response sanitization | Custom filters | Should have |
| Spec hot reload (watch) | chokidar / fs.watch | Should have |
| Cache: Redis backend | ioredis | Nice to have |

**Deliverable:** Full MCP server. External agents can discover and call the service. Behavioral testing works. OpenTelemetry tracing enabled.

### Phase 4: Scale + Ecosystem

Multi-tenancy, messaging, email, and advanced hot path.

| Component | Technology | Priority |
|-----------|-----------|----------|
| Tool: messaging | nats.js / amqplib / kafkajs | When needed |
| Tool: email | nodemailer | When needed |
| Multi-tenancy | Custom middleware + config | When needed |
| Git-based spec loader | isomorphic-git or shell | When needed |
| Hot path Tier 3 | Query optimization | When needed |
| WebSocket support | Hono WebSocket | When needed |
| Streaming responses (SSE) | Hono SSE helpers | When needed |
| Custom tool plugin system | Dynamic import | When needed |

---

## 19. Dependency Summary (Phase 1)

```json
{
  "dependencies": {
    "hono": "^4.x",
    "@hono/node-server": "^1.x",
    "ai": "^4.x",
    "@ai-sdk/openai": "^1.x",
    "@ai-sdk/anthropic": "^1.x",
    "postgres": "^3.x",
    "zod": "^3.x",
    "pino": "^9.x",
    "js-yaml": "^4.x",
    "jsonwebtoken": "^9.x",
    "bcryptjs": "^3.x",
    "ajv": "^8.x",
    "dotenv": "^16.x",
    "gray-matter": "^4.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsup": "^8.x",
    "tsx": "^4.x",
    "vitest": "^3.x",
    "pino-pretty": "^13.x",
    "@types/node": "^22.x",
    "@types/jsonwebtoken": "^9.x",
    "@types/bcryptjs": "^2.x",
    "@types/js-yaml": "^4.x"
  }
}
```

Total production dependencies: 13. Lightweight.
