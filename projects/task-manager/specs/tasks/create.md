---
route: POST /api/projects/:project_id/tasks
auth: required
---

# Create Task

## Endpoint
POST /api/projects/:project_id/tasks

## Authentication
Required. Must be project owner or admin. Project must be active (not archived).

## Input
Request body (JSON):
- `title` (string, required): 1-200 characters
- `description` (string, optional): max 5000 characters
- `priority` (string, optional): "low", "medium", or "high". Default: "medium"
- `assignee_id` (UUID, optional): must be a project member
- `due_date` (string, optional): ISO 8601 date (YYYY-MM-DD), must be today or future

## Logic

1. Validate input:
   - `title` required, trimmed, 1-200 characters
   - `description` if present, max 5000 characters
   - `priority` if present, must be one of: low, medium, high
   - `assignee_id` if present, must be a valid UUID
   - `due_date` if present, must be a valid date and not in the past
   - Return 400 with field errors if invalid

2. Verify the project exists, is not deleted, and is active:
   ```sql
   SELECT id, owner_id, status FROM projects WHERE id = $1 AND deleted_at IS NULL
   ```
   - If not found, return 404
   - If status is "archived", return 400 with message "Cannot add tasks to an archived project"

3. Authorization: user must be owner or admin. Otherwise return 403.

4. If `assignee_id` is provided, verify the user exists and is a project member:
   - Check user exists: `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL`
   - If not found, return 400 with message "Assignee not found"
   - Check project membership: user is owner or assigned to a task in this project
   - If not a member, return 400 with message "Assignee is not a project member"
   - Exception: if the assignee is the project owner, they are always valid

5. If `due_date` is provided:
   - Use time_now to get today's date
   - If due_date is before today, return 400 with message "Due date must be today or in the future"

6. Generate a new UUID for the task using crypto_generate_token (type: "uuid").
   Get the current ISO timestamp using time_now.

7. Insert the task with the generated id and timestamps:
   ```sql
   INSERT INTO tasks (id, project_id, title, description, priority, assignee_id, due_date, created_at, updated_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
   ```
   Parameters: id, project_id, title, description, priority (default 'medium'), assignee_id (or null), due_date (or null), current_timestamp

8. Query the inserted task back:
   ```sql
   SELECT id, project_id, title, description, status, priority, assignee_id, due_date, created_at, updated_at FROM tasks WHERE id = $1
   ```

9. If assignee_id was set, fetch the assignee name:
   ```sql
   SELECT name FROM users WHERE id = $1
   ```

10. Return 201 with the created task

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
    "assignee_name": "string or null",
    "due_date": "date or null",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```
