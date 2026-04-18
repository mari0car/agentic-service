-- Seed products
INSERT INTO products (id, name, description, price, stock, category, created_at, updated_at, deleted_at)
VALUES
  ('a1b2c3d4-0001-0001-0001-000000000001', 'Wireless Mouse', 'Ergonomic wireless mouse with USB receiver and long battery life.', 29.99, 150, 'Electronics', datetime('now'), datetime('now'), NULL),
  ('a1b2c3d4-0002-0002-0002-000000000002', 'Mechanical Keyboard', 'Compact TKL mechanical keyboard with Cherry MX Blue switches.', 89.99, 75, 'Electronics', datetime('now'), datetime('now'), NULL),
  ('a1b2c3d4-0003-0003-0003-000000000003', 'USB-C Hub', '7-in-1 USB-C hub with HDMI, USB 3.0, SD card reader and PD charging.', 49.99, 200, 'Electronics', datetime('now'), datetime('now'), NULL),
  ('a1b2c3d4-0004-0004-0004-000000000004', 'Desk Lamp', 'LED desk lamp with adjustable brightness and colour temperature.', 34.99, 60, 'Office', datetime('now'), datetime('now'), NULL),
  ('a1b2c3d4-0005-0005-0005-000000000005', 'Notebook A5', 'A5 ruled hardcover notebook, 200 pages, lay-flat binding.', 9.99, 500, 'Stationery', datetime('now'), datetime('now'), NULL),
  ('a1b2c3d4-0006-0006-0006-000000000006', 'Ballpoint Pen Set', 'Set of 10 ballpoint pens in assorted colours.', 4.99, 300, 'Stationery', datetime('now'), datetime('now'), NULL),
  ('a1b2c3d4-0007-0007-0007-000000000007', 'Monitor Stand', 'Adjustable aluminium monitor stand with storage shelf underneath.', 59.99, 40, 'Office', datetime('now'), datetime('now'), NULL),
  ('a1b2c3d4-0008-0008-0008-000000000008', 'Webcam HD', '1080p HD webcam with built-in microphone and auto-focus.', 74.99, 90, 'Electronics', datetime('now'), datetime('now'), NULL),
  ('a1b2c3d4-0009-0009-0009-000000000009', 'Cable Organiser', 'Silicone cable management clips, pack of 20.', 7.99, 400, 'Office', datetime('now'), datetime('now'), NULL),
  ('a1b2c3d4-0010-0010-0010-000000000010', 'Laptop Sleeve 15"', 'Water-resistant neoprene sleeve for 15-inch laptops.', 19.99, 120, 'Accessories', datetime('now'), datetime('now'), NULL);

-- Seed sales
INSERT INTO sales (id, total_amount, note, created_at, updated_at, deleted_at)
VALUES
  ('b2c3d4e5-0001-0001-0001-000000000001', 119.97, 'Office restock order.', datetime('now'), datetime('now'), NULL),
  ('b2c3d4e5-0002-0002-0002-000000000002', 49.99, 'Single hub purchase.', datetime('now'), datetime('now'), NULL),
  ('b2c3d4e5-0003-0003-0003-000000000003', 34.96, 'Stationery bundle.', datetime('now'), datetime('now'), NULL),
  ('b2c3d4e5-0004-0004-0004-000000000004', 154.98, 'Home office setup.', datetime('now'), datetime('now'), NULL);

-- Seed sale items
-- Sale 1: Wireless Mouse x1 (29.99) + Mechanical Keyboard x1 (89.99) = 119.97 ... actually 29.99+89.99=119.98; adjust note below
-- Recalculate: 29.99 + 89.99 = 119.98 — correcting total_amount above would need an UPDATE; use accurate values instead

-- Sale 1 items: Wireless Mouse x1 = 29.99, Mechanical Keyboard x1 = 89.99 => total 119.98
-- Sale 2 items: USB-C Hub x1 = 49.99 => total 49.99
-- Sale 3 items: Notebook A5 x2 = 19.98, Ballpoint Pen Set x3 = 14.97 => total 34.95
-- Sale 4 items: Webcam HD x1 = 74.99, Monitor Stand x1 = 59.99, Laptop Sleeve x1 = 19.99 => total 154.97

UPDATE sales SET total_amount = 119.98 WHERE id = 'b2c3d4e5-0001-0001-0001-000000000001';
UPDATE sales SET total_amount = 49.99  WHERE id = 'b2c3d4e5-0002-0002-0002-000000000002';
UPDATE sales SET total_amount = 34.95  WHERE id = 'b2c3d4e5-0003-0003-0003-000000000003';
UPDATE sales SET total_amount = 154.97 WHERE id = 'b2c3d4e5-0004-0004-0004-000000000004';

INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price)
VALUES
  -- Sale 1: office restock
  ('c3d4e5f6-0001-0001-0001-000000000001', 'b2c3d4e5-0001-0001-0001-000000000001', 'a1b2c3d4-0001-0001-0001-000000000001', 1, 29.99),
  ('c3d4e5f6-0001-0001-0001-000000000002', 'b2c3d4e5-0001-0001-0001-000000000001', 'a1b2c3d4-0002-0002-0002-000000000002', 1, 89.99),

  -- Sale 2: single hub purchase
  ('c3d4e5f6-0002-0002-0002-000000000001', 'b2c3d4e5-0002-0002-0002-000000000002', 'a1b2c3d4-0003-0003-0003-000000000003', 1, 49.99),

  -- Sale 3: stationery bundle
  ('c3d4e5f6-0003-0003-0003-000000000001', 'b2c3d4e5-0003-0003-0003-000000000003', 'a1b2c3d4-0005-0005-0005-000000000005', 2, 9.99),
  ('c3d4e5f6-0003-0003-0003-000000000002', 'b2c3d4e5-0003-0003-0003-000000000003', 'a1b2c3d4-0006-0006-0006-000000000006', 3, 4.99),

  -- Sale 4: home office setup
  ('c3d4e5f6-0004-0004-0004-000000000001', 'b2c3d4e5-0004-0004-0004-000000000004', 'a1b2c3d4-0008-0008-0008-000000000008', 1, 74.99),
  ('c3d4e5f6-0004-0004-0004-000000000002', 'b2c3d4e5-0004-0004-0004-000000000004', 'a1b2c3d4-0007-0007-0007-000000000007', 1, 59.99),
  ('c3d4e5f6-0004-0004-0004-000000000003', 'b2c3d4e5-0004-0004-0004-000000000004', 'a1b2c3d4-0010-0010-0010-000000000010', 1, 19.99);

-- Decrement stock to reflect the sales above
-- Sale 1: Wireless Mouse -1, Mechanical Keyboard -1
UPDATE products SET stock = stock - 1 WHERE id = 'a1b2c3d4-0001-0001-0001-000000000001';
UPDATE products SET stock = stock - 1 WHERE id = 'a1b2c3d4-0002-0002-0002-000000000002';

-- Sale 2: USB-C Hub -1
UPDATE products SET stock = stock - 1 WHERE id = 'a1b2c3d4-0003-0003-0003-000000000003';

-- Sale 3: Notebook A5 -2, Ballpoint Pen Set -3
UPDATE products SET stock = stock - 2 WHERE id = 'a1b2c3d4-0005-0005-0005-000000000005';
UPDATE products SET stock = stock - 3 WHERE id = 'a1b2c3d4-0006-0006-0006-000000000006';

-- Sale 4: Webcam HD -1, Monitor Stand -1, Laptop Sleeve -1
UPDATE products SET stock = stock - 1 WHERE id = 'a1b2c3d4-0008-0008-0008-000000000008';
UPDATE products SET stock = stock - 1 WHERE id = 'a1b2c3d4-0007-0007-0007-000000000007';
UPDATE products SET stock = stock - 1 WHERE id = 'a1b2c3d4-0010-0010-0010-000000000010';