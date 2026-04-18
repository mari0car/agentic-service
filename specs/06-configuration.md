# Configuration Specification

This document defines all configuration options for an Agentic Service instance.

## 1. Configuration Sources

Configuration is loaded in this priority order (higher overrides lower):

1. **Environment variables** (highest priority)
2. **Config file** (`config.yaml` or `config.json`)
3. **Defaults** (lowest priority)

Environment variable naming convention: `AGENTIC_<SECTION>_<KEY>` (uppercase, underscores).

Example: `server.port` in config → `AGENTIC_SERVER_PORT` as env var.

## 2. Full Configuration Reference

### 2.1 Server

```yaml
server:
  # HTTP server settings
  host: "0.0.0.0"              # Bind address
  port: 8080                    # Main API port
  admin_port: 9090              # Admin API port (0 = same as main port)
  
  # Request limits
  max_request_size: "1mb"       # Maximum request body size
  request_timeout: 30s          # Default timeout per request
  
  # Concurrency
  max_concurrent_requests: 20   # Maximum parallel agent invocations
  
  # CORS
  cors:
    enabled: true
    allowed_origins: ["*"]      # List of origins or "*"
    allowed_methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    allowed_headers: ["Authorization", "Content-Type"]
    expose_headers: ["X-Request-Id"]
    max_age: 86400              # Preflight cache duration in seconds
  
  # Rate limiting
  rate_limit:
    enabled: true
    requests_per_window: 100    # Max requests per window
    window_seconds: 60          # Window duration
    by: "ip"                    # "ip" or "user" (requires auth)
  
  # TLS (optional)
  tls:
    enabled: false
    cert_file: ""
    key_file: ""
```

### 2.2 LLM Provider

```yaml
llm:
  # Provider selection
  provider: "openai"            # "openai", "anthropic", "bedrock", "azure", "ollama", "custom"
  
  # Connection
  api_key: ""                   # API key (prefer env: AGENTIC_LLM_API_KEY)
  base_url: ""                  # Override base URL (for proxies, custom endpoints)
  
  # Model
  model: "gpt-4o"              # Model identifier
  
  # Inference parameters
  temperature: 0.0              # 0.0 for deterministic, higher for creative
  max_output_tokens: 4096       # Maximum tokens in agent response
  
  # Budgets (per request)
  max_input_tokens: 8000        # Maximum context tokens sent to LLM
  max_tool_calls: 20            # Maximum tool calls per request
  
  # Retry
  retry:
    max_retries: 3
    initial_backoff_ms: 500
    max_backoff_ms: 5000
  
  # Provider-specific
  openai:
    organization: ""
  anthropic:
    version: "2024-01-01"
  bedrock:
    region: "us-east-1"
    access_key_id: ""
    secret_access_key: ""
  azure:
    deployment_name: ""
    api_version: ""
  ollama:
    host: "http://localhost:11434"
```

### 2.3 Specs

```yaml
specs:
  # Directory containing specification files
  directory: "./specs"
  
  # Route definition file (relative to specs directory)
  routes_file: "api-routes.md"
  
  # Global specs included in every request context
  global_specs:
    - "service.md"
    - "domain.md"
    - "error-handling.md"
    - "data-model.md"
  
  # Hot reload
  watch: false                  # Watch for file changes and reload
  watch_debounce_ms: 500        # Debounce interval for file changes
  
  # Validation
  validate_on_startup: true     # Validate spec structure at startup
  strict_validation: false      # Fail startup on validation warnings
```

### 2.4 Database

```yaml
database:
  # Connection
  driver: "postgres"            # "postgres", "sqlite", "mysql"
  url: ""                       # Full connection URL (prefer env: AGENTIC_DATABASE_URL)
  
  # Or individual components (used if url is empty)
  host: "localhost"
  port: 5432
  name: "agentic-service"
  user: ""
  password: ""                  # Prefer env: AGENTIC_DATABASE_PASSWORD
  ssl_mode: "prefer"            # "disable", "prefer", "require", "verify-full"
  
  # Pool
  max_connections: 20
  min_connections: 2
  connection_timeout_ms: 5000
  idle_timeout_ms: 300000
  
  # Query limits
  query_timeout_ms: 5000        # Max query execution time
  max_rows: 1000                # Max rows returned per query
  
  # Safety
  allow_ddl: false              # Allow CREATE/ALTER/DROP statements
  read_only: false              # Restrict to SELECT only (no INSERT/UPDATE/DELETE)
  
  # Migrations (optional)
  migrations:
    directory: "./migrations"   # SQL migration files
    auto_migrate: false          # Run migrations on startup
```

### 2.5 Cache

```yaml
cache:
  # Backend
  driver: "memory"              # "memory" (in-process) or "redis"
  
  # Redis settings (if driver=redis)
  redis:
    url: ""                     # Redis connection URL
    host: "localhost"
    port: 6379
    password: ""
    db: 0
    tls: false
  
  # Limits
  max_entries: 10000            # Max entries for in-memory cache
  default_ttl_seconds: 3600     # Default TTL if not specified per entry
```

### 2.6 Filesystem

```yaml
filesystem:
  # Sandbox directory (agent can only access files within this directory)
  sandbox_directory: "./data"
  
  # Limits
  max_file_size: "10mb"         # Max file size for read/write
  allowed_extensions: []        # Empty = allow all. Example: [".json", ".csv", ".txt"]
```

### 2.7 HTTP Client

```yaml
http_client:
  # URL allowlist (empty = allow all, which is NOT recommended for production)
  allowed_urls: []
  # Example:
  # allowed_urls:
  #   - "https://api.stripe.com/*"
  #   - "https://payments.internal/*"
  #   - "https://notifications.internal/*"
  
  # Limits
  default_timeout_ms: 10000
  max_timeout_ms: 30000
  max_response_size: "5mb"
  
  # TLS
  insecure_skip_verify: false   # Skip TLS verification (NEVER in production)
  
  # Default headers added to all outbound requests
  default_headers:
    User-Agent: "Agentic Service/1.0"
```

### 2.8 Messaging

```yaml
messaging:
  # Backend
  driver: "nats"                # "nats", "rabbitmq", "kafka", "none"
  
  # NATS
  nats:
    url: "nats://localhost:4222"
    credentials_file: ""
    
  # RabbitMQ
  rabbitmq:
    url: "amqp://guest:guest@localhost:5672/"
    
  # Kafka
  kafka:
    brokers: ["localhost:9092"]
    group_id: "agentic-service"
```

### 2.9 Email

```yaml
email:
  # Provider
  driver: "smtp"                # "smtp", "sendgrid", "ses", "none"
  
  # SMTP
  smtp:
    host: "localhost"
    port: 587
    username: ""
    password: ""
    tls: true
  
  # Sendgrid
  sendgrid:
    api_key: ""
  
  # Common
  from_address: "noreply@example.com"
  from_name: "Agentic Service"
  
  # Rate limiting
  max_per_minute: 10
  
  # Allowlist (empty = allow all)
  allowed_recipient_domains: []
```

### 2.10 Authentication

```yaml
auth:
  # JWT settings
  jwt:
    secret: ""                  # Prefer env: AGENTIC_AUTH_JWT_SECRET
    algorithm: "HS256"          # "HS256", "RS256", "ES256"
    public_key_file: ""         # For RS256/ES256
    issuer: "agentic-service"
    expiry_seconds: 3600        # Default token lifetime
  
  # API key authentication (for service-to-service)
  api_keys:
    enabled: false
    header: "X-API-Key"
    keys: []                    # List of valid API keys
  
  # Admin API
  admin:
    enabled: true
    api_key: ""                 # Prefer env: AGENTIC_AUTH_ADMIN_API_KEY
    localhost_only: true         # Only allow from 127.0.0.1
```

### 2.11 Logging

```yaml
logging:
  # Level
  level: "info"                 # "debug", "info", "warn", "error"
  
  # Format
  format: "json"                # "json" or "text" (text for development)
  
  # Agent traces
  log_agent_traces: false       # Log full agent conversations (verbose, may contain PII)
  log_tool_calls: true          # Log tool call names and durations
  log_request_bodies: false     # Log request bodies (may contain sensitive data)
  log_response_bodies: false    # Log response bodies
```

### 2.12 Observability

```yaml
observability:
  # Metrics
  metrics:
    enabled: true
    path: "/metrics"            # Prometheus scrape path
  
  # Tracing
  tracing:
    enabled: false
    exporter: "otlp"            # "otlp", "jaeger", "zipkin"
    endpoint: "http://localhost:4317"
    sample_rate: 0.1            # Sample 10% of requests
```

### 2.13 MCP Server

```yaml
mcp:
  # Enable MCP server
  enabled: true
  
  # Transport
  transport: "http-sse"         # "stdio" or "http-sse"
  path: "/mcp"                  # HTTP path for MCP endpoint
  
  # Tool exposure
  expose_all_routes: true       # Auto-generate MCP tools from all routes
  exclude_routes: []            # Routes to exclude from MCP exposure
  
  # Resources
  expose_specs: false           # Expose spec files as MCP resources
  expose_schema: false          # Expose data model as MCP resource
```

## 3. Minimal Configuration

The absolute minimum to get a service running:

```yaml
llm:
  provider: "openai"
  api_key: "sk-..."            # Or set AGENTIC_LLM_API_KEY
  model: "gpt-4o"

database:
  driver: "sqlite"
  url: "file:./data.db"

specs:
  directory: "./specs"
```

Everything else uses defaults.

## 4. Environment Variable Mapping

All config values can be set via environment variables using the pattern `AGENTIC_<PATH>`:

| Config Path | Environment Variable |
|-------------|---------------------|
| `server.port` | `AGENTIC_SERVER_PORT` |
| `llm.api_key` | `AGENTIC_LLM_API_KEY` |
| `llm.model` | `AGENTIC_LLM_MODEL` |
| `database.url` | `AGENTIC_DATABASE_URL` |
| `auth.jwt.secret` | `AGENTIC_AUTH_JWT_SECRET` |

Secrets (API keys, passwords, JWT secrets) should always be set via environment variables, never in config files.

## 5. Per-Route Overrides

Some settings can be overridden per route via spec frontmatter:

```yaml
---
route: POST /api/reports/generate
timeout: 120s                   # Override: 2 minutes for this endpoint
max_tool_calls: 50              # Override: allow more tool calls
max_output_tokens: 8192         # Override: larger response
cache_ttl: 300                  # Cache response for 5 minutes
---
```

Override-eligible settings:
- `timeout`
- `max_tool_calls`
- `max_output_tokens`
- `max_input_tokens`
- `cache_ttl`
- `rate_limit` (per-route rate limiting)
