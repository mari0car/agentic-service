# Domain Model

## User
- `id`: UUID, primary key
- `email`: string, unique, required, must be valid email
- `name`: string, required, 1-200 characters
- `password_hash`: string, never exposed in API responses
- `role`: one of [admin, member], default: member
- `created_at`: timestamp
- `updated_at`: timestamp
- `deleted_at`: timestamp (null if not deleted)

## Project
- `id`: UUID, primary key
- `name`: string, required, 1-100 characters
- `description`: string, optional, max 2000 characters
- `owner_id`: UUID, references User
- `status`: one of [active, archived], default: active
- `created_at`: timestamp
- `updated_at`: timestamp
- `deleted_at`: timestamp (null if not deleted)

### Project Rules
- Project names must be unique per owner
- Only the owner or an admin can update/archive a project
- Archived projects cannot have new tasks added

## Task
- `id`: UUID, primary key
- `project_id`: UUID, references Project
- `title`: string, required, 1-200 characters
- `description`: string, optional, max 5000 characters
- `status`: one of [todo, in_progress, done], default: todo
- `priority`: one of [low, medium, high], default: medium
- `assignee_id`: UUID, references User, optional
- `due_date`: date, optional
- `created_at`: timestamp
- `updated_at`: timestamp
- `deleted_at`: timestamp (null if not deleted)

### Task Rules
- Status transitions: todo -> in_progress -> done (forward only, no skipping)
- Due date must be today or in the future when initially set
- Assignee must be the project owner or someone assigned to a task in the same project
