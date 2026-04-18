# Data Model

## Notes
- All `id` columns are UUIDs stored as TEXT. Always generate IDs using `crypto_generate_token` with `type: "uuid"` before inserting.
- All timestamp columns (`created_at`, `updated_at`, `deleted_at`) store ISO 8601 strings. Use `time_now` to get the current timestamp.
- For soft deletes: set `deleted_at` to the current ISO timestamp. Always add `AND deleted_at IS NULL` to SELECT queries.

## Tables

### users
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT (UUID) | PK — generate with crypto_generate_token |
| email | TEXT | NOT NULL, UNIQUE |
| name | TEXT | NOT NULL |
| password_hash | TEXT | NOT NULL — NEVER include in API responses |
| role | TEXT | NOT NULL, DEFAULT 'member' |
| created_at | TEXT (ISO 8601) | NOT NULL |
| updated_at | TEXT (ISO 8601) | NOT NULL |
| deleted_at | TEXT (ISO 8601) | NULL — soft delete timestamp |

### projects
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT (UUID) | PK — generate with crypto_generate_token |
| name | TEXT | NOT NULL |
| description | TEXT | NULL |
| owner_id | TEXT (UUID) | NOT NULL, FK -> users(id) |
| status | TEXT | NOT NULL, DEFAULT 'active' |
| created_at | TEXT (ISO 8601) | NOT NULL |
| updated_at | TEXT (ISO 8601) | NOT NULL |
| deleted_at | TEXT (ISO 8601) | NULL |
| UNIQUE(owner_id, name) | | |

### tasks
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT (UUID) | PK — generate with crypto_generate_token |
| project_id | TEXT (UUID) | NOT NULL, FK -> projects(id) |
| title | TEXT | NOT NULL |
| description | TEXT | NULL |
| status | TEXT | NOT NULL, DEFAULT 'todo' |
| priority | TEXT | NOT NULL, DEFAULT 'medium' |
| assignee_id | TEXT (UUID) | NULL, FK -> users(id) |
| due_date | TEXT (YYYY-MM-DD) | NULL |
| created_at | TEXT (ISO 8601) | NOT NULL |
| updated_at | TEXT (ISO 8601) | NOT NULL |
| deleted_at | TEXT (ISO 8601) | NULL |

## Indexes
- `idx_users_email` on users(email)
- `idx_projects_owner_id` on projects(owner_id)
- `idx_tasks_project_id` on tasks(project_id)
- `idx_tasks_assignee_id` on tasks(assignee_id)
