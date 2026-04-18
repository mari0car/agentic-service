# Agentic Service — Vision

**A minimal, generic, spec-driven runtime that executes natural language specifications through tools.**

Agentic Service reduced to its purest form: a runtime kernel that knows nothing about any domain, API type, or protocol -- but can be taught anything through specs, tools, and triggers, all managed through a web UI.

---

## 1. The Core Idea in One Sentence

> A running process that receives triggers, looks up a matching spec, hands the spec and trigger context to an LLM, and lets the LLM call tools to produce a result.

That's it. Everything else -- what triggers exist, what tools are available, what specs say, what shape results take -- is pluggable and configurable at runtime through the UI. Nothing is hardcoded.

---

## 2. The Three Primitives

Agentic Service has exactly three primitives. Everything in the system is built from these.

### 2.1 Spec

A spec is a document (markdown) that tells the LLM what to do when a trigger fires. A spec has:

- **Content**: natural language instructions (markdown body)
- **Tags**: key-value metadata (parsed from frontmatter or set via UI)
- **Matching rules**: how to determine if this spec handles a given trigger

Specs are stored in the runtime's database. They are created, edited, versioned, and deleted through the web UI. No filesystem dependency.

There are no predefined spec types. A spec is just a document with tags. If your project needs "state machine" specs, you tag them `type: state_machine` and write your content accordingly. If you need "api endpoint" specs, tag them `type: route, method: GET, path: /api/users`. The system does not interpret the tags -- it only uses them for matching triggers to specs.

### 2.2 Tool

A tool is a capability the LLM can invoke during spec execution. A tool has:

- **Name**: unique identifier (e.g., `db.query`, `http.request`, `mqtt.publish`)
- **Description**: what it does (shown to the LLM)
- **Input schema**: JSON Schema defining expected parameters
- **Execute function**: the actual implementation

Tools are provided by **plugins** (see section 4). The runtime ships with zero built-in tools. Everything is a plugin, including database access.

### 2.3 Trigger

A trigger is an event that causes the runtime to look up a spec and execute it. A trigger has:

- **Type**: a string identifying the trigger kind (e.g., `http`, `cron`, `mqtt`, `webhook`, `manual`)
- **Context**: the data associated with the event (request body, message payload, timer tick, etc.)
- **Matching criteria**: used to find the right spec(s)

Triggers are provided by **adapters** (see section 5). The runtime ships with zero built-in adapters. Even HTTP serving is a plugin.

---

## 3. The Execution Loop

When a trigger fires, the runtime executes this loop:

```
1. RECEIVE trigger (from any adapter)
2. MATCH trigger against specs (using tags and matching rules)
3. ASSEMBLE prompt:
   - System prompt (generic: "you are a spec executor, use tools, produce a result")
   - Global specs (tagged as global, always included)
   - Matched spec content
   - Trigger context (normalized to JSON)
   - Available tool descriptions
4. CALL LLM with prompt + tools
5. LLM calls tools as needed, runtime executes them
6. LLM produces a result (JSON)
7. RETURN result to the adapter that fired the trigger
```

This loop is the entire runtime. It never changes. What changes is:
- Which adapters provide triggers (configured via plugins)
- Which tools the LLM can call (configured via plugins)
- What the specs say (managed via UI)
- Which LLM is used (configured via settings)

---

## 4. Plugins

A plugin is a package that provides tools, adapters, or both. Plugins are the only way to extend the runtime.

### Plugin Interface

Every plugin exports a single registration function:

```
register(runtime):
  # Register tools
  runtime.register_tool("db.query", { description, schema, execute })
  runtime.register_tool("db.execute", { description, schema, execute })

  # Register trigger adapters
  runtime.register_adapter("http", { start, stop })
  runtime.register_adapter("cron", { start, stop })

  # Register config schema (for UI)
  runtime.register_config("database", { schema, defaults })
```

### Plugin Lifecycle

1. Plugins are declared in the runtime configuration
2. On startup, the runtime loads each plugin and calls `register()`
3. Plugins receive the runtime's config and can set up connections, servers, etc.
4. On shutdown, plugins clean up (close connections, stop servers)

### Plugin Distribution

Plugins can be:
- npm packages (`@agentic-service/plugin-postgres`, `@agentic-service/plugin-mqtt`)
- Local files (`./plugins/my-custom-tool.ts`)
- Built-in starter packs (e.g., a "web api" starter that bundles HTTP adapter + database + crypto + auth tools)

### Example Plugin Configs

```yaml
plugins:
  # A database plugin provides db.query, db.execute, db.transaction tools
  - package: "@agentic-service/plugin-postgres"
    config:
      url: "postgres://localhost:5432/mydb"

  # An HTTP adapter plugin provides the "http" trigger type
  - package: "@agentic-service/plugin-http"
    config:
      port: 8080

  # An MQTT adapter provides the "mqtt" trigger type + mqtt.publish tool
  - package: "@agentic-service/plugin-mqtt"
    config:
      broker: "mqtt://broker.local:1883"
      subscriptions: ["devices/#"]

  # A cron adapter provides the "cron" trigger type
  - package: "@agentic-service/plugin-cron"

  # A custom plugin from a local file
  - path: "./plugins/my-erp-connector.ts"
    config:
      api_url: "https://erp.internal/api"
```

---

## 5. Trigger Adapters in Detail

An adapter is a plugin component that listens for external events and converts them into triggers.

### Adapter Interface

```
Adapter:
  name: string
  start(emit_trigger): void    # Begin listening. Call emit_trigger(context) when events arrive.
  stop(): void                 # Stop listening, clean up.
```

When an adapter calls `emit_trigger(context)`, the runtime:
1. Normalizes the context into a standard envelope
2. Matches it against specs
3. Executes the matched spec
4. Returns the result to the adapter (if the adapter expects a response, like HTTP)

### Trigger Envelope

Every trigger, regardless of source, is normalized to:

```
TriggerEnvelope:
  id: string                   # unique invocation ID
  type: string                 # adapter name (e.g., "http", "mqtt", "cron")
  source: string               # specific source (e.g., "GET /api/users", "devices/sensor-1/temp", "0 * * * *")
  payload: any                 # the event data
  metadata: Record<string, any>  # extra info (headers, message properties, etc.)
  timestamp: string            # when the trigger fired
```

### Spec Matching

The runtime matches a trigger to a spec using the spec's tags. The matching logic is simple:

1. Find all specs where every tag condition matches the trigger
2. If multiple specs match, use specificity ordering (more tags = more specific = higher priority)
3. If no spec matches, the adapter receives a "no handler" result

Tag matching supports:
- **Exact**: `method: GET` matches triggers where `source` starts with `GET`
- **Pattern**: `path: /api/users/:id` matches with parameter extraction
- **Wildcard**: `topic: devices/+/telemetry` matches MQTT-style wildcards
- **Regex**: `pattern: ^/api/v[0-9]+/.*` for complex matching

The matching strategy is adapter-defined. The HTTP adapter knows how to match method + path. The MQTT adapter knows how to match topic patterns. The cron adapter matches schedule expressions.

---

## 6. The Web UI

The web UI is the primary management interface. It is **not** optional -- it is a first-class citizen of the system. Every aspect of Agentic Service is manageable through the UI.

### 6.1 Dashboard

- List of all specs with their tags, last modified, and execution stats
- List of active plugins with their status (connected/error)
- List of registered tools with descriptions
- List of active trigger adapters with their status
- Live invocation log (trigger in, spec matched, tools called, result out)

### 6.2 Spec Editor

- Create/edit/delete specs in a full markdown editor
- Tag editor (key-value pairs, auto-suggest based on installed adapters)
- Version history with diff view
- "Test" button: manually fire a trigger and see the execution trace
- "Duplicate" to create variations quickly
- Folder/grouping by tags for organization

### 6.3 Plugin Manager

- List installed plugins with their provided tools and adapters
- Install new plugins from registry or local path
- Configure plugin settings through generated forms (from the plugin's config schema)
- Enable/disable plugins without restart
- View plugin health and error logs

### 6.4 Tool Explorer

- Browse all registered tools with their descriptions and schemas
- "Try it" panel: call any tool directly with sample inputs and see the output
- Usage stats per tool (call count, avg duration, error rate)

### 6.5 Execution Trace Viewer

- Every invocation is recorded: trigger envelope, matched spec, prompt sent to LLM, tool calls made, LLM response, final result
- Searchable by trigger type, spec, time range, status
- Detailed view shows the full chain: trigger -> spec -> prompt -> tool calls -> result
- Replay button: re-execute a past trigger against the current spec

### 6.6 Settings

- LLM provider configuration (provider, model, API key, temperature)
- Global specs selection (which specs are included in every invocation)
- System prompt customization
- Runtime settings (max tool calls, timeout, concurrency)

---

## 7. Configuration

Agentic Service has a minimal configuration file that bootstraps the runtime. Everything else is managed through the UI and stored in the database.

```yaml
# config.yaml -- the only config file

# Where to store specs, traces, and runtime state
storage:
  driver: sqlite              # sqlite or postgres
  url: "./agentic-service.db"      # connection string

# LLM configuration
llm:
  provider: openai            # openai, anthropic, bedrock, ollama
  model: gpt-4o
  api_key: ""                 # env: AGENTIC_LLM_API_KEY
  temperature: 0.0
  max_tool_calls: 20
  timeout_seconds: 30

# Management UI
ui:
  port: 3000
  auth:
    enabled: false            # enable for production
    username: admin
    password: ""              # env: AGENTIC_UI_PASSWORD

# Plugins to load
plugins: []

# Logging
logging:
  level: info
  format: json
```

That's the entire config. No database schemas. No route tables. No tool definitions. No spec types. All of that lives in the runtime state managed through the UI.

---

## 8. Data Model

Agentic Service stores everything in its own database (the `storage` config). The schema is minimal and fixed:

```sql
-- Specs: the documents the LLM executes
CREATE TABLE specs (
  id          TEXT PRIMARY KEY,
  content     TEXT NOT NULL,          -- markdown body
  tags        TEXT NOT NULL,          -- JSON object of key-value tags
  is_global   BOOLEAN DEFAULT FALSE, -- included in every invocation
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Spec versions: history for rollback
CREATE TABLE spec_versions (
  id          TEXT PRIMARY KEY,
  spec_id     TEXT NOT NULL REFERENCES specs(id),
  content     TEXT NOT NULL,
  tags        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

-- Traces: execution history
CREATE TABLE traces (
  id              TEXT PRIMARY KEY,
  trigger_type    TEXT NOT NULL,
  trigger_source  TEXT NOT NULL,
  trigger_payload TEXT,               -- JSON
  spec_id         TEXT REFERENCES specs(id),
  prompt          TEXT,               -- the assembled prompt
  tool_calls      TEXT,               -- JSON array of tool calls and results
  result          TEXT,               -- JSON result
  status          TEXT NOT NULL,      -- success, error, no_match, timeout
  duration_ms     INTEGER,
  token_usage     TEXT,               -- JSON { input, output }
  created_at      TEXT NOT NULL
);

-- Plugin state: installed plugins and their config
CREATE TABLE plugins (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  package     TEXT NOT NULL,          -- npm package or local path
  config      TEXT,                   -- JSON config
  enabled     BOOLEAN DEFAULT TRUE,
  created_at  TEXT NOT NULL
);

-- Settings: runtime settings managed via UI
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

That's it. Five tables. The entire system state.

---

## 9. What Agentic Service Is Not

- **Not a framework with opinions**: it doesn't know what a "REST API" is, what a "state machine" is, or what "CRUD" means. You teach it through specs and plugins.
- **Not a code generator**: it doesn't produce code. Specs are executed directly at runtime.
- **Not tied to any protocol**: HTTP, MQTT, gRPC, WebSocket, carrier pigeon -- all are just plugins.
- **Not tied to any domain**: task managers, IoT platforms, e-commerce, ML pipelines -- all are just specs.
- **Not a chatbot**: the LLM is an internal execution engine, not a user-facing interface. Users interact through the triggers and the web UI.

---

## 10. How Domains Emerge

Agentic Service doesn't define domains. Domains emerge from the combination of plugins, specs, and tags that users configure. Here are examples of how different use cases would look:

### Example A: REST API Service

Install plugins:
- `@agentic-service/plugin-http` (provides HTTP trigger adapter)
- `@agentic-service/plugin-postgres` (provides db tools)
- `@agentic-service/plugin-crypto` (provides hashing, JWT, password tools)

Create specs with tags:
- `type: route, method: GET, path: /api/users` -> spec describing how to list users
- `type: route, method: POST, path: /api/users` -> spec describing how to create a user
- `type: global` -> spec describing error format, auth rules, domain model

Result: a working REST API, identical in capability to the current Agentic Service.

### Example B: IoT Telemetry Processor

Install plugins:
- `@agentic-service/plugin-mqtt` (provides MQTT trigger adapter + publish tool)
- `@agentic-service/plugin-timescale` (provides time-series db tools)
- `@agentic-service/plugin-http` (for a dashboard API)

Create specs with tags:
- `type: trigger, protocol: mqtt, topic: devices/+/temperature` -> spec for temperature readings
- `type: trigger, protocol: mqtt, topic: devices/+/status` -> spec for status updates
- `type: trigger, protocol: cron, schedule: */5 * * * *` -> spec for health checks
- `type: route, method: GET, path: /api/devices` -> spec for listing devices via HTTP

Result: an IoT service that receives MQTT telemetry, stores it, runs health checks, and exposes an HTTP API.

### Example C: Order Fulfillment Workflow

Install plugins:
- `@agentic-service/plugin-http` (API trigger)
- `@agentic-service/plugin-postgres` (database)
- `@agentic-service/plugin-email` (email tool)
- `@agentic-service/plugin-cron` (scheduled checks)

Create specs with tags:
- `type: route, method: POST, path: /api/orders` -> spec for creating orders
- `type: route, method: POST, path: /api/orders/:id/pay` -> spec for payment
- `type: route, method: POST, path: /api/orders/:id/ship` -> spec for shipping
- `type: global, domain: order-states` -> spec describing valid state transitions
- `type: trigger, protocol: cron, schedule: 0 * * * *` -> spec for checking stale orders

The state machine is just a global spec that the LLM reads when handling order-related triggers. The transitions are enforced by the spec content, not by a special runtime feature.

### Example D: Slack Bot + Database Service

Install plugins:
- `@agentic-service/plugin-http` (for Slack webhook receiver)
- `@agentic-service/plugin-postgres` (database)
- `@agentic-service/plugin-http-client` (to call Slack API)

Create specs:
- `type: webhook, source: slack` -> spec for handling Slack events
- `type: global` -> spec describing Slack message format, response conventions

Result: a Slack bot backend that receives webhook events and responds via the Slack API.

---

## 11. The Hot Path (Progressive Optimization)

The cold-path/hot-path concept from Agentic Service carries over directly:

1. **Cold path**: every trigger runs through the LLM. This is the default. It always works.
2. **Hot path**: for triggers that consistently produce the same tool call pattern, the runtime can generate a deterministic handler that skips the LLM.

In Agentic Service, hot path generation is itself a plugin:
- `@agentic-service/plugin-hotpath` observes execution traces, detects patterns, and generates compiled handlers
- The UI shows which specs have hot paths, their hit rate, and a button to force recompilation
- Shadow verification (run both paths, compare results) is a setting per spec

This keeps the core runtime simple. If you don't need hot paths, don't install the plugin.

---

## 12. System Architecture

```
                    ┌──────────────────────────┐
                    │        Web UI (:3000)     │
                    │  Specs | Plugins | Traces │
                    └────────────┬─────────────┘
                                 │ manages
                                 ▼
┌──────────────────────────────────────────────────────┐
│                  Agentic Service Runtime                   │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              Plugin Manager                     │  │
│  │  loads plugins, registers tools and adapters    │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Adapter:     │  │ Adapter:     │  │ Adapter:  │  │
│  │ HTTP (:8080) │  │ MQTT         │  │ Cron      │  │
│  │ (plugin)     │  │ (plugin)     │  │ (plugin)  │  │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘  │
│         │                 │                 │        │
│         └────────┬────────┴────────┬────────┘        │
│                  ▼                 ▼                  │
│  ┌────────────────────────────────────────────────┐  │
│  │           Execution Engine                      │  │
│  │  1. Match trigger -> spec(s)                    │  │
│  │  2. Assemble prompt (global specs + spec + ctx) │  │
│  │  3. Call LLM with tools                         │  │
│  │  4. Return result to adapter                    │  │
│  └───────────────────┬────────────────────────────┘  │
│                      │                               │
│         ┌────────────┼────────────┐                  │
│         ▼            ▼            ▼                  │
│  ┌───────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Tool:     │ │ Tool:    │ │ Tool:    │  ...        │
│  │ db.query  │ │ crypto   │ │ mqtt     │ (plugins)   │
│  │ (plugin)  │ │ (plugin) │ │ (plugin) │             │
│  └───────────┘ └──────────┘ └──────────┘             │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              Storage (SQLite/Postgres)           │  │
│  │  specs | spec_versions | traces | plugins       │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

---

## 13. Why "Agentic Service"

- **Agentic**: the runtime delegates decision-making to an LLM agent that interprets specs and calls tools autonomously
- **Service**: it runs as a long-lived process that serves requests -- a backend runtime, not a CLI or library
- The name describes exactly what it is: a service powered by an agentic loop

---

## 14. Design Principles

1. **Zero opinions**: the runtime knows nothing about REST, CRUD, state machines, or any domain. It only knows specs, tools, and triggers.
2. **Everything is a plugin**: database, HTTP, auth, cron, messaging -- all provided by plugins. The core has no capabilities of its own beyond LLM execution.
3. **UI-first management**: specs live in the database, not the filesystem. The web UI is the primary interface for everything. (Filesystem/git sync can be a plugin for teams that want it.)
4. **Full traceability**: every invocation is recorded with its full context, tool calls, and result. You can always see why the system did what it did.
5. **Progressive optimization**: start with LLM-interpreted specs (works immediately, slower). Optionally compile to deterministic handlers (faster, requires pattern stability).
6. **Minimal core**: the runtime itself should be a few hundred lines. All complexity lives in plugins and specs.

---

## 15. What Comes Next

This document defines the system at the meta level. The next steps would be:

1. **Build the runtime kernel**: the execution loop, spec store, plugin loader, and trigger matching
2. **Build the web UI**: spec editor, plugin manager, trace viewer, settings
3. **Build the first plugins**: `plugin-http`, `plugin-sqlite`, `plugin-crypto` as a starter pack
4. **Prove it works**: recreate the Agentic Service task-manager example using Agentic Service with plugins and specs
5. **Expand**: build plugins for MQTT, cron, email, message queues, etc. as needed

The whole point is that step 5 never requires changing the runtime. New capabilities are always just new plugins and new specs.
