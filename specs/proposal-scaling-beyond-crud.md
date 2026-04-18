# Scaling Agentic Service Beyond CRUD: A Vision for Universal Microservice Intelligence

## Executive Summary

Agentic Service has proven that LLM-interpreted markdown specifications can replace hand-coded business logic for CRUD API services. The current architecture -- a request-response HTTP server with a tool registry of database, crypto, time, and validation tools -- handles this pattern well.

However, the modern microservice landscape extends far beyond REST/CRUD. Services manage state machines, react to events, orchestrate IoT devices, process real-time streams, coordinate distributed workflows, and implement domain-specific protocols. This proposal analyzes where the current architecture excels, where it fundamentally cannot stretch, and what changes are needed to make Agentic Service a universal framework for any microservice domain.

The core thesis remains sound: **if an LLM can interpret a specification and execute it through tools, the specification replaces code.** What changes is the *shape* of the specification, the *trigger model* for execution, and the *tool surface area* available to the agent.

---

## Part 1: What Works and What Doesn't

### Current Architecture Strengths

1. **Request-response mapping** -- one HTTP request triggers one agent invocation that produces one response. Clean, stateless, predictable.
2. **Tool-mediated execution** -- the agent never touches infrastructure directly. All side effects go through the sandboxed tool registry.
3. **Progressive optimization** -- the cold-path (LLM) to hot-path (compiled handler) gradient with shadow verification.
4. **Spec-driven routing** -- markdown files are the single source of truth for business logic.
5. **Dual execution paths** -- every route can be served by LLM or handler, with per-route control.

### Fundamental Limitations for Non-CRUD Domains

| Limitation | Impact |
|---|---|
| **Synchronous-only trigger model** | Cannot react to events, timers, device signals, or message queue messages. Only HTTP requests trigger agent invocations. |
| **Stateless between requests** | No native concept of workflows spanning multiple requests, long-running processes, or state machine transitions that persist across invocations. |
| **Single-database tool surface** | No tools for message brokers, IoT protocols (MQTT/CoAP), gRPC, WebSockets, object storage, or external SaaS APIs. The spec documents mention these but they aren't implemented. |
| **Request-scoped execution only** | Cannot run background tasks, scheduled jobs, data pipelines, or continuous monitoring loops. |
| **JSON-in/JSON-out response model** | Cannot produce streaming responses, binary payloads, server-sent events, or protocol-specific frames. |
| **Flat spec structure** | No formal way to express state machines, workflows, sagas, or multi-step processes that span time. |

---

## Part 2: The Universal Trigger Model

The most fundamental change needed is expanding *what triggers an agent invocation* beyond HTTP requests.

### Current Model

```
HTTP Request --> Agent Invocation --> HTTP Response
```

### Proposed Model: The Invocation Envelope

```
Trigger Source          Agent Invocation          Side Effects
─────────────          ──────────────────        ────────────
HTTP Request    ─┐
Message Queue    ├──>  Spec Lookup               ┌──> HTTP Response
MQTT Message     │     Prompt Assembly    ──>     ├──> Publish Message
Cron Schedule    │     Tool Execution             ├──> Update State Machine
WebSocket Frame  │     Response Production        ├──> Fire Webhook
State Transition │                                ├──> Send Device Command
Webhook Receipt ─┘                                └──> Emit Event
```

Every trigger produces an **InvocationEnvelope** -- a normalized context object the agent receives regardless of trigger source:

```
InvocationEnvelope:
  trigger_type: "http" | "message" | "mqtt" | "cron" | "state_transition" | "webhook" | "websocket"
  trigger_source: string           # queue name, topic, cron expression, etc.
  payload: unknown                 # the trigger-specific data
  metadata: Record<string, any>    # headers, message properties, device info
  auth: AuthContext                # normalized auth regardless of source
  correlation_id: string           # for tracing across async boundaries
  timestamp: string
```

The prompt assembler already builds a `RequestContext` for HTTP requests (see `src/agent/prompt-assembler.ts`). The InvocationEnvelope generalizes this to any trigger type. Spec files would define which trigger they handle:

```markdown
---
trigger: message
queue: orders.created
---
# Handle New Order Event
When a new order is created, send a confirmation email and update inventory.
```

```markdown
---
trigger: cron
schedule: "0 */6 * * *"
---
# Clean Up Expired Sessions
Every 6 hours, delete sessions older than 24 hours.
```

```markdown
---
trigger: mqtt
topic: devices/+/telemetry
---
# Process Device Telemetry
Validate the reading, store it, and check if any thresholds are exceeded.
```

### Architectural Impact

This requires adding **trigger adapters** alongside the existing Hono HTTP server. Each adapter listens on its protocol, normalizes incoming triggers into InvocationEnvelopes, and feeds them into the existing agent execution pipeline. The agent, spec store, and tool registry remain largely unchanged -- only the entry point diversifies.

---

## Part 3: State Machines and Workflows

### The Problem

Many domains require entities that progress through defined states with rules about valid transitions, guards, and side effects. Currently, state logic must be embedded in individual endpoint specs without any formal structure. Nothing prevents the LLM from executing an invalid transition.

### Proposed Approach: First-Class State Machine Specs

Introduce a new spec type -- the **state machine spec** -- that formally defines states, transitions, guards, and actions:

```markdown
---
type: state_machine
entity: order
initial_state: draft
---
# Order Lifecycle

## States
- **draft** -- order is being assembled
- **submitted** -- order awaits payment
- **paid** -- payment confirmed, awaiting fulfillment
- **shipped** -- in transit
- **delivered** -- received by customer
- **cancelled** -- order was cancelled
- **refunded** -- payment returned

## Transitions

### submit: draft -> submitted
Guard: Order must have at least one item and a valid shipping address.
Action: Send order confirmation email. Lock product inventory.

### pay: submitted -> paid
Guard: Payment must be verified. Amount must match order total.
Action: Create payment record. Notify fulfillment system.

### ship: paid -> shipped
Guard: All items must be in stock and packed.
Action: Generate tracking number. Notify customer with tracking link.

### deliver: shipped -> delivered
Guard: Delivery confirmation received from carrier.
Action: Close the order. Trigger customer satisfaction survey after 24 hours.

### cancel: [draft, submitted] -> cancelled
Guard: Cannot cancel if already paid (must refund instead).
Action: Release locked inventory. Send cancellation email.

### refund: [paid, shipped] -> refunded
Guard: Refund amount must not exceed payment amount.
Action: Process refund through payment provider. Release inventory if not shipped.
```

### Runtime Support

The runtime would provide a `state_machine` tool category:

- `state_machine.get_state(entity_type, entity_id)` -- read current state
- `state_machine.transition(entity_type, entity_id, transition_name, data)` -- attempt a transition
- `state_machine.get_valid_transitions(entity_type, entity_id)` -- list currently valid transitions
- `state_machine.get_history(entity_type, entity_id)` -- transition audit log

Transition execution would be handled deterministically by the runtime, not by the LLM:

1. Load the state machine spec
2. Validate the transition is allowed from the current state
3. Evaluate guard conditions (can delegate to the LLM for complex guards)
4. Execute the transition atomically (update state in DB)
5. Execute side-effect actions (can delegate to the LLM)
6. Record the transition in the audit log

This is a case where **the runtime should enforce correctness** rather than trusting the LLM. The LLM's role shifts from "decide what transition to make" to "evaluate complex guard conditions" and "orchestrate side-effect actions."

### Long-Running Workflows / Sagas

For multi-step processes that span time (order fulfillment, customer onboarding, approval chains), extend state machines into **workflow specs**:

```markdown
---
type: workflow
name: customer_onboarding
---
# Customer Onboarding Workflow

## Steps
1. **create_account** -- Register user, send verification email
2. **verify_email** -- Wait for email verification (timeout: 48h)
3. **complete_profile** -- User fills in profile details
4. **verify_identity** -- Submit ID for KYC check (async, wait for callback)
5. **activate** -- Enable full account access
6. **welcome** -- Send welcome kit, assign onboarding specialist

## Error Handling
- If verify_email times out: send reminder, extend 24h, then cancel.
- If verify_identity fails: route to manual review queue.
```

Workflow execution requires **persistent state**, **timer management**, and **async continuation** -- three capabilities the current architecture lacks entirely. This is a genuine architectural addition, not just a new tool.

---

## Part 4: Event-Driven and Streaming Patterns

### Event Sourcing and CQRS

Some services are built on the principle that state is derived from an append-only log of events, with separate read and write models. This requires:

- **Event store tools**: `event_store.append(stream, event_type, data)`, `event_store.read(stream, from_version)`, `event_store.subscribe(stream_pattern)`
- **Projection specs**: markdown files that define how events are folded into read models
- **Event trigger adapter**: agent invocations triggered by new events, not HTTP requests

A projection spec might look like:

```markdown
---
type: projection
name: order_summary
events: [order.created, order.item_added, order.item_removed, order.submitted]
---
# Order Summary Projection
Maintain a denormalized order_summaries table.

When **order.created**: INSERT a new row with initial values.
When **order.item_added**: UPDATE the item count and recalculate total.
When **order.item_removed**: UPDATE the item count and recalculate total.
When **order.submitted**: SET status = 'submitted' and submitted_at = now.
```

### Message-Driven Architecture

For services that communicate via message brokers (Kafka, NATS, RabbitMQ, SQS), implement:

- **Message consumer adapter**: listens on queues/topics, triggers agent invocations
- **Message producer tool**: `messaging.publish(topic, payload, headers)`
- **Request-reply tool**: `messaging.request(topic, payload, timeout)`
- **Dead letter handling**: specs for handling messages that fail processing

### Real-Time Streaming

For services that process continuous data streams (IoT telemetry, financial ticks, log aggregation):

- **Stream processor adapter**: consumes from a stream (Kafka, Kinesis, Redis Streams)
- **Windowing specs**: define time windows for aggregation
- **Stream output tool**: produce results to downstream streams or stores

This is where the request-response model breaks down most severely. A stream processor runs continuously, not per-request. This may require a fundamentally different execution mode -- a **long-running agent loop** rather than per-invocation agents.

---

## Part 5: IoT and Device Management

### Protocol Adapters

IoT devices don't speak HTTP. They use MQTT, CoAP, LwM2M, Modbus, BLE, and proprietary protocols. Agentic Service needs protocol-specific trigger adapters:

- **MQTT adapter**: subscribe to topics, trigger specs on message arrival
- **CoAP adapter**: handle constrained device requests
- **Device shadow/twin**: maintain a virtual representation of device state

### Device Management Tools

- `device.get_shadow(device_id)` -- read the device's reported and desired state
- `device.update_desired(device_id, state)` -- set desired state (device will sync)
- `device.send_command(device_id, command, params)` -- direct command to device
- `device.list(filter)` -- query the device registry
- `device.get_telemetry(device_id, time_range)` -- read historical sensor data

### IoT-Specific Spec Patterns

```markdown
---
trigger: mqtt
topic: devices/+/telemetry
---
# Process Temperature Reading

## Logic
1. Parse the telemetry payload (device_id from topic, temperature from body)
2. Validate reading is within sensor range (-40 to 125 C)
3. Store in time-series table
4. If temperature > threshold for this device's zone, create an alert
5. If temperature > critical_threshold, send command to activate cooling
```

```markdown
---
trigger: cron
schedule: "*/5 * * * *"
---
# Device Health Check

## Logic
1. Query all devices where last_seen > 10 minutes ago
2. For each stale device, update status to "offline"
3. If device was previously "online", create a connectivity alert
4. Aggregate fleet health metrics and publish to monitoring topic
```

### Time-Series Considerations

IoT services deal heavily with time-series data. This may warrant specialized time-series tools or integration with purpose-built time-series databases (TimescaleDB, InfluxDB, QuestDB) rather than relying solely on the general-purpose database tool.

---

## Part 6: Domain-Specific Logic Patterns

### Rules Engines

Some domains (insurance, lending, compliance, pricing) are governed by complex rule sets that change frequently. Rather than embedding rules in individual endpoint specs, introduce **rule set specs**:

```markdown
---
type: rules
name: loan_eligibility
---
# Loan Eligibility Rules

## Rule: minimum_credit_score
Condition: applicant.credit_score >= 620
Result: eligible = true

## Rule: debt_to_income_ratio
Condition: applicant.monthly_debt / applicant.monthly_income < 0.43
Result: eligible = true

## Rule: employment_history
Condition: applicant.years_employed >= 2
Result: eligible = true

## Evaluation
All rules must pass for eligibility. If any rule fails, return the failing rules as denial reasons.
```

The runtime would provide a `rules.evaluate(rule_set, data)` tool that loads the rule spec and evaluates it. Like state machines, simple rule evaluation should be deterministic (handled by the runtime), with the LLM reserved for rules that require natural-language interpretation.

### Approval Workflows

Common in enterprise: a request must be approved by one or more parties before proceeding. This combines state machines with notification tools:

```markdown
---
type: workflow
name: purchase_approval
---
# Purchase Approval

## Routing
- Amount < $1,000: auto-approve
- Amount $1,000 - $10,000: manager approval required
- Amount > $10,000: manager + finance director approval
- Amount > $100,000: VP approval required

## Steps
1. Submit request with justification
2. Route to appropriate approver(s) based on amount
3. Wait for approval (timeout: 72 hours)
4. If approved: create purchase order, notify requester
5. If rejected: notify requester with reason
6. If timeout: escalate to approver's manager
```

### Data Pipelines and ETL

Services that ingest, transform, and load data can express pipelines as specs:

```markdown
---
trigger: cron
schedule: "0 2 * * *"
type: pipeline
---
# Daily Sales Report Pipeline

## Steps
1. **Extract**: Query orders from the past 24 hours
2. **Transform**: Aggregate by product category, calculate totals and averages
3. **Enrich**: Join with product catalog for category names
4. **Load**: Write summary to reporting_daily_sales table
5. **Notify**: Send Slack message with top-level metrics
```

### ML Model Serving

For services that wrap ML models behind APIs:

- `model.predict(model_name, input)` -- run inference
- `model.get_metadata(model_name)` -- version, training date, metrics
- `model.list()` -- available models

The spec would describe pre-processing, model selection, post-processing, and fallback logic in natural language while the actual inference runs through a tool calling an ML runtime (TensorFlow Serving, Triton, ONNX Runtime).

---

## Part 7: Protocol and API Type Expansion

### Beyond REST: gRPC

gRPC services use Protocol Buffers and streaming. Supporting gRPC requires:

- A gRPC server adapter (alongside the existing Hono HTTP server)
- Protobuf-aware request/response serialization
- Support for unary calls (similar to current HTTP), server streaming, client streaming, and bidirectional streaming
- Spec files that reference `.proto` service definitions

### Beyond REST: GraphQL

GraphQL services resolve a query tree rather than mapping to a single endpoint. This requires rethinking the spec-to-route mapping:

- A GraphQL schema definition (can reference spec files for resolver logic)
- Per-field or per-type resolver specs
- The agent would receive the resolved query/mutation rather than an HTTP endpoint

### WebSocket Support

Long-lived connections with bidirectional messaging:

- A WebSocket adapter that manages connections
- Per-message agent invocations (or a persistent agent session per connection)
- Connection lifecycle specs (on_connect, on_message, on_disconnect)
- Tools for sending messages to specific connections or broadcasting

### Server-Sent Events (SSE)

For real-time updates to web clients:

- SSE endpoint specs that define what events to emit and when
- Integration with the event/messaging system to bridge internal events to SSE streams

---

## Part 8: Architectural Changes Required

### 8.1 The Execution Scheduler

The current architecture has a single execution path: HTTP request in, agent invocation, HTTP response out. To support all the patterns above, introduce an **Execution Scheduler** that manages different invocation lifecycles:

| Execution Mode | Trigger | Duration | State |
|---|---|---|---|
| **Request-Response** (current) | HTTP request, gRPC call | Milliseconds to seconds | Stateless |
| **Event-Driven** | Message, MQTT, webhook | Milliseconds to seconds | Stateless per event |
| **Scheduled** | Cron expression | Seconds to minutes | Stateless per run |
| **Workflow Step** | State transition, timer, external callback | Milliseconds | Reads/writes persistent workflow state |
| **Stream Processing** | Continuous stream | Long-running | Maintains windowed state |
| **Connection-Bound** | WebSocket lifecycle | Connection duration | Per-connection state |

### 8.2 Plugin Architecture for Tools

The current `buildToolRegistry` function (in `src/tools/registry.ts`) creates a fixed set of tools. For domain extensibility, move to a **plugin architecture**:

- Tool plugins are npm packages or local modules implementing a standard interface
- Each plugin registers its tools, configuration schema, and setup/teardown lifecycle
- Plugins can declare dependencies (e.g., MQTT plugin depends on a broker connection)
- The config file declares which plugins to load

```yaml
plugins:
  - name: "@agentic-service/plugin-mqtt"
    config:
      broker_url: "mqtt://broker.local:1883"
      topics: ["devices/#"]

  - name: "@agentic-service/plugin-state-machine"
    config:
      storage: "database"

  - name: "@agentic-service/plugin-scheduler"
    config:
      timezone: "UTC"

  - name: "./plugins/custom-erp-connector"
    config:
      base_url: "https://erp.internal/api"
```

### 8.3 Spec Type System

The current spec store (in `src/specs/store.ts`) treats all specs as flat markdown files with optional frontmatter. For the patterns described above, introduce **typed specs**:

| Spec Type | Purpose |
|---|---|
| `route` (existing) | HTTP endpoint handler |
| `state_machine` | Entity state definitions and transition rules |
| `workflow` | Multi-step, long-running process definitions |
| `projection` | Event-to-read-model transformation rules |
| `rules` | Business rule sets for deterministic evaluation |
| `pipeline` | Data transformation and ETL sequences |
| `trigger` | Event/message/cron handler (non-HTTP) |
| `connection` | WebSocket/long-lived connection handler |
| `global` (existing) | Domain context loaded for all invocations |

Each type has its own frontmatter schema, validation rules, and runtime behavior. The spec store validates type-specific requirements at startup.

### 8.4 Persistent Execution Context

For workflows and state machines, introduce a persistent execution context store:

- Workflow instances are tracked in a `_workflow_instances` table
- Each instance has a current step, state data, and scheduled timers
- The scheduler resumes workflow instances when timers fire or callbacks arrive
- Instance state is passed to the agent as part of the InvocationEnvelope

### 8.5 Hybrid Deterministic/Probabilistic Execution

A key insight from analyzing the domains: **not everything should go through the LLM.** Some operations must be deterministic:

- State machine transition validation (must follow the defined graph)
- Rule engine evaluation (must evaluate all rules consistently)
- Workflow step sequencing (must follow the defined order)
- Schema validation (must match exactly)

The proposed approach is a **hybrid execution model**:

1. **Deterministic layer**: The runtime handles structural correctness (valid transitions, rule evaluation, workflow sequencing) without the LLM.
2. **Intelligent layer**: The LLM handles natural-language interpretation within those structures (complex guard conditions, side-effect orchestration, error recovery decisions).

This preserves the core Agentic Service value proposition (specs replace code) while ensuring correctness where non-determinism would be harmful.

---

## Part 9: Scaling the Spec Language

### Composable Specs

As services grow complex, individual specs need to reference and compose with each other:

```markdown
---
route: POST /api/orders
---
# Create Order

## Logic
1. Validate input per `rules/order-validation`
2. Transition order state per `state-machines/order` (transition: create)
3. Execute payment workflow per `workflows/payment-processing`
4. Publish event: order.created
```

This requires the runtime to resolve spec references, prevent circular dependencies, and pass context between composed specs.

### Conditional Spec Loading

Based on request properties, different spec variants could be loaded:

```markdown
---
route: POST /api/payments
variants:
  - condition: body.provider == "stripe"
    spec: payments/stripe-charge.md
  - condition: body.provider == "paypal"
    spec: payments/paypal-charge.md
  - default: payments/generic-charge.md
---
```

### Spec Inheritance

Common patterns across endpoints (authentication, pagination, error handling) can be extracted into base specs that other specs inherit from:

```markdown
---
route: GET /api/products
inherits: base/authenticated-list-endpoint.md
---
# List Products
## Query
Select from products table with soft-delete filter.
```

---

## Part 10: Operational Considerations

### Observability for Non-HTTP Invocations

The current logging and metrics are HTTP-centric (method, path, status code). For universal support:

- Normalize metrics labels to use `trigger_type` and `trigger_source` alongside method/path
- Add workflow-specific metrics (instance count, step duration, timeout rate)
- Add state machine metrics (transition count, invalid transition attempts)
- Add message processing metrics (throughput, lag, dead letter rate)

### Testing Non-HTTP Specs

Extend the test framework to support:

- Message trigger tests (simulate a message arriving on a queue)
- Timer trigger tests (simulate a cron tick)
- State machine tests (verify transition graph properties: reachability, deadlock freedom)
- Workflow tests (simulate multi-step processes with mocked external callbacks)
- IoT tests (simulate device telemetry streams)

### Hot-Path Applicability

The existing hot-path/JIT compilation concept extends naturally to non-HTTP triggers. An MQTT message handler that always runs the same tool sequence can be compiled just like an HTTP endpoint. Scheduled jobs are even more amenable to compilation since their inputs are more predictable.

However, workflows and stream processing are fundamentally harder to compile because they maintain state across invocations.

---

## Part 11: Prioritized Implementation Roadmap

### Phase 1: Foundation (Trigger Model + Plugin Architecture)

- Generalize `RequestContext` to `InvocationEnvelope`
- Implement the plugin architecture for tool registration
- Add cron/scheduler trigger adapter (simplest non-HTTP trigger)
- Implement the filesystem and http_client tools (already spec'd in docs but not built)

**Unlocks**: scheduled jobs, background tasks, webhook receipt, external API integration.

### Phase 2: Event-Driven (Messaging + Events)

- Implement messaging tools (publish, subscribe, request-reply)
- Add message queue trigger adapter (NATS, SQS, or Kafka)
- Implement basic event sourcing primitives
- Add the `trigger` spec type

**Unlocks**: event-driven architectures, async processing, service-to-service messaging.

### Phase 3: Stateful Patterns (State Machines + Workflows)

- Implement the state machine runtime and tools
- Add persistent workflow execution context
- Implement timer management for workflow timeouts
- Add the `state_machine` and `workflow` spec types

**Unlocks**: order management, approval workflows, complex entity lifecycles, any process with defined states.

### Phase 4: IoT and Protocols

- Implement MQTT trigger adapter
- Add device management tools
- Add time-series storage integration
- Implement WebSocket adapter

**Unlocks**: IoT device management, real-time monitoring, telemetry processing, bidirectional communication.

### Phase 5: Advanced Patterns

- Implement rules engine runtime
- Add gRPC and GraphQL adapters
- Implement stream processing mode
- Add spec composition, inheritance, and variant loading

**Unlocks**: complex business rules, multi-protocol services, data pipelines, ML serving.

---

## Summary

Agentic Service's core idea -- LLM-interpreted specifications replacing hand-coded business logic -- is not limited to CRUD APIs. It applies to any domain where business logic can be expressed in structured natural language and executed through tool calls. What needs to change is:

1. **Trigger model**: from HTTP-only to any event source
2. **Execution modes**: from request-response-only to scheduled, event-driven, workflow, and streaming
3. **Tool surface**: from database/crypto/time to plugins covering messaging, IoT, state machines, rules, and external integrations
4. **Spec types**: from flat route specs to typed specs for state machines, workflows, projections, rules, and pipelines
5. **Determinism boundary**: the runtime should enforce structural correctness (valid transitions, rule evaluation) while the LLM handles interpretation within those structures

The fundamental insight is preserved: **the specification is the runtime artifact.** What scales is the vocabulary of specifications and the breadth of triggers and tools they can leverage.
