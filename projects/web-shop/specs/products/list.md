---
route: GET /api/products
---

# List Products

## Endpoint
GET /api/products

## Query Parameters
- `page` (integer, optional): page number, default 1
- `per_page` (integer, optional): items per page, default 20, max 100
- `category` (string, optional): filter by category (exact match, case-insensitive)
- `q` (string, optional): search by product name (partial, case-insensitive)

## Logic

1. Parse and validate pagination parameters:
   - `page` defaults to 1, must be >= 1
   - `per_page` defaults to 20, must be between 1 and 100

2. Calculate offset: `(page - 1) * per_page`

3. Build and execute the count + list queries. Apply optional filters:
   - If `category` is provided: `AND LOWER(category) = LOWER($category)`
   - If `q` is provided: `AND LOWER(name) LIKE '%' || LOWER($q) || '%'`

   ```sql
   SELECT id, name, description, price, stock, category, created_at, updated_at
   FROM products
   WHERE deleted_at IS NULL
     [AND LOWER(category) = LOWER($category)]
     [AND LOWER(name) LIKE '%' || LOWER($q) || '%']
   ORDER BY name ASC
   LIMIT $per_page OFFSET $offset
   ```

4. Execute a count query with the same WHERE clause (without LIMIT/OFFSET).

5. Return 200 with the list and pagination metadata.

## Response (200)
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "string",
      "description": "string or null",
      "price": 9.99,
      "stock": 42,
      "category": "string or null",
      "created_at": "timestamp",
      "updated_at": "timestamp"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 42
  }
}
```
