CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- users.id is the Cognito `sub` claim — the source of truth for identity is Cognito,
-- this table is the local profile/app-data row keyed by that sub. Created just-in-time
-- on the first authenticated request (see shared/auth.py: upsert_user_from_claims).
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  image_url TEXT,
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'processing', 'shipped', 'cancelled')) DEFAULT 'confirmed',
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  shipping_address TEXT NOT NULL,
  invoice_status TEXT NOT NULL CHECK (invoice_status IN ('pending', 'sent', 'failed')) DEFAULT 'pending',
  invoice_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_stock ON products(stock);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

INSERT INTO products (sku, name, description, category, price_cents, image_url, stock)
VALUES
('LAP-001', 'CloudBook Pro 14', 'Lightweight laptop for students, developers, and cloud engineers.', 'Laptops', 129900, '/assets/products/cloudbook-pro.svg', 15),
('LAP-002', 'CloudBook Air 13', 'Portable everyday laptop with long battery life and fast startup.', 'Laptops', 99900, '/assets/products/cloudbook-air.svg', 12),
('PHN-001', 'Nimbus Phone X', 'Fast smartphone with strong battery life and secure authentication.', 'Phones', 89900, '/assets/products/nimbus-phone-x.svg', 25),
('PHN-002', 'Nimbus Phone Mini', 'Compact smartphone for travel, work, and everyday communication.', 'Phones', 59900, '/assets/products/nimbus-phone-mini.svg', 3),
('ACC-001', 'SecureKey USB-C', 'Hardware security key for modern authentication flows.', 'Accessories', 4900, '/assets/products/securekey.svg', 100),
('ACC-002', 'USB-C Dock Station', 'Multi-port dock with HDMI, Ethernet, and fast charging support.', 'Accessories', 11900, '/assets/products/dock-station.svg', 8),
('AUD-001', 'EchoPods Wireless', 'Wireless earbuds for calls, music, and travel.', 'Audio', 14900, '/assets/products/echopods.svg', 40),
('AUD-002', 'FocusMax Headphones', 'Noise-cancelling headphones for deep work and long flights.', 'Audio', 24900, '/assets/products/headphones.svg', 6),
('MON-001', 'UltraView 27 Monitor', '27-inch high resolution display for productivity and gaming.', 'Monitors', 32900, '/assets/products/monitor-27.svg', 20),
('MON-002', 'UltraView 34 Curved', 'Wide curved monitor for dashboards, coding, and creative work.', 'Monitors', 52900, '/assets/products/monitor-34.svg', 4),
('BAG-001', 'TravelTech Backpack', 'Water-resistant backpack with laptop compartment and cable organizer.', 'Accessories', 7900, '/assets/products/backpack.svg', 50),
('NET-001', 'Mesh Wi-Fi Duo', 'Two-node mesh Wi-Fi kit for reliable home and office coverage.', 'Networking', 19900, '/assets/products/mesh-wifi.svg', 9)
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  price_cents = EXCLUDED.price_cents,
  image_url = EXCLUDED.image_url,
  stock = GREATEST(products.stock, 0),
  is_active = TRUE,
  updated_at = NOW();
