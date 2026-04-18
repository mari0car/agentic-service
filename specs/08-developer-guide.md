# Developer Guide

This document covers how to extend the Agentic Service runtime: adding custom tools, customizing middleware, and integrating with additional infrastructure.

## 1. Adding Custom Tools

The built-in tools cover common needs, but many services require custom integrations. Custom tools are additional capabilities you make available to the agent.

### 1.1 Tool Interface

Every tool implements this interface (pseudocode):

```
Tool {
  name: string                          // e.g., "payment"
  description: string                   // Human-readable description for the agent
  operations: map[string]Operation      // Named operations
}

Operation {
  name: string                          // e.g., "charge"
  description: string                   // What this operation does
  input_schema: JSONSchema              // Input validation schema
  output_schema: JSONSchema             // Output format schema
  execute(input: object) -> object      // The actual implementation
}
```

### 1.2 Example: Payment Tool

```
Tool: payment
Description: Process payments via Stripe

Operations:

  payment.charge
    Description: Charge a payment method
    Input:
      amount: integer (required) - Amount in cents
      currency: string (required) - ISO 4217 currency code
      payment_method_id: string (required) - Stripe payment method ID
      description: string (optional)
    Output:
      charge_id: string
      status: "succeeded" | "failed" | "pending"
      amount: integer
      currency: string
    Implementation:
      - Call Stripe API: POST /v1/charges with configured API key
      - Map Stripe response to output schema
      - Handle Stripe errors and map to structured error results

  payment.refund
    Description: Refund a previous charge
    Input:
      charge_id: string (required)
      amount: integer (optional) - Partial refund amount in cents. Omit for full refund.
    Output:
      refund_id: string
      status: "succeeded" | "failed" | "pending"
      amount: integer
    Implementation:
      - Call Stripe API: POST /v1/refunds
      - Map response to output schema
```

### 1.3 Registration

Custom tools are registered at startup. The implementation depends on the programming language, but conceptually:

```
runtime.register_tool(PaymentTool{
  stripe_api_key: config.get("payment.stripe_api_key"),
})
```

The tool's operations are then available to the agent alongside built-in tools.

### 1.4 Tool Configuration

Custom tools can have their own configuration section:

```yaml
# In config.yaml
tools:
  payment:
    provider: "stripe"
    api_key: ""               # env: AGENTIC_TOOLS_PAYMENT_API_KEY
    webhook_secret: ""
  
  storage:
    provider: "s3"
    bucket: "my-bucket"
    region: "us-east-1"
```

### 1.5 Tool Security

Custom tools must follow the same security principles as built-in tools:
- Validate all inputs against the schema before execution
- Never expose secrets (API keys) to the agent
- Return errors as structured results, not exceptions
- Respect timeout budgets
- Log operations for audit purposes

## 2. Custom Middleware

### 2.1 Request Middleware

Middleware runs before the agent is invoked. Use cases:
- Custom authentication schemes (SAML, OAuth2 flows)
- Tenant identification (multi-tenancy)
- Request enrichment (geo-IP lookup, device detection)
- Custom rate limiting logic

**Middleware interface:**
```
Middleware {
  name: string
  execute(request, context) -> (modified_context, error)
}
```

Middleware can:
- Add data to the request context (available to the agent)
- Reject the request (return error before agent invocation)
- Modify headers

Middleware cannot:
- Modify the request body (the agent sees the original)
- Interact with the agent directly

### 2.2 Response Middleware

Runs after the agent produces a response, before it's sent to the caller:
- Custom response headers
- Response transformation
- Additional logging
- Webhook triggers

### 2.3 Middleware Ordering

```
Request → Auth Middleware → Custom Middleware (ordered) → Router → Agent → Response Middleware → Client
```

## 3. Custom Spec Loaders

### 3.1 Default: Filesystem

By default, specs are loaded from the local `specs/` directory.

### 3.2 Alternative: Git Repository

Specs can be loaded from a git repository:
```yaml
specs:
  loader: "git"
  git:
    url: "https://github.com/org/my-specs.git"
    branch: "main"
    path: "specs/"
    poll_interval: 60s         # Check for updates every 60 seconds
    ssh_key_file: ""           # For private repos
```

### 3.3 Alternative: Object Storage

Specs can be loaded from S3/GCS/Azure Blob:
```yaml
specs:
  loader: "s3"
  s3:
    bucket: "my-specs-bucket"
    prefix: "production/specs/"
    region: "us-east-1"
```

### 3.4 Alternative: Database

Specs stored as rows in a database table:
```yaml
specs:
  loader: "database"
  database:
    table: "specifications"
    content_column: "content"
    path_column: "path"
```

This is useful for multi-tenant deployments where each tenant has their own spec set.

### 3.5 Custom Loader Interface

```
SpecLoader {
  load_all() -> map[string]string     // path → content
  load(path: string) -> string        // Load single spec
  watch(callback: function)           // Notify on changes
}
```

## 4. Multi-Tenancy

### 4.1 Single-Tenant (Default)

One Agentic Service instance, one set of specs, one database.

### 4.2 Multi-Tenant: Shared Runtime

One Agentic Service instance serves multiple tenants. Each tenant has:
- Their own spec set (loaded from different paths or database rows)
- Their own database (or schema within a shared database)
- Tenant identification via middleware (subdomain, header, or JWT claim)

Configuration:
```yaml
multi_tenancy:
  enabled: true
  identifier: "header"          # "header", "subdomain", "jwt_claim"
  header_name: "X-Tenant-Id"    # If identifier = header
  jwt_claim: "tenant_id"        # If identifier = jwt_claim
  
  # Per-tenant database
  tenant_databases:
    tenant_a: "postgres://..."
    tenant_b: "postgres://..."
  
  # Per-tenant specs
  tenant_specs:
    tenant_a: "./specs/tenant_a/"
    tenant_b: "./specs/tenant_b/"
```

### 4.3 Multi-Tenant: Separate Instances

The simpler approach: deploy a separate Agentic Service instance per tenant. Use container orchestration (Kubernetes) to manage instances. Each instance has its own config, specs, and database.

## 5. Database Migrations

### 5.1 Migration Files

SQL migration files in the `migrations/` directory:

```
migrations/
├── 001_create_users.sql
├── 002_create_projects.sql
├── 003_create_tasks.sql
└── 004_add_task_priority.sql
```

Each file contains SQL statements to apply:
```sql
-- 001_create_users.sql
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  password_hash varchar(255) NOT NULL,
  role varchar(20) NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
```

### 5.2 Migration Execution

Migrations are run via the CLI:
```bash
agentic-service migrate up          # Apply pending migrations
agentic-service migrate down        # Rollback last migration
agentic-service migrate status      # Show migration status
```

Or automatically on startup:
```yaml
database:
  migrations:
    auto_migrate: true
```

### 5.3 Migration Tracking

Applied migrations are tracked in a `_migrations` table:
```sql
CREATE TABLE _migrations (
  version integer PRIMARY KEY,
  name varchar(255) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
```

## 6. CLI Reference

The Agentic Service binary provides these commands:

```
agentic-service                     # Start the service (default)
agentic-service serve               # Start the service (explicit)
agentic-service validate            # Validate spec files without starting
agentic-service migrate up|down|status  # Database migrations
agentic-service routes              # Print the route table
agentic-service tools               # Print available tools
agentic-service openapi             # Generate OpenAPI spec to stdout
agentic-service test <spec-file>    # Run behavioral test against a spec
agentic-service version             # Print version
```

### Flags

```
--config <path>                    # Config file path (default: ./config.yaml)
--specs <path>                     # Specs directory (overrides config)
--port <port>                      # Server port (overrides config)
--log-level <level>                # Log level (overrides config)
--mcp-stdio                        # Run as MCP server on stdio (no HTTP)
```

## 7. Testing

### 7.1 Spec Testing

Behavioral tests validate that the agent + spec combination produces correct results. Tests are defined in markdown alongside specs:

```
specs/
├── orders/
│   ├── create-order.md
│   └── create-order.test.md      # Tests for create-order
```

Test file format:
```markdown
# Tests: Create Order

## Test: successful order creation
Request:
  method: POST
  path: /api/orders
  auth: { user_id: "user-1", role: "member" }
  body:
    customer_id: 42
    items:
      - product_id: 1
        quantity: 2

Setup:
  database:
    - INSERT INTO products (id, name, price, stock) VALUES (1, 'Widget', 9.99, 50)

Expect:
  status: 201
  body:
    data:
      customer_id: 42
      status: "pending"
      total_price: 19.98

## Test: invalid input - missing items
Request:
  method: POST
  path: /api/orders
  auth: { user_id: "user-1", role: "member" }
  body:
    customer_id: 42

Expect:
  status: 400
  body:
    error:
      code: "validation_error"
```

### 7.2 Running Tests

```bash
agentic-service test specs/orders/create-order.test.md
agentic-service test specs/    # Run all test files
```

The test runner:
1. Sets up a test database (or uses transactions that are rolled back)
2. Runs setup fixtures
3. Sends the request through the full pipeline
4. Compares the response against expectations
5. Reports pass/fail

### 7.3 Test Determinism

Because the agent is probabilistic, tests may occasionally fail due to non-determinism. Mitigations:
- Use `temperature: 0.0` for tests
- Allow fuzzy matching on response body (e.g., check key presence rather than exact values)
- Run each test multiple times and require a success rate (e.g., 9/10 passes)

## 8. Deployment Patterns

### 8.1 Docker

```dockerfile
FROM agentic-service:latest

COPY specs/ /app/specs/
COPY config.yaml /app/config.yaml
COPY migrations/ /app/migrations/

CMD ["agentic-service", "serve"]
```

### 8.2 Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: agentic-service
          image: agentic-service:latest
          ports:
            - containerPort: 8080
          env:
            - name: AGENTIC_LLM_API_KEY
              valueFrom:
                secretKeyRef:
                  name: my-service-secrets
                  key: llm-api-key
            - name: AGENTIC_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: my-service-secrets
                  key: database-url
          volumeMounts:
            - name: specs
              mountPath: /app/specs
      volumes:
        - name: specs
          configMap:
            name: my-service-specs
```

### 8.3 Specs via Git Sync

Use a sidecar to sync specs from a git repository:

```yaml
containers:
  - name: agentic-service
    # ...
    volumeMounts:
      - name: specs
        mountPath: /app/specs
  - name: git-sync
    image: registry.k8s.io/git-sync/git-sync:v4
    args:
      - "--repo=https://github.com/org/my-specs"
      - "--root=/specs"
      - "--period=60s"
    volumeMounts:
      - name: specs
        mountPath: /specs
volumes:
  - name: specs
    emptyDir: {}
```

Combined with `specs.watch: true`, this gives you a GitOps workflow: push spec changes to git, they auto-deploy to the running service.
