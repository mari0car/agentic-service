# Tool Specification

This document defines every built-in tool available to the agent. Each tool is a set of operations with typed inputs and outputs. The agent calls these tools during request handling to interact with external systems.

## Design Principles

1. **Minimal surface area**: each tool does one thing well
2. **Explicit over implicit**: no hidden side effects, no magic
3. **Safe by default**: read operations are unrestricted; write operations require explicit enablement
4. **Schema-driven**: every operation has a JSON Schema for inputs and outputs
5. **Error as data**: tool errors are returned as structured results, not exceptions

---

## 1. database

Interact with the service's relational database (PostgreSQL, SQLite, or MySQL depending on configuration).

### 1.1 database.query

Execute a read-only SQL query and return results.

**Input:**
```json
{
  "sql": "string (required) - SQL SELECT statement",
  "params": "array (optional) - Parameterized query values, positional ($1, $2, ...)"
}
```

**Output:**
```json
{
  "rows": "array of objects - Each object is a row with column names as keys",
  "row_count": "integer - Number of rows returned"
}
```

**Example:**
```json
// Input
{ "sql": "SELECT id, name, price FROM products WHERE category = $1 AND price < $2", "params": ["electronics", 100] }

// Output
{ "rows": [{ "id": 1, "name": "USB Cable", "price": 9.99 }, { "id": 5, "name": "Mouse", "price": 24.99 }], "row_count": 2 }
```

**Constraints:**
- Only SELECT statements allowed (enforced by parser)
- Query timeout: 5 seconds (configurable)
- Max rows returned: 1000 (configurable)

### 1.2 database.execute

Execute a write SQL statement (INSERT, UPDATE, DELETE) and return affected rows.

**Input:**
```json
{
  "sql": "string (required) - SQL INSERT/UPDATE/DELETE statement",
  "params": "array (optional) - Parameterized query values"
}
```

**Output:**
```json
{
  "affected_rows": "integer - Number of rows affected",
  "returning": "array of objects (optional) - Rows returned by RETURNING clause"
}
```

**Example:**
```json
// Input
{ "sql": "INSERT INTO orders (customer_id, total, status) VALUES ($1, $2, $3) RETURNING id, created_at", "params": [42, 29.97, "pending"] }

// Output
{ "affected_rows": 1, "returning": [{ "id": 7, "created_at": "2025-03-02T10:30:00Z" }] }
```

**Constraints:**
- DDL statements (CREATE, ALTER, DROP) are disallowed unless explicitly enabled
- Statement timeout: 10 seconds (configurable)
- Must use parameterized queries (no string interpolation in SQL)

### 1.3 database.transaction

Execute multiple statements within a database transaction.

**Input:**
```json
{
  "statements": "array (required) - Array of { sql, params } objects to execute in order"
}
```

**Output:**
```json
{
  "results": "array - Array of results for each statement (same format as query/execute)",
  "committed": "boolean - Whether the transaction was committed (true) or rolled back (false)"
}
```

If any statement fails, the entire transaction is rolled back and `committed` is `false`. The error details are included in the corresponding result entry.

---

## 2. filesystem

Read and write files within a sandboxed directory.

### 2.1 filesystem.read

Read the contents of a file.

**Input:**
```json
{
  "path": "string (required) - Relative path within the sandbox directory",
  "encoding": "string (optional) - 'utf-8' (default) or 'base64'"
}
```

**Output:**
```json
{
  "content": "string - File contents in the specified encoding",
  "size_bytes": "integer - File size",
  "modified_at": "string - ISO 8601 timestamp of last modification"
}
```

**Constraints:**
- Path must be within the configured sandbox directory
- Path traversal (`../`) is rejected
- Max file size for read: 10 MB (configurable)

### 2.2 filesystem.write

Write content to a file (creates or overwrites).

**Input:**
```json
{
  "path": "string (required) - Relative path within the sandbox directory",
  "content": "string (required) - File contents",
  "encoding": "string (optional) - 'utf-8' (default) or 'base64'",
  "create_dirs": "boolean (optional) - Create parent directories if they don't exist (default: false)"
}
```

**Output:**
```json
{
  "path": "string - The path written to",
  "size_bytes": "integer - Bytes written"
}
```

### 2.3 filesystem.list

List files and directories.

**Input:**
```json
{
  "path": "string (optional) - Relative directory path (default: root of sandbox)",
  "pattern": "string (optional) - Glob pattern to filter (e.g., '*.json')",
  "recursive": "boolean (optional) - Recurse into subdirectories (default: false)"
}
```

**Output:**
```json
{
  "entries": [
    {
      "name": "string",
      "path": "string",
      "type": "file | directory",
      "size_bytes": "integer",
      "modified_at": "string"
    }
  ]
}
```

### 2.4 filesystem.delete

Delete a file.

**Input:**
```json
{
  "path": "string (required) - Relative path within the sandbox directory"
}
```

**Output:**
```json
{
  "deleted": "boolean"
}
```

---

## 3. http_client

Make outbound HTTP requests to external services.

### 3.1 http_client.request

Send an HTTP request to an external URL.

**Input:**
```json
{
  "method": "string (required) - GET, POST, PUT, PATCH, DELETE, HEAD",
  "url": "string (required) - Full URL",
  "headers": "object (optional) - Key-value pairs for request headers",
  "body": "string | object (optional) - Request body (object is JSON-serialized)",
  "timeout_ms": "integer (optional) - Request timeout in milliseconds (default: 10000)"
}
```

**Output:**
```json
{
  "status": "integer - HTTP status code",
  "headers": "object - Response headers",
  "body": "string | object - Response body (parsed as JSON if content-type is application/json)"
}
```

**Constraints:**
- URL must match the configured allowlist (no arbitrary external calls by default)
- Max response body size: 5 MB
- Timeout: configurable per request, max 30 seconds
- No redirect following by default (configurable)

---

## 4. cache

Interact with an in-memory or external cache (Redis-compatible).

### 4.1 cache.get

Retrieve a cached value.

**Input:**
```json
{
  "key": "string (required)"
}
```

**Output:**
```json
{
  "value": "string | object | null - The cached value, or null if not found",
  "found": "boolean"
}
```

### 4.2 cache.set

Store a value in the cache.

**Input:**
```json
{
  "key": "string (required)",
  "value": "string | object (required)",
  "ttl_seconds": "integer (optional) - Time to live in seconds (default: no expiry)"
}
```

**Output:**
```json
{
  "stored": "boolean"
}
```

### 4.3 cache.delete

Remove a cached value.

**Input:**
```json
{
  "key": "string (required)"
}
```

**Output:**
```json
{
  "deleted": "boolean"
}
```

---

## 5. messaging

Publish and consume messages from a message broker (e.g., NATS, RabbitMQ, Kafka).

### 5.1 messaging.publish

Publish a message to a topic/queue.

**Input:**
```json
{
  "topic": "string (required) - Topic or queue name",
  "payload": "string | object (required) - Message payload",
  "headers": "object (optional) - Message headers/metadata"
}
```

**Output:**
```json
{
  "published": "boolean",
  "message_id": "string (optional) - Broker-assigned message ID"
}
```

### 5.2 messaging.request

Send a request message and wait for a reply (request-reply pattern).

**Input:**
```json
{
  "topic": "string (required)",
  "payload": "string | object (required)",
  "timeout_ms": "integer (optional) - Default: 5000"
}
```

**Output:**
```json
{
  "reply": "string | object - The reply payload",
  "headers": "object (optional)"
}
```

---

## 6. crypto

Cryptographic operations for hashing, token generation, and password handling.

### 6.1 crypto.hash

Generate a hash of input data.

**Input:**
```json
{
  "algorithm": "string (required) - 'sha256', 'sha512', 'md5'",
  "data": "string (required)"
}
```

**Output:**
```json
{
  "hash": "string - Hex-encoded hash"
}
```

### 6.2 crypto.hash_password

Hash a password using bcrypt (or argon2).

**Input:**
```json
{
  "password": "string (required)",
  "algorithm": "string (optional) - 'bcrypt' (default) or 'argon2'"
}
```

**Output:**
```json
{
  "hash": "string - The password hash"
}
```

### 6.3 crypto.verify_password

Verify a password against a hash.

**Input:**
```json
{
  "password": "string (required)",
  "hash": "string (required)"
}
```

**Output:**
```json
{
  "valid": "boolean"
}
```

### 6.4 crypto.generate_token

Generate a random token or UUID.

**Input:**
```json
{
  "type": "string (required) - 'uuid', 'hex', 'base64'",
  "length": "integer (optional) - Byte length for hex/base64 (default: 32)"
}
```

**Output:**
```json
{
  "token": "string"
}
```

### 6.5 crypto.jwt_sign

Create a signed JWT.

**Input:**
```json
{
  "payload": "object (required) - JWT claims",
  "expires_in_seconds": "integer (optional) - Token lifetime"
}
```

**Output:**
```json
{
  "token": "string - The signed JWT"
}
```

Note: The signing key is configured at the runtime level, not passed by the agent.

### 6.6 crypto.jwt_verify

Verify and decode a JWT.

**Input:**
```json
{
  "token": "string (required)"
}
```

**Output:**
```json
{
  "valid": "boolean",
  "payload": "object | null - Decoded claims if valid",
  "error": "string | null - Error reason if invalid"
}
```

---

## 7. email

Send emails via a configured SMTP provider or email API.

### 7.1 email.send

Send an email.

**Input:**
```json
{
  "to": "string | array (required) - Recipient(s)",
  "subject": "string (required)",
  "body": "string (required) - Email body (plain text or HTML)",
  "content_type": "string (optional) - 'text/plain' (default) or 'text/html'",
  "cc": "string | array (optional)",
  "bcc": "string | array (optional)",
  "reply_to": "string (optional)"
}
```

**Output:**
```json
{
  "sent": "boolean",
  "message_id": "string (optional)"
}
```

**Constraints:**
- From address is configured at the runtime level
- Rate limiting is enforced (configurable, default: 10/minute)
- Recipient domains can be restricted via allowlist

---

## 8. time

Time and scheduling utilities.

### 8.1 time.now

Get the current timestamp.

**Input:**
```json
{
  "timezone": "string (optional) - IANA timezone (default: UTC)"
}
```

**Output:**
```json
{
  "iso": "string - ISO 8601 timestamp",
  "unix": "integer - Unix timestamp in seconds",
  "unix_ms": "integer - Unix timestamp in milliseconds"
}
```

### 8.2 time.parse

Parse a date/time string.

**Input:**
```json
{
  "input": "string (required) - Date/time string to parse",
  "format": "string (optional) - Expected format (default: auto-detect)"
}
```

**Output:**
```json
{
  "iso": "string",
  "unix": "integer",
  "valid": "boolean"
}
```

### 8.3 time.format

Format a timestamp into a string.

**Input:**
```json
{
  "unix": "integer (required) - Unix timestamp",
  "format": "string (required) - Output format (e.g., 'YYYY-MM-DD', 'RFC3339')",
  "timezone": "string (optional) - IANA timezone (default: UTC)"
}
```

**Output:**
```json
{
  "formatted": "string"
}
```

---

## 9. log

Write structured log entries (visible in service logs, not returned to caller).

### 9.1 log.write

Write a log entry.

**Input:**
```json
{
  "level": "string (required) - 'debug', 'info', 'warn', 'error'",
  "message": "string (required)",
  "data": "object (optional) - Additional structured data"
}
```

**Output:**
```json
{
  "logged": "boolean"
}
```

This allows the agent to emit business-level log entries that appear in the service's structured logs, tagged with the request ID.

---

## 10. response

Helper tool for constructing the HTTP response. While the agent can produce a response as its final message, this tool allows explicit response construction during the tool-call loop.

### 10.1 response.set_header

Set a response header.

**Input:**
```json
{
  "name": "string (required)",
  "value": "string (required)"
}
```

### 10.2 response.set_cookie

Set a response cookie.

**Input:**
```json
{
  "name": "string (required)",
  "value": "string (required)",
  "max_age": "integer (optional) - Seconds",
  "path": "string (optional)",
  "domain": "string (optional)",
  "secure": "boolean (optional)",
  "http_only": "boolean (optional)",
  "same_site": "string (optional) - 'strict', 'lax', 'none'"
}
```

---

## 11. validate

Input validation utilities to assist the agent with common validation patterns.

### 11.1 validate.json_schema

Validate a JSON object against a JSON Schema.

**Input:**
```json
{
  "data": "object (required) - The data to validate",
  "schema": "object (required) - JSON Schema"
}
```

**Output:**
```json
{
  "valid": "boolean",
  "errors": "array of { path: string, message: string } - Validation errors"
}
```

### 11.2 validate.email

Check if a string is a valid email address.

**Input:**
```json
{
  "email": "string (required)"
}
```

**Output:**
```json
{
  "valid": "boolean"
}
```

### 11.3 validate.uuid

Check if a string is a valid UUID.

**Input:**
```json
{
  "value": "string (required)"
}
```

**Output:**
```json
{
  "valid": "boolean",
  "version": "integer | null"
}
```

---

## Tool Summary

| Tool | Operations | Category |
|------|-----------|----------|
| `database` | query, execute, transaction | Data |
| `filesystem` | read, write, list, delete | Data |
| `http_client` | request | Integration |
| `messaging` | publish, request | Integration |
| `cache` | get, set, delete | Data |
| `crypto` | hash, hash_password, verify_password, generate_token, jwt_sign, jwt_verify | Security |
| `email` | send | Integration |
| `time` | now, parse, format | Utility |
| `log` | write | Observability |
| `response` | set_header, set_cookie | Response |
| `validate` | json_schema, email, uuid | Utility |

## Extending with Custom Tools

See [08-developer-guide.md](08-developer-guide.md) for instructions on adding custom tools to the runtime.
