# Agentic Service

> **Proof of concept. Not for production use.**
>
> This project explores what becomes possible when LLM inference is fast and cheap — it is a speculative prototype, not a production-ready system. Expect rough edges, missing error handling, and behavior that depends entirely on LLM reliability.

**Business logic without code. Backends defined in plain language.**

Agentic Service is a generic backend runtime that replaces hand-coded business logic with LLM-interpreted markdown specifications. You define *what* your service does in human-readable documents. The agent executes it live at request time using a fixed set of built-in tools (database, filesystem, HTTP, messaging, etc.).

The idea is simple: if LLMs can already write business logic code from specifications, why not skip the code entirely and let the agent run the specification directly? Today this is too slow and too expensive for real workloads — but this project demonstrates what that future could look like.

---

## The Problem

Building a backend today means:

1. Reading a specification or requirements document
2. Translating it into code (handlers, models, queries, validation, error handling)
3. Compiling, testing, deploying that code
4. Repeating steps 1-3 for every change

Steps 2 and 3 are mechanical translation. The actual intent lives in step 1. Agentic Service eliminates the translation step.

## The Idea

An **Agentic Service** is a running process that:

- Exposes APIs (REST, MCP) to the outside world
- Receives requests (HTTP calls, MCP tool invocations)
- Hands each request to an LLM agent along with the relevant business logic specification
- The agent reads the spec, uses built-in tools (SQL queries, file operations, HTTP calls, etc.) to fulfill the request
- Returns the result

The business logic is never compiled. It's markdown files that a human writes and the agent interprets. Changing behavior means editing a document, not redeploying code.

```
┌─────────────────────────────────────────────────────────┐
│                    Agentic Service                        │
│                                                         │
│  ┌─────────┐    ┌──────────┐    ┌────────────────────┐ │
│  │  REST /  │───▶│ Request  │───▶│   LLM Agent        │ │
│  │  MCP API │    │ Router   │    │                    │ │
│  └─────────┘    └──────────┘    │  reads: specs/*.md  │ │
│                                  │  uses:  tools/*     │ │
│  ┌──────────────────────────┐   │                    │ │
│  │  Built-in Tools          │◀──│  executes business  │ │
│  │  ├─ database (SQL)       │   │  logic live         │ │
│  │  ├─ filesystem           │   └────────────────────┘ │
│  │  ├─ http_client          │                           │
│  │  ├─ messaging            │                           │
│  │  ├─ cache                │                           │
│  │  ├─ crypto               │                           │
│  │  └─ ...                  │                           │
│  └──────────────────────────┘                           │
│                                                         │
│  ┌──────────────────────────┐                           │
│  │  specs/                  │                           │
│  │  ├─ domain.md            │  ← human-written          │
│  │  ├─ api-routes.md        │  ← business logic         │
│  │  ├─ workflows.md         │  ← no code, just prose    │
│  │  └─ data-model.md        │                           │
│  └──────────────────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

## What You Write (Example)

Instead of implementing an Express handler with an ORM, you write:

```markdown
# Create Order

When a POST request arrives at `/api/orders`:

1. Validate that the request body contains `customer_id` (integer) and `items` (non-empty array)
2. Each item must have `product_id` (integer) and `quantity` (positive integer)
3. For each item, query the `products` table to verify the product exists and has sufficient `stock`
4. If any product is out of stock, return 409 with `{"error": "insufficient_stock", "product_id": <id>}`
5. Calculate `total_price` by summing `product.price * item.quantity` for all items
6. Insert a row into `orders` with `customer_id`, `total_price`, `status='pending'`, `created_at=now()`
7. For each item, insert into `order_items` with the `order_id`, `product_id`, `quantity`, `unit_price`
8. For each item, decrement `products.stock` by the ordered quantity
9. Return 201 with the full order object including all items
```

That's it. No code. The agent reads this, uses the `database` tool to run queries, validates inputs, handles errors, and returns the response.

## Key Properties

- **No compilation, no deployment for logic changes** - edit a markdown file, behavior changes immediately
- **Human-readable business logic** - non-engineers can read and review the specifications
- **One runtime, many services** - the same Agentic Service binary serves any domain by swapping spec files
- **Built-in tools are the only code** - database drivers, HTTP clients, etc. are implemented once in the runtime
- **MCP-native** - can expose its capabilities as MCP tools for agent-to-agent communication
- **Self-optimizing** - automatically learns execution patterns and compiles hot paths to bypass the LLM for stable routes (see [Hot Path](docs_del/specs/09-hot-path.md))

## Documentation

| Document | Description |
|----------|-------------|
| [Core Concepts](docs_del/specs/01-core-concepts.md) | The paradigm shift and mental model |
| [Architecture](docs_del/specs/02-architecture.md) | System design, components, runtime flow |
| [Tool Specification](docs_del/specs/03-tool-specification.md) | All built-in tools and their interfaces |
| [Business Logic Format](docs_del/specs/04-business-logic-format.md) | How to write specification files |
| [API Layer](docs_del/specs/05-api-layer.md) | REST and MCP API specifications |
| [Configuration](docs_del/specs/06-configuration.md) | Service, tool, and LLM provider configuration |
| [Security](docs_del/specs/07-security.md) | Authentication, authorization, sandboxing |
| [Developer Guide](docs_del/specs/08-developer-guide.md) | Extending the runtime with custom tools |
| [Hot Path](docs_del/specs/09-hot-path.md) | Automatic logic compilation for LLM-free execution |
| [Technology Decisions](docs_del/specs/10-technology-decisions.md) | Language, frameworks, libraries, build phases |
| [Example: Task Manager](docs_del/projects/task-manager/) | Complete example service |

## Getting Started

**Prerequisites:** Node.js ≥ 22, pnpm, an LLM provider (AWS Bedrock by default — configure in `config.yaml`).

```bash
# Install and build
pnpm install
pnpm run build

# Or use the dev script (handles install + build automatically)
./dev.sh
```

`./dev.sh` starts the **Management UI** at `http://localhost:5173`. From there you can browse projects in `projects/`, start and stop them, edit spec files, run migrations, and use the built-in LLM assistant to generate spec files and fast handlers.

```bash
./stop.sh    # stop the management UI
```

To run a project directly without the UI (e.g. in CI or production):

```bash
# Run migrations
node dist/index.js migrate up --config projects/task-manager/config.yaml

# Start the server
node dist/index.js serve --config projects/task-manager/config.yaml
```

**Example project:** `projects/task-manager/` is a complete task management API with auth, projects, and tasks — a good starting point for a new service.

## Management UI

The management UI (`management/`) is a local development tool for working with agentic-service projects:

- **Browse and start projects** — scans the `projects/` directory, lets you start/stop services and stream their logs
- **Edit specs** — view and edit markdown spec files directly in the browser; changes take effect immediately (no restart needed)
- **Generate specs and handlers** — LLM-assisted authoring: describe an endpoint and get a spec, or generate a TypeScript fast handler from an existing spec
- **Run migrations** — apply pending database migrations from the UI
- **Toggle fast handlers** — enable or disable the hot path for individual routes without touching config files
