---
route: GET /api/projects/:project_id/tasks
auth: required
---

# List Tasks

## Endpoint
GET /api/projects/:project_id/tasks

## Authentication
Required. Must be a project member (owner, assignee, or admin).

## Query Parameters
- `page` (integer, optional): default 1
- `per_page` (integer, optional): default 20, max 100
- `status` (string, optional): filter by "todo", "in_progress", or "done"
- `priority` (string, optional): filter by "low", "medium", or "high"
- `assignee_id` (UUID, optional): filter by assignee

## Logic

1. Parse and validate query parameters:
   - `page` >= 1, default 1
   - `per_page` between 1-100, default 20
   - `status` if provided must be one of: todo, in_progress, done
   - `priority` if provided must be one of: low, medium, high
   - Return 400 if invalid

2. Verify the project exists and is not deleted:
   ```sql
   SELECT id, owner_id FROM projects WHERE id = $1 AND deleted_at IS NULL
   ```
   If not found, return 404

3. Check project membership (see auth-policies.md):
   - If user is admin, allow
   - If user is project owner, allow
   - Check if user is assigned to any task in this project:
     ```sql
     SELECT 1 FROM tasks WHERE project_id = $1 AND assignee_id = $2 AND deleted_at IS NULL LIMIT 1
     ```
   - If none of the above, return 403

4. Query tasks with optional filters:
   ```sql
   SELECT t.id, t.title, t.description, t.status, t.priority,
          t.assignee_id, u.name as assignee_name,
          t.due_date, t.created_at, t.updated_at
   FROM tasks t
   LEFT JOIN users u ON t.assignee_id = u.id
   WHERE t.project_id = $1
     AND t.deleted_at IS NULL
     AND ($2::varchar IS NULL OR t.status = $2)
     AND ($3::varchar IS NULL OR t.priority = $3)
     AND ($4::uuid IS NULL OR t.assignee_id = $4)
   ORDER BY t.created_at DESC
   LIMIT $5 OFFSET $6
   ```

5. Get total count with same filters (without LIMIT/OFFSET)

6. Return 200 with tasks and pagination

## Response (200)
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "description": "string or null",
      "status": "todo",
      "priority": "medium",
      "assignee_id": "uuid or null",
      "assignee_name": "string or null",
      "due_date": "date or null",
      "created_at": "timestamp",
      "updated_at": "timestamp"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 8
  }
}
```
