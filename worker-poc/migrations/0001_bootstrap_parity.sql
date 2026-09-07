PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS calendar_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_date TEXT NOT NULL,
  vendor TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'A' CHECK (mode IN ('A', 'B')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_date)
);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_date TEXT NOT NULL,
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_date, line_user_id)
);

CREATE TABLE IF NOT EXISTS order_status (
  order_row_id INTEGER PRIMARY KEY REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_calendar_settings_order_date
  ON calendar_settings(order_date);

CREATE INDEX IF NOT EXISTS idx_likes_order_date
  ON likes(order_date);

CREATE INDEX IF NOT EXISTS idx_likes_user_order_date
  ON likes(line_user_id, order_date);

CREATE INDEX IF NOT EXISTS idx_order_status_status
  ON order_status(status);
