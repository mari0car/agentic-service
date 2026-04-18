---
route: GET /api/projects
auth: required
tool_handler: projects/list
---

# List Projects

## Endpoint
GET /api/projects

## Authentication
Required.

## Query Parameters
- `page` (integer, optional): page number, default 1
- `per_page` (integer, optional): items per page, default 20, max 100
- `status` (string, optional): filter by "active" or "archived"

## Logic

1. Parse pagination parameters:
   - `page` defaults to 1, must be >= 1
   - `per_page` defaults to 20, must be between 1 and 100

2. Calculate offset: `(page - 1) * per_page`

3. Build and execute the query based on the user's role:

   If role is "admin": return all projects
   ```sql
   SELECT id, name, description, owner_id, status, created_at, updated_at
   FROM projects
   WHERE deleted_at IS NULL
     AND ($1::varchar IS NULL OR status = $1)
   ORDER BY created_at DESC
   LIMIT $2 OFFSET $3
   ```

   If role is "member": return only projects the user owns
   ```sql
   SELECT id, name, description, owner_id, status, created_at, updated_at
   FROM projects
   WHERE owner_id = $1
     AND deleted_at IS NULL
     AND ($2::varchar IS NULL OR status = $2)
   ORDER BY created_at DESC
   LIMIT $3 OFFSET $4
   ```

4. Get the total count (same WHERE clause without LIMIT/OFFSET):
   ```sql
   SELECT COUNT(*) as total FROM projects WHERE ...
   ```

5. Return 200 with the list and pagination metadata

## Response (200)
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "string",
      "description": "string or null",
      "owner_id": "uuid",
      "status": "active",
      "created_at": "timestamp",
      "updated_at": "timestamp"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 42
  }
}
```
