---
route: PUT /api/projects/:id
auth: required
---

# Update Project

## Endpoint
PUT /api/projects/:id

## Authentication
Required. Must be the project owner or admin.

## Input
Request body (JSON) - all fields optional:
- `name` (string): 1-100 characters
- `description` (string): max 2000 characters, or null to clear
- `status` (string): "active" or "archived"

At least one field must be provided.

## Logic

1. Validate that at least one field is provided. If body is empty or has no recognized fields, return 400.

2. Validate provided fields:
   - `name` if present: trimmed, 1-100 characters
   - `description` if present: max 2000 characters (or null)
   - `status` if present: must be "active" or "archived"
   - Return 400 with field errors if invalid

3. Query the existing project:
   ```sql
   SELECT id, name, description, owner_id, status FROM projects WHERE id = $1 AND deleted_at IS NULL
   ```

4. If not found, return 404

5. Authorization: user must be owner or admin. Otherwise return 403.

6. If `name` is being changed, check for duplicates:
   ```sql
   SELECT id FROM projects WHERE owner_id = $1 AND name = $2 AND id != $3 AND deleted_at IS NULL
   ```
   If duplicate, return 409 with "You already have a project with this name"

7. Build and execute the UPDATE:
   - Only update fields that were provided in the request
   - Always set `updated_at = now()`
   ```sql
   UPDATE projects SET name = $1, description = $2, status = $3, updated_at = now()
   WHERE id = $4
   RETURNING id, name, description, owner_id, status, created_at, updated_at
   ```

8. Return 200 with the updated project

## Response (200)
```json
{
  "data": {
    "id": "uuid",
    "name": "string",
    "description": "string or null",
    "owner_id": "uuid",
    "status": "string",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```
