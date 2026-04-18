---
route: POST /api/projects
auth: required
tool_handler: projects/create
---

# Create Project

## Endpoint
POST /api/projects

## Authentication
Required. Any authenticated user can create a project.

## Input
Request body (JSON):
- `name` (string, required): 1-100 characters
- `description` (string, optional): max 2000 characters

## Logic

1. Validate input:
   - `name` must be present, trimmed, 1-100 characters
   - `description` if present, max 2000 characters
   - Return 400 with field errors if invalid

2. Check for duplicate project name for this user:
   - `SELECT id FROM projects WHERE owner_id = $1 AND name = $2 AND deleted_at IS NULL`
   - If exists, return 409 with code "conflict" and message "You already have a project with this name"

3. Generate a new UUID for the project using crypto_generate_token (type: "uuid").
   Get the current ISO timestamp using time_now.

4. Insert the project with the generated id and timestamps:
   ```sql
   INSERT INTO projects (id, name, description, owner_id, created_at, updated_at)
   VALUES ($1, $2, $3, $4, $5, $5)
   ```
   Parameters: id, name, description, owner_id, current_timestamp

5. Query the inserted project back to get the full record:
   ```sql
   SELECT id, name, description, owner_id, status, created_at, updated_at FROM projects WHERE id = $1
   ```

6. Return 201 with the created project

## Response (201)
```json
{
  "data": {
    "id": "uuid",
    "name": "string",
    "description": "string or null",
    "owner_id": "uuid",
    "status": "active",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```
