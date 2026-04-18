# Domain Model

## Product
- `id`: UUID, primary key
- `name`: string, required, 1-200 characters
- `description`: string, optional, max 5000 characters
- `price`: number (decimal), required, must be >= 0
- `stock`: integer, required, must be >= 0, default: 0
- `category`: string, optional, max 100 characters
- `created_at`: timestamp
- `updated_at`: timestamp
- `deleted_at`: timestamp (null if not deleted)

### Product Rules
- Product names must be unique (case-insensitive)
- Price must be a non-negative number rounded to 2 decimal places
- Stock cannot go below 0 — reject any update or sale that would result in negative stock
- Deleted products cannot be included in new sales

## Sale
- `id`: UUID, primary key
- `total_amount`: number (decimal), the total price of the sale (sum of all line items)
- `note`: string, optional, max 1000 characters — free-text note about the sale
- `created_at`: timestamp
- `updated_at`: timestamp
- `deleted_at`: timestamp (null if not deleted)

### Sale Rules
- A sale must contain at least one line item
- `total_amount` is computed as the sum of (unit_price * quantity) for all line items
- Once a sale is created, its line items are immutable
- Creating a sale decrements the stock of each product by the respective quantity

## SaleItem
- `id`: UUID, primary key
- `sale_id`: UUID, references Sale
- `product_id`: UUID, references Product
- `quantity`: integer, required, must be >= 1
- `unit_price`: number (decimal), the price of the product at the time of the sale (snapshot)

### SaleItem Rules
- `unit_price` is copied from the product's current price at the time of sale creation
- Quantity must be >= 1
