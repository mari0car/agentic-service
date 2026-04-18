```markdown
---
route: GET /api/sales
auth: not required
---

# List Sales

## Endpoint
GET /api/sales

## Authentication
Not required

## Query Parameters
- `page` (integer, optional): page number, default 1, must be >= 1
- `per_page` (integer, optional): items per page, default 20, must be between 1 and 100

## Logic

1. Parse and validate pagination parameters:
   - `page` defaults to 1; if provided, must be an integer >= 1
   - `per_page` defaults to 20; if provided, must be an integer between 1 and 100
   - If either value is invalid, return 400 `validation_error` with appropriate field errors

2. Calculate offset: `(page - 1) * per_page`

3. Execute a count query to get the total number of non-deleted sales:
   ```sql
   SELECT COUNT(*) AS total
   FROM sales
   WHERE deleted_at IS NULL
   ```

4. Execute the list query with pagination:
   ```sql
   SELECT id, total_amount, note, created_at, updated_at
   FROM sales
   WHERE deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT $per_page OFFSET $offset
   ```

5. For each sale returned, fetch its associated line items:
   ```sql
   SELECT si.id, si.product_id, si.quantity, si.unit_price
   FROM sale_items si
   WHERE si.sale_id = $sale_id
   ORDER BY si.id ASC
   ```

6. Round `total_amount` and `unit_price` to 2 decimal places for each sale and line item.

7. Return 200 with the list of sales (each including their line items) and pagination metadata.

## Success Response (200)
```json
{
  "data": [
    {
      "id": "uuid",
      "total_amount": 49.99,
      "note": "string or null",
      "items": [
        {
          "id": "uuid",
          "product_id": "uuid",
          "quantity": 2,
          "unit_price": 24.99
        }
      ],
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 42
  }
}
```

## Error Responses

### 400 — Invalid pagination parameters
```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": {
      "fields": [
        { "field": "page", "message": "must be an integer >= 1" },
        { "field": "per_page", "message": "must be an integer between 1 and 100" }
      ]
    }
  }
}
```

### 500 — Unexpected server error
```json
{
  "error": {
    "code": "internal_error",
    "message": "An unexpected error occurred"
  }
}
```
```