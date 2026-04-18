---
route: POST /api/auth/register
auth: none
---

# Register User

## Endpoint
POST /api/auth/register (public, no authentication required)

## Input
Request body (JSON):
- `email` (string, required): valid email address
- `name` (string, required): 1-200 characters
- `password` (string, required): minimum 8 characters

## Logic

1. Validate input:
   - `email` must be present and a valid email format (use validate.email)
   - `name` must be present and between 1-200 characters (trimmed)
   - `password` must be present and at least 8 characters
   - If validation fails, return 400 with field-level errors

2. Check if a user with this email already exists:
   - Query: `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`
   - If a row exists, return 409 with code "conflict" and message "A user with this email already exists"

3. Hash the password:
   - Use crypto_hash_password with the provided password

4. Generate a new UUID for the user:
   - Use crypto_generate_token with type "uuid" to get a new id
   - Get the current timestamp using time_now (use the iso field)

5. Insert the user using the generated id and timestamp:
   - `INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`
   - Parameters: id, email, name, password_hash, current_timestamp

6. After inserting, query back the user to get the full record:
   - `SELECT id, email, name, role, created_at FROM users WHERE id = $1`

7. Generate a JWT token:
   - Use crypto_jwt_sign with payload: `{ "sub": "<user_id>", "role": "member" }`
   - Set expires_in_seconds to 86400 (24 hours)

8. Return 201 with the user data and token

## Response (201)
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "email": "string",
      "name": "string",
      "role": "member",
      "created_at": "timestamp"
    },
    "token": "jwt-string"
  }
}
```
