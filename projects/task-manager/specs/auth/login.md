---
route: POST /api/auth/login
auth: none
tool_handler: auth/login
---

# Login

## Endpoint
POST /api/auth/login (public, no authentication required)

## Input
Request body (JSON):
- `email` (string, required)
- `password` (string, required)

## Logic

1. Validate that both `email` and `password` are present
   - If either is missing, return 400

2. Query the user by email:
   - `SELECT id, email, name, role, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL`
   - If no user found, return 401 with code "unauthorized" and message "Invalid email or password"
   - Important: use the same error message for both "user not found" and "wrong password" to prevent user enumeration

3. Verify the password:
   - Use crypto_verify_password with the provided password and the stored password_hash
   - If invalid, return 401 with code "unauthorized" and message "Invalid email or password"

4. Generate a JWT token:
   - Use crypto_jwt_sign with payload: `{ "sub": "<user_id>", "role": "<user_role>" }`
   - Set expires_in_seconds to 86400 (24 hours)

5. Return 200 with user data and token

## Response (200)
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "email": "string",
      "name": "string",
      "role": "string"
    },
    "token": "jwt-string"
  }
}
```
