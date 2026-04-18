---
route: POST /api/products
---

# Create Product

## Endpoint
POST /api/products

## Input
Request body (JSON):
- `name` (string, required): 1-200 characters
- `description` (string, optional): max 5000 characters
- `price` (number, required): non-negative, will be rounded to 2 decimal places
- `stock` (integer, optional): non-negative, default 0
- `category` (string, optional): max 100 characters

## Logic

1. Validate input:
   - `name` must be present, trimmed, 1-200 characters
   - `price` must be present and >= 0
   - `stock` if provided must be an integer >= 0, defaults to 0
   - `description` if provided, max 5000 characters
   - `category` if provided, max 100 characters
   - Return 400 with field errors if invalid

2. Check for duplicate product name (case-insensitive):
   ```sql
   SELECT id FROM products WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL
   ```
   If exists, return 409 with code "conflict" and message "A product with this name already exists".

3. Round `price` to 2 decimal places.

4. Generate a new UUID using `crypto_generate_token` (type: "uuid").
   Get the current ISO timestamp using `time_now`.

5. Insert the product:
   ```sql
   INSERT INTO products (id, name, description, price, stock, category, created_at, updated_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
   ```

6. Query the inserted product back:
   ```sql
   SELECT id, name, description, price, stock, category, created_at, updated_at
   FROM products WHERE id = $1
   ```

7. Return 201 with the created product.

## Response (201)
```json
{
  "data": {
    "id": "uuid",
    "name": "string",
    "description": "string or null",
    "price": 9.99,
    "stock": 0,
    "category": "string or null",
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```
