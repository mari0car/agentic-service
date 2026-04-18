```markdown
---
route: GET /api/products/:id
auth: not required
---

# Get Product

## Endpoint
GET /api/products/:id

## Authentication
Not required

## Path Parameters
- `id` (UUID, required): the unique identifier of the product to retrieve

## Logic

1. Validate the `id` path parameter:
   - Must be present and non-empty
   - Must be a valid UUID format
   - If invalid, return 400 with `validation_error`

2. Query the database for the product:

   ```sql
   SELECT id, name, description, price, stock, category, created_at, updated_at
   FROM products
   WHERE id = $id
     AND deleted_at IS NULL
   ```

3. If no row is returned, respond with 404 `not_found`.

4. Round `price` to 2 decimal places.

5. Return 200 with the product data.

## Success Response (200)
```json
{
  "data": {
    "id": "uuid",
    "name": "string",
    "description": "string or null",
    "price": 9.99,
    "stock": 42,
    "category": "string or null",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

## Error Responses

### 400 — Invalid ID format
```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": {
      "fields": [
        { "field": "id", "message": "must be a valid UUID" }
      ]
    }
  }
}
```

### 404 — Product not found
```json
{
  "error": {
    "code": "not_found",
    "message": "Product not found"
  }
}
```

### 500 — Unexpected error
```json
{
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred"
  }
}
```
```