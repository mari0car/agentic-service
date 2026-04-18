# Task Manager Service

## Description
A task management API for teams. Users can create projects, add tasks, assign them to team members, and track progress.

## Global Rules
- All timestamps are UTC, formatted as ISO 8601
- All IDs are UUIDs
- Pagination: default page=1, per_page=20, max per_page=100
- Soft deletion: set `deleted_at` timestamp, exclude from queries by default (WHERE deleted_at IS NULL)
- All string inputs are trimmed of leading/trailing whitespace

## Response Envelope
Success (single resource):
```json
{ "data": { ... } }
```

Success (list):
```json
{ "data": [ ... ], "meta": { "page": 1, "per_page": 20, "total": 42 } }
```

Error:
```json
{ "error": { "code": "error_code", "message": "Human-readable message" } }
```
