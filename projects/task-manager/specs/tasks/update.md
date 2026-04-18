---
route: PUT /api/projects/:project_id/tasks/:id
auth: required
---

# Update Task

## Endpoint
PUT /api/projects/:project_id/tasks/:id

## Authentication
Required. Must be project owner, the task's assignee, or admin.

## Input
Request body (JSON) - all fields optional:
- `title` (string): 1-200 characters
- `description` (string): max 5000 characters, or null to clear
- `status` (string): "todo", "in_progress", or "done"
- `priority` (string): "low", "medium", or "high"
- `assignee_id` (UUID or null): assign or unassign. Must be a project member.
- `due_date` (string or null): ISO 8601 date, or null to clear

At least one field must be provided.

## Logic

1. Validate that at least one field is provided. Return 400 if empty.

2. Validate provided fields:
   - `title` if present: trimmed, 1-200 characters
   - `description` if present: max 5000 characters (or null)
   - `status` if present: must be one of: todo, in_progress, done
   - `priority` if present: must be one of: low, medium, high
   - `assignee_id` if present: valid UUID (or null to unassign)
   - `due_date` if present: valid date format (or null to clear)
   - Return 400 with field errors if invalid

3. Query the existing task:
   ```sql
   SELECT t.id, t.project_id, t.title, t.status, t.assignee_id, p.owner_id
   FROM tasks t
   JOIN projects p ON t.project_id = p.id
   WHERE t.id = $1 AND t.project_id = $2 AND t.deleted_at IS NULL
   ```
   If not found, return 404

4. Authorization:
   - Admin: allow
   - Project owner (p.owner_id == user_id): allow
   - Task assignee (t.assignee_id == user_id): allow
   - Otherwise: return 403

5. If `status` is being changed, validate the transition:
   - Allowed transitions: todo -> in_progress, in_progress -> done
   - If the current status is "todo" and new status is "done", return 400 with message "Cannot skip from todo to done. Must transition through in_progress."
   - If the new status is "before" the current status (going backward), return 400 with message "Cannot move task backward. Status can only progress forward."
   - If the status is unchanged, that's fine (no-op for status)

6. If `assignee_id` is being set (not null), verify the user exists and is a project member:
   - Check user exists
   - Check they are the project owner or assigned to a task in this project
   - If not valid, return 400 with message "Assignee is not a project member"

7. Build and execute the UPDATE:
   - Only update fields that were provided
   - Always set `updated_at = now()`
   ```sql
   UPDATE tasks
   SET title = COALESCE($1, title),
       description = $2,
       status = COALESCE($3, status),
       priority = COALESCE($4, priority),
       assignee_id = $5,
       due_date = $6,
       updated_at = now()
   WHERE id = $7
   RETURNING id, project_id, title, description, status, priority, assignee_id, due_date, created_at, updated_at
   ```
   (Adjust the query to only SET the fields that were actually provided in the request)

8. Fetch assignee name if assignee_id is set

9. Return 200 with the updated task

## Response (200)
```json
{
  "data": {
    "id": "uuid",
    "project_id": "uuid",
    "title": "string",
    "description": "string or null",
    "status": "string",
    "priority": "string",
    "assignee_id": "uuid or null",
    "assignee_name": "string or null",
    "due_date": "date or null",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```
