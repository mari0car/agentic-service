# Authentication and Authorization

## Authentication
All endpoints except public ones require a JWT in the `Authorization: Bearer <token>` header.

The JWT contains:
- `sub`: user ID (UUID)
- `role`: user role (admin or member)
- `exp`: expiration timestamp

Validation: use crypto.jwt_verify. If invalid or expired, return 401.

## Public Endpoints (no auth required)
- POST /api/auth/register
- POST /api/auth/login

## Authorization Rules

### Projects
- **List**: members see their own projects (where they are owner). Admins see all.
- **Create**: any authenticated user
- **View**: owner or admin
- **Update**: owner or admin
- **Archive**: owner or admin

### Tasks
- **List tasks in project**: must be project owner, task assignee in that project, or admin
- **Create task**: must be project owner or admin. Project must be active (not archived).
- **View task**: same as list tasks
- **Update task**: must be project owner, the task's assignee, or admin

### Checking project membership
A user is a "project member" if:
1. They are the project owner (`projects.owner_id = user_id`), OR
2. They are assigned to any task in that project (`tasks.assignee_id = user_id AND tasks.project_id = project_id`), OR
3. They have role = admin
