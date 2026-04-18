# Specs

This folder contains the original source documents that were used to design and build Agentic Service. The implementation was derived directly from these specs — they are the written-first, code-second foundation of the project.

## Vision

- **[agentic-service-vision.md](agentic-service-vision.md)** — The original high-level vision document. Describes the core idea, three primitives (spec, tool, trigger), execution loop, plugin model, and design principles that shaped the entire system.

## Design Specs

The numbered spec files define the system in detail, from concepts to implementation:

| File | Topic |
|------|-------|
| [01-core-concepts.md](01-core-concepts.md) | Foundational concepts and terminology |
| [02-architecture.md](02-architecture.md) | System architecture and module boundaries |
| [03-tool-specification.md](03-tool-specification.md) | Tool registry and built-in tools |
| [04-business-logic-format.md](04-business-logic-format.md) | Spec file format and LLM prompt assembly |
| [05-api-layer.md](05-api-layer.md) | HTTP server, routing, and middleware |
| [06-configuration.md](06-configuration.md) | Config schema and environment overrides |
| [07-security.md](07-security.md) | Security model and considerations |
| [08-developer-guide.md](08-developer-guide.md) | Developer workflow and extensibility |
| [09-hot-path.md](09-hot-path.md) | Hot path (tool handler) optimization |
| [10-technology-decisions.md](10-technology-decisions.md) | Technology choices and rationale |

## Proposals

Proposals explore specific features or architectural ideas that evolved the system after the initial build:

- **[proposal-scaling-beyond-crud.md](proposal-scaling-beyond-crud.md)** — How the spec-driven model scales to non-CRUD use cases.
- **[proposal-single-function-handlers-with-spec-hashes.md](proposal-single-function-handlers-with-spec-hashes.md)** — A mechanism for deterministic single-function hot path handlers tied to spec hashes.
