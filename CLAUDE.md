# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev               # Run CLI with tsx (no build needed)
npm run build             # Compile to dist/ via tsup
npm run typecheck         # TypeScript type checking (also the lint command)

# Server & tooling
npm run serve             # Start HTTP server
npm run migrate           # Run database migrations
npm run validate          # Validate spec files and routes

# Management UI (React frontend + Hono backend)
npm run management        # Start both concurrently (UI at :5173)
npm run management:build  # Build management UI

# Testing
npm run test:e2e          # End-to-end tests against projects/task-manager/
```

There are no unit tests — the primary test mechanism is `npm run test:e2e`, which runs `projects/task-manager/test-e2e.sh` against a live server.

## Architecture

Agentic Service is a backend runtime that executes HTTP endpoints by letting an LLM interpret markdown spec files at runtime, rather than hand-coded business logic. Edit a markdown file, behavior changes immediately — no recompile.

### Two Execution Paths

Every incoming request is handled via one of two paths:

**Cold Path (LLM Agent)** — default
1. `specStore.getRoute(method, path)` maps the request to a markdown spec file
2. `prompt-assembler.ts` builds a system prompt from the spec + global specs
3. `executor.ts` calls the Vercel AI SDK `generateText()` with the full tool registry
4. The LLM calls tools (DB queries, crypto, HTTP, etc.) iteratively until it produces a JSON response `{status, headers, body}`
5. `response-parser.ts` extracts and returns the final HTTP response

**Hot Path (Tool Handler)** — opt-in, bypasses LLM
- If a spec's frontmatter has `tool_handler: <key>` and a matching TypeScript handler is registered in `src/tools/handler-loader.ts`, the handler is called directly
- Handlers receive a `RequestContext` and `ToolRegistry` and call tools without LLM involvement
- **Shadow mode**: when `tool_registry.shadow_mode: true`, both paths run in parallel and responses are compared (handler result is always returned)

### Key Modules

| Module | Location | Purpose |
|--------|----------|---------|
| HTTP server | `src/server/app.ts` | Hono app factory, routing, middleware, hot/cold dispatch |
| LLM executor | `src/agent/executor.ts` | Vercel AI SDK integration, retry logic, provider factory |
| Tool registry | `src/tools/registry.ts` | All built-in tools (DB, crypto, cache, HTTP, filesystem, time) |
| Handler loader | `src/tools/handler-loader.ts` | Loads TypeScript hot-path handlers |
| Spec store | `src/specs/store.ts` | Loads/parses markdown specs, gray-matter frontmatter, route matching |
| Config | `src/config/schema.ts` + `loader.ts` | Zod-validated YAML config with `AGENTIC_*` env overrides |
| Database | `src/db/connection.ts` | PostgreSQL (postgres) and SQLite (better-sqlite3) wrapper |
| CLI | `src/cli/` | `serve`, `migrate`, `validate` commands |
| Management UI | `management/` | React + Vite frontend + Hono backend for live spec/handler editing |

### Spec File Format

Specs live in the `specs/` directory (configured in `config.yaml`). Routes are declared either in `specs/api-routes.md`:
```
POST /api/tasks → tasks/create.md
GET  /api/tasks/:id → tasks/get.md
```
or via frontmatter in each spec:
```yaml
---
method: POST
path: /api/tasks
tool_handler: tasks/create   # optional: use hot path handler
---
```
The spec body is plain-English prose describing validation, DB queries, and response format — executed by the LLM.

### LLM Providers

Configured via `config.yaml` under `llm.provider`. Supported: `anthropic`, `openai`, `bedrock`. Provider and model are instantiated in `executor.ts` via the Vercel AI SDK.

### Configuration

`config.yaml` is the primary config file. All fields can be overridden with env vars using `AGENTIC_<SECTION>_<KEY>` (e.g., `AGENTIC_LLM_API_KEY`, `AGENTIC_DATABASE_URL`, `AGENTIC_SERVER_PORT`).

### Library vs CLI

The project builds two outputs:
- `dist/index.js` — CLI binary (`agentic-service serve/migrate/validate`)
- `dist/lib.js` — Library entry for embedding the runtime in custom Node apps via `import { createApp, loadConfig, ... } from "agentic-service/lib"`

The `projects/task-manager/` directory is the canonical working reference for both usage patterns.
