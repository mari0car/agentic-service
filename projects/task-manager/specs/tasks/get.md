---
route: GET /api/projects/:project_id/tasks/:id
auth: required
---

# Get Task

## Endpoint
GET /api/projects/:project_id/tasks/:id

## Authentication
Required. Must be a project member (owner, assignee, or admin).

## Logic

1. Query the task with assignee info:
   ```sql
   SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
          t.assignee_id, u.name as assignee_name, u.email as assignee_email,
          t.due_date, t.created_at, t.updated_at
   FROM tasks t
   LEFT JOIN users u ON t.assignee_id = u.id
   WHERE t.id = $1 AND t.project_id = $2 AND t.deleted_at IS NULL
   ```

2. If not found, return 404

3. Verify the project exists:
   ```sql
   SELECT id, owner_id FROM projects WHERE id = $1 AND deleted_at IS NULL
   ```
   If not found, return 404

4. Check project membership (see auth-policies.md):
   - Admin: allow
   - Project owner: allow
   - Assigned to any task in project: allow
   - Otherwise: return 403

5. Return 200 with the task

## Response (200)
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
    "assignee_name": "string or null",
    "assignee_email": "string or null",
    "due_date": "date or null",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```
