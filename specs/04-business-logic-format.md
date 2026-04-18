# Business Logic Specification Format

This document defines how to write the markdown files that constitute the business logic of an Agentic Service.

## 1. Overview

Business logic specifications are markdown files stored in the `specs/` directory. The agent reads these files at request time and uses them to determine what tool calls to make and what response to produce.

These files are not parsed programmatically (except for routing metadata). They are interpreted by the LLM agent. This means you write for an intelligent reader, not a compiler. Clarity, precision, and structure matter - but rigid syntax does not.

## 2. Directory Structure

```
specs/
├── service.md              # Service-level metadata and global behavior
├── domain.md               # Entity definitions, relationships, constraints
├── data-model.md           # Database schema documentation
├── error-handling.md       # Global error response format and policies
├── auth-policies.md        # Authentication and authorization rules
├── api-routes.md           # Route table mapping URLs to spec files
│
├── orders/                 # Domain-specific logic files
│   ├── create-order.md
│   ├── list-orders.md
│   ├── get-order.md
│   └── update-order-status.md
│
├── products/
│   ├── list-products.md
│   └── get-product.md
│
├── users/
│   ├── register.md
│   ├── login.md
│   └── get-profile.md
│
└── workflows/              # Multi-step business processes
    ├── checkout.md
    └── order-fulfillment.md
```

## 3. File Types

### 3.1 Service Metadata (`service.md`)

Defines global service behavior. Loaded for every request.

```markdown
# Task Manager Service

## Description
A task management API for teams. Users can create projects, add tasks,
assign them to team members, and track progress.

## Global Rules
- All timestamps are in UTC, formatted as ISO 8601
- All IDs are UUIDs
- Pagination defaults: page=1, per_page=20, max per_page=100
- All list endpoints support `?sort_by=<field>&order=asc|desc`
- Deleted records are soft-deleted (set `deleted_at` timestamp, exclude from queries by default)

## Response Format
All responses use this envelope:
- Success: `{ "data": <result>, "meta": { ... } }`
- Error: `{ "error": { "code": "<error_code>", "message": "<human-readable>" } }`
- List: `{ "data": [<items>], "meta": { "page": 1, "per_page": 20, "total": 150 } }`
```

### 3.2 Domain Model (`domain.md`)

Defines entities, their attributes, relationships, and business constraints. This is the core reference document that other specs refer to.

```markdown
# Domain Model

## User
- `id`: UUID, primary key
- `email`: string, unique, required, valid email format
- `name`: string, required, 1-200 characters
- `password_hash`: string (never exposed in API responses)
- `role`: enum [admin, member, viewer], default: member
- `created_at`: timestamp
- `updated_at`: timestamp

## Project
- `id`: UUID, primary key
- `name`: string, required, 1-100 characters
- `description`: string, optional, max 2000 characters
- `owner_id`: UUID, references User.id
- `status`: enum [active, archived], default: active
- `created_at`: timestamp
- `updated_at`: timestamp

### Relationships
- A Project belongs to a User (owner)
- A Project has many Tasks
- A User can own many Projects

### Constraints
- Project names must be unique within the same owner
- Only the owner or an admin can archive a project
- Archived projects cannot have new tasks added

## Task
- `id`: UUID, primary key
- `project_id`: UUID, references Project.id, required
- `title`: string, required, 1-200 characters
- `description`: string, optional
- `status`: enum [todo, in_progress, done], default: todo
- `priority`: enum [low, medium, high], default: medium
- `assignee_id`: UUID, references User.id, optional
- `due_date`: date, optional
- `created_at`: timestamp
- `updated_at`: timestamp

### Constraints
- Status transitions: todo → in_progress → done (no skipping, no backward)
- Only project members can be assigned to tasks
- Due date must be in the future when set
```

### 3.3 Data Model (`data-model.md`)

Documents the actual database schema. Helps the agent write correct SQL.

```markdown
# Data Model

## Tables

### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() |
| email | varchar(255) | NOT NULL, UNIQUE |
| name | varchar(200) | NOT NULL |
| password_hash | varchar(255) | NOT NULL |
| role | varchar(20) | NOT NULL, DEFAULT 'member' |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| deleted_at | timestamptz | NULL |

### projects
| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT gen_random_uuid() |
| name | varchar(100) | NOT NULL |
| description | text | NULL |
| owner_id | uuid | NOT NULL, REFERENCES users(id) |
| status | varchar(20) | NOT NULL, DEFAULT 'active' |
| created_at | timestamptz | NOT NULL, DEFAULT now() |
| updated_at | timestamptz | NOT NULL, DEFAULT now() |
| deleted_at | timestamptz | NULL |

### Indexes
- `idx_users_email` on users(email)
- `idx_projects_owner_id` on projects(owner_id)
- `idx_tasks_project_id` on tasks(project_id)
- `idx_tasks_assignee_id` on tasks(assignee_id)

### Unique Constraints
- `uq_projects_owner_name` on projects(owner_id, name) WHERE deleted_at IS NULL
```

### 3.4 API Route Spec (individual endpoint)

This is where the actual business logic lives. Each file describes the behavior for one API endpoint (or a small group of related endpoints).

```markdown
# Create Task

## Endpoint
POST /api/projects/:project_id/tasks

## Authentication
Required. User must be authenticated.

## Authorization
User must be a member of the project (owner, or assigned to at least one task in the project)
OR user must have role=admin.

## Input
Request body (JSON):
- `title` (string, required): 1-200 characters
- `description` (string, optional): max 5000 characters
- `priority` (string, optional): one of "low", "medium", "high". Default: "medium"
- `assignee_id` (UUID, optional): must be a valid user who is a project member
- `due_date` (string, optional): ISO 8601 date, must be today or in the future

## Logic

1. Validate the request body against the input schema above
2. If validation fails, return 400 with details of what's wrong
3. Query the `projects` table to verify `project_id` exists and is not archived and not soft-deleted
4. If project not found or archived, return 404
5. Check authorization: query whether the requesting user is the project owner or has admin role
   or is assigned to any task in this project
6. If not authorized, return 403
7. If `assignee_id` is provided, verify the user exists and is a project member (same check as step 5 but for the assignee)
8. If assignee is not a valid project member, return 400 with error "assignee is not a project member"
9. If `due_date` is provided, verify it's not in the past
10. Generate a new UUID for the task
11. Insert the task into the `tasks` table with all fields
12. Return 201 with the created task object

## Response (201)
```json
{
  "data": {
    "id": "uuid",
    "project_id": "uuid",
    "title": "string",
    "description": "string or null",
    "status": "todo",
    "priority": "medium",
    "assignee_id": "uuid or null",
    "due_date": "date or null",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```

## Error Responses
- 400: Invalid input (validation errors in body)
- 401: Not authenticated
- 403: Not a project member
- 404: Project not found or archived
```

### 3.5 Workflow Spec

Describes multi-step business processes that may span multiple tool calls and have complex branching logic.

```markdown
# Order Checkout Workflow

## Trigger
POST /api/checkout

## Input
- `cart_id` (UUID, required)
- `payment_method_id` (UUID, required)
- `shipping_address_id` (UUID, required)

## Steps

### Step 1: Load Cart
Query the `carts` table for the given `cart_id` where `user_id` matches the authenticated user.
If not found, return 404.
If cart is empty (no items), return 400 "cart is empty".

### Step 2: Validate Stock
For each item in the cart, query `products` to check current stock.
If any product has insufficient stock:
- Return 409 with a list of products that are out of stock
- Include current available quantity for each

### Step 3: Calculate Totals
- Subtotal: sum of (product.price * cart_item.quantity) for all items
- Tax: subtotal * 0.08 (8% tax rate)
- Shipping: if subtotal > 50, shipping is free. Otherwise, $5.99
- Total: subtotal + tax + shipping

### Step 4: Process Payment
Use http_client to call the payment service:
- POST https://payments.internal/api/charge
- Body: { amount: total, currency: "USD", payment_method_id: <id> }
- If payment fails (non-2xx response), return 402 "payment failed"

### Step 5: Create Order
Within a database transaction:
1. Insert into `orders` table with calculated totals and status='confirmed'
2. Insert into `order_items` for each cart item
3. Decrement stock for each product
4. Delete the cart items
5. Update cart status to 'checked_out'

If the transaction fails, attempt to refund the payment:
- POST https://payments.internal/api/refund
- Body: { charge_id: <id from step 4> }
- Return 500 "order creation failed, payment refunded"

### Step 6: Send Confirmation
Use email.send to send an order confirmation to the user's email.
Subject: "Order #<order_id> confirmed"
Include: order summary, items, total, estimated delivery

### Step 7: Return Response
Return 201 with the full order object including items and totals.
```

### 3.6 Error Handling Spec (`error-handling.md`)

Global policies for error responses.

```markdown
# Error Handling

## Error Response Format
All errors must use this format:
```json
{
  "error": {
    "code": "string - machine-readable error code (snake_case)",
    "message": "string - human-readable description",
    "details": "object (optional) - additional context"
  }
}
```

## Standard Error Codes

| HTTP Status | Error Code | When to Use |
|-------------|-----------|-------------|
| 400 | validation_error | Request body fails validation. Include field-level errors in `details` |
| 401 | unauthorized | No auth token, or token is invalid/expired |
| 403 | forbidden | Authenticated but not authorized for this action |
| 404 | not_found | Resource does not exist (or is soft-deleted) |
| 409 | conflict | Business rule conflict (e.g., duplicate, insufficient stock) |
| 422 | unprocessable | Request is valid JSON but semantically wrong |
| 429 | rate_limited | Too many requests |
| 500 | internal_error | Unexpected error |

## Validation Error Details
For 400 validation errors, include per-field errors:
```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": {
      "fields": [
        { "field": "email", "message": "must be a valid email address" },
        { "field": "name", "message": "is required" }
      ]
    }
  }
}
```

## General Rules
- Never expose internal details (SQL errors, stack traces) in error responses
- Log internal errors with full detail for debugging
- When a referenced resource is not found, always return 404 (never reveal existence to unauthorized users)
- Rate limit errors should include a `Retry-After` header
```

### 3.7 Auth Policies (`auth-policies.md`)

```markdown
# Authentication and Authorization Policies

## Authentication
All endpoints except those marked "public" require a valid JWT in the `Authorization` header:
```
Authorization: Bearer <jwt_token>
```

The JWT contains:
- `sub`: user ID (UUID)
- `role`: user role (admin, member, viewer)
- `exp`: expiration timestamp

To validate: use crypto.jwt_verify on the token. If invalid, return 401.
Extract `sub` as the authenticated user ID and `role` for authorization checks.

## Public Endpoints
- POST /api/auth/register
- POST /api/auth/login
- GET /api/health

## Role-Based Access

| Action | viewer | member | admin |
|--------|--------|--------|-------|
| List projects | own only | own only | all |
| Create project | no | yes | yes |
| Update project | no | owner only | yes |
| Delete project | no | owner only | yes |
| List tasks | project member | project member | all |
| Create task | no | project member | yes |
| Update task | no | project member | yes |
| Delete task | no | project owner | yes |
| Manage users | no | no | yes |

## Ownership Rules
- "project member" = user is the project owner OR is assigned to any task in the project
- "owner only" = user is the project owner
- Admin overrides all ownership checks
```

## 4. Writing Guidelines

### 4.1 Be Explicit About Ordering

The agent executes steps in the order you specify. If ordering matters, use numbered lists:

**Good:**
```markdown
1. Validate the input
2. Check authorization
3. Query the database
4. Return the result
```

**Ambiguous:**
```markdown
- Validate the input
- Check authorization
- Query the database
- Return the result
```

### 4.2 Be Precise About Data

Specify exact column names, table names, and field names. The agent uses these to construct SQL queries and JSON responses.

**Good:**
```markdown
Query the `tasks` table where `project_id` equals the URL parameter
and `deleted_at IS NULL`, ordered by `created_at DESC`.
```

**Bad:**
```markdown
Get the tasks for this project.
```

### 4.3 Specify Error Cases Explicitly

Don't assume the agent will handle errors "correctly" without guidance. State every expected error case and the response.

**Good:**
```markdown
3. Query the `projects` table for the given `project_id` where `deleted_at IS NULL`
4. If no row is returned, return 404 with error code "not_found" and message "Project not found"
```

**Bad:**
```markdown
3. Look up the project (handle not found case)
```

### 4.4 Reference the Domain Model

Don't repeat entity definitions in every endpoint spec. Reference the shared domain model:

```markdown
## Input
See the Task entity in domain.md for field definitions.
Additional validation: `due_date` must be in the future.
```

### 4.5 Use Conditional Logic Clearly

```markdown
If the user's role is "admin":
  - Skip the ownership check
  - Allow access to all projects

If the user's role is "member":
  - Only allow access to projects they own or are a member of
  - Query `project_members` table to check membership

If the user's role is "viewer":
  - Only allow read access to projects they are explicitly added to
```

### 4.6 Specify SQL Patterns When Helpful

For complex queries, provide the SQL pattern. The agent will adapt it with correct parameter binding:

```markdown
To get all tasks for a project with optional filtering and pagination:

```sql
SELECT t.*, u.name as assignee_name
FROM tasks t
LEFT JOIN users u ON t.assignee_id = u.id
WHERE t.project_id = $1
  AND t.deleted_at IS NULL
  AND ($2::varchar IS NULL OR t.status = $2)
  AND ($3::varchar IS NULL OR t.priority = $3)
ORDER BY t.created_at DESC
LIMIT $4 OFFSET $5
```

Parameters: project_id, status (optional), priority (optional), per_page, offset
```

### 4.7 Document Side Effects

If an action triggers side effects (sending email, publishing a message, updating related records), document them explicitly:

```markdown
## Side Effects
After successfully creating the order:
1. Publish a message to topic "orders.created" with the order ID and customer ID
2. Send an email confirmation to the customer
3. Decrement stock for each ordered product
```

## 5. Spec File Metadata (Optional Frontmatter)

Spec files can optionally include YAML frontmatter for metadata used by the router and spec store:

```markdown
---
route: POST /api/tasks
auth: required
tags: [tasks, write]
depends_on: [domain.md, error-handling.md, auth-policies.md]
---

# Create Task
...
```

**Supported frontmatter fields:**

| Field | Type | Description |
|-------|------|-------------|
| `route` | string | HTTP method and path (alternative to api-routes.md) |
| `auth` | string | `required`, `optional`, or `none` |
| `tags` | array | Tags for grouping and filtering |
| `depends_on` | array | Other spec files that should be included in context |
| `max_tokens` | integer | Override token budget for this endpoint |
| `max_tool_calls` | integer | Override tool call limit for this endpoint |
| `cache_ttl` | integer | Cache the response for this many seconds |

## 6. Spec Validation

The runtime performs basic structural validation at startup:

- All files referenced in `api-routes.md` must exist
- Frontmatter (if present) must be valid YAML
- No duplicate routes (same method + path)
- Referenced `depends_on` files must exist
- Warning if a spec file is not referenced by any route

This is structural validation only. Behavioral correctness (does the spec make sense?) is not checked automatically - that's a human review concern.
