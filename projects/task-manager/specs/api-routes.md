# API Routes

## Authentication
- `POST /api/auth/register` -> auth/register.md
- `POST /api/auth/login` -> auth/login.md

## Projects
- `GET /api/projects` -> projects/list.md
- `POST /api/projects` -> projects/create.md
- `GET /api/projects/:id` -> projects/get.md
- `PUT /api/projects/:id` -> projects/update.md

## Tasks
- `GET /api/projects/:project_id/tasks` -> tasks/list.md
- `POST /api/projects/:project_id/tasks` -> tasks/create.md
- `GET /api/projects/:project_id/tasks/:id` -> tasks/get.md
- `PUT /api/projects/:project_id/tasks/:id` -> tasks/update.md
