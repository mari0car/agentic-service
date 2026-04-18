# Data Model

## Notes
- All `id` columns are UUIDs stored as TEXT. Always generate IDs using `crypto_generate_token` with `type: "uuid"` before inserting.
- All timestamp columns (`created_at`, `updated_at`, `deleted_at`) store ISO 8601 strings. Use `time_now` to get the current timestamp.
- For soft deletes: set `deleted_at` to the current ISO timestamp. Always add `AND deleted_at IS NULL` to SELECT queries.
- `price`, `unit_price`, and `total_amount` are stored as REAL (floating point). Always round to 2 decimal places when returning values.

## Tables

### products
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT (UUID) | PK — generate with crypto_generate_token |
| name | TEXT | NOT NULL, UNIQUE |
| description | TEXT | NULL |
| price | REAL | NOT NULL, >= 0 |
| stock | INTEGER | NOT NULL, DEFAULT 0, >= 0 |
| category | TEXT | NULL |
| created_at | TEXT (ISO 8601) | NOT NULL |
| updated_at | TEXT (ISO 8601) | NOT NULL |
| deleted_at | TEXT (ISO 8601) | NULL — soft delete timestamp |

### sales
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT (UUID) | PK — generate with crypto_generate_token |
| total_amount | REAL | NOT NULL |
| note | TEXT | NULL |
| created_at | TEXT (ISO 8601) | NOT NULL |
| updated_at | TEXT (ISO 8601) | NOT NULL |
| deleted_at | TEXT (ISO 8601) | NULL — soft delete timestamp |

### sale_items
| Column | Type | Constraints |
|--------|------|-------------|
| id | TEXT (UUID) | PK — generate with crypto_generate_token |
| sale_id | TEXT (UUID) | NOT NULL, FK -> sales(id) |
| product_id | TEXT (UUID) | NOT NULL, FK -> products(id) |
| quantity | INTEGER | NOT NULL, >= 1 |
| unit_price | REAL | NOT NULL |

## Indexes
- `idx_products_name` on products(name)
- `idx_products_category` on products(category)
- `idx_sale_items_sale_id` on sale_items(sale_id)
- `idx_sale_items_product_id` on sale_items(product_id)
