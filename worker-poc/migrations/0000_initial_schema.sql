PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  pickup_floor TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'User',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  order_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  subtotal REAL NOT NULL CHECK (subtotal >= 0),
  pickup_floor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  note TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (menu_date, vendor, item_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_line_user_id
  ON orders(line_user_id);

CREATE INDEX IF NOT EXISTS idx_orders_user_order_date
  ON orders(line_user_id, order_date);

CREATE INDEX IF NOT EXISTS idx_announcements_active_window
  ON announcements(enabled, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_menu_vendor_date
  ON menu(vendor, menu_date);
