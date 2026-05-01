CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- In Cognito mode, users.id is the Cognito `sub` claim and Cognito owns identity;
-- this table is just the profile/app-data row keyed by sub.
-- In local-dev mode (services/auth/main.py /register + /login), the id is generated
-- here and password_hash + role are populated locally.
-- The two modes coexist: password_hash and role are nullable, so a Cognito user just
-- has them as NULL while a local user has both set.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT CHECK (role IN ('customer', 'admin')),
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
('LAP-001', 'CloudBook Pro 14', 'Lightweight laptop for students, developers, and cloud engineers.', 'Laptops', 129900, 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8', 15),
('LAP-002', 'CloudBook Air 13', 'Portable everyday laptop with long battery life and fast startup.', 'Laptops', 99900, 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853', 12),
('PHN-001', 'Nimbus Phone X', 'Fast smartphone with strong battery life and secure authentication.', 'Phones', 89900, 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9', 25),
('PHN-002', 'Nimbus Phone Mini', 'Compact smartphone for travel, work, and everyday communication.', 'Phones', 59900, 'https://images.unsplash.com/photo-1598327105666-5b89351aff97', 3),
('ACC-001', 'SecureKey USB-C', 'Hardware security key for modern authentication flows.', 'Accessories', 4900, 'https://images.unsplash.com/photo-1563986768609-322da13575f3', 100),
('ACC-002', 'USB-C Dock Station', 'Multi-port dock with HDMI, Ethernet, and fast charging support.', 'Accessories', 11900, 'https://images.unsplash.com/photo-1625948515291-69613efd103f', 8),
('AUD-001', 'EchoPods Wireless', 'Wireless earbuds for calls, music, and travel.', 'Audio', 14900, 'https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1', 40),
('AUD-002', 'FocusMax Headphones', 'Noise-cancelling headphones for deep work and long flights.', 'Audio', 24900, 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e', 6),
('MON-001', 'UltraView 27 Monitor', '27-inch high resolution display for productivity and gaming.', 'Monitors', 32900, 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf', 20),
('MON-002', 'UltraView 34 Curved', 'Wide curved monitor for dashboards, coding, and creative work.', 'Monitors', 52900, 'https://images.unsplash.com/photo-1547082299-de196ea013d6', 4),
('BAG-001', 'TravelTech Backpack', 'Water-resistant backpack with laptop compartment and cable organizer.', 'Accessories', 7900, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62', 50),
('NET-001', 'Mesh Wi-Fi Duo', 'Two-node mesh Wi-Fi kit for reliable home and office coverage.', 'Networking', 19900, 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8', 9)
ON CONFLICT (sku) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  price_cents = EXCLUDED.price_cents,
  image_url = EXCLUDED.image_url,
  stock = GREATEST(products.stock, 0),
  is_active = TRUE,
  updated_at = NOW();
