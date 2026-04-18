---
route: GET /api/projects/:id
auth: required
---

# Get Project

## Endpoint
GET /api/projects/:id

## Authentication
Required. Must be the project owner or admin.

## Logic

1. Query the project:
   ```sql
   SELECT id, name, description, owner_id, status, created_at, updated_at
   FROM projects
   WHERE id = $1 AND deleted_at IS NULL
   ```

2. If not found, return 404

3. Authorization check:
   - If the user is admin, allow
   - If the user is the owner (project.owner_id == auth.user_id), allow
   - Otherwise return 403

4. Optionally, get task counts for this project:
   ```sql
   SELECT
     COUNT(*) as total,
     COUNT(*) FILTER (WHERE status = 'todo') as todo,
     COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
     COUNT(*) FILTER (WHERE status = 'done') as done
   FROM tasks
   WHERE project_id = $1 AND deleted_at IS NULL
   ```

5. Return 200 with the project and task counts

## Response (200)
```json
{
  "data": {
    "id": "uuid",
    "name": "string",
    "description": "string or null",
    "owner_id": "uuid",
    "status": "active",
    "created_at": "timestamp",
    "updated_at": "timestamp",
    "task_counts": {
      "total": 10,
      "todo": 4,
      "in_progress": 3,
      "done": 3
    }
  }
}
```
