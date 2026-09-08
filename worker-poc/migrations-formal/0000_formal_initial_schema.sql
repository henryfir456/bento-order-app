PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS import_batches (
  batch_id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  importer_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'VALIDATING'
    CHECK (status IN ('VALIDATING', 'STAGED', 'QUARANTINED', 'REVIEWED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  pickup_floor TEXT NOT NULL
    CHECK (pickup_floor IN ('1樓', '9樓')),
  balance INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'User'
    CHECK (role IN ('User', 'ProxyAdmin', 'Admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calendar_settings (
  order_date TEXT PRIMARY KEY,
  vendor TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'A'
    CHECK (mode IN ('A', 'B')),
  updated_by_line_user_id TEXT REFERENCES users(line_user_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS likes (
  order_date TEXT NOT NULL,
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_date, line_user_id)
);

CREATE TABLE IF NOT EXISTS menu_versions (
  menu_version_id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  source_batch_id TEXT REFERENCES import_batches(batch_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (vendor, effective_date)
);

CREATE TABLE IF NOT EXISTS menu_items (
  menu_item_id TEXT PRIMARY KEY,
  menu_version_id TEXT NOT NULL REFERENCES menu_versions(menu_version_id),
  legacy_item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  source_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcements (
  announcement_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  source_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  order_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  pickup_floor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CANCELLED')),
  source_batch_id TEXT REFERENCES import_batches(batch_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  menu_item_id TEXT REFERENCES menu_items(menu_item_id),
  legacy_item_id TEXT,
  item_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  transition_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  from_status TEXT
    CHECK (from_status IS NULL OR from_status IN ('ACTIVE', 'CANCELLED')),
  to_status TEXT NOT NULL
    CHECK (to_status IN ('ACTIVE', 'CANCELLED')),
  actor_line_user_id TEXT REFERENCES users(line_user_id),
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS balance_ledger (
  transaction_id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('TOPUP', 'ORDER', 'REFUND', 'ADJUSTMENT')),
  reference_id TEXT,
  operator_line_user_id TEXT REFERENCES users(line_user_id),
  note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_batch_id TEXT REFERENCES import_batches(batch_id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  actor_line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  PRIMARY KEY (actor_line_user_id, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  audit_id TEXT PRIMARY KEY,
  actor_line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  target_line_user_id TEXT REFERENCES users(line_user_id),
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_quarantine (
  quarantine_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(batch_id),
  entity_type TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  raw_payload_json TEXT NOT NULL,
  normalized_payload_json TEXT,
  review_state TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (review_state IN ('OPEN', 'APPROVED', 'REJECTED', 'RESOLVED')),
  reviewed_by_line_user_id TEXT REFERENCES users(line_user_id),
  resolution_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_calendar_settings_updated_by
  ON calendar_settings(updated_by_line_user_id);

CREATE INDEX IF NOT EXISTS idx_likes_user_order_date
  ON likes(line_user_id, order_date);

CREATE INDEX IF NOT EXISTS idx_menu_versions_effective
  ON menu_versions(vendor, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_menu_items_version_legacy
  ON menu_items(menu_version_id, legacy_item_id);

CREATE INDEX IF NOT EXISTS idx_menu_items_customer
  ON menu_items(menu_version_id, enabled, source_order);

CREATE INDEX IF NOT EXISTS idx_announcements_active_window
  ON announcements(enabled, start_date, end_date, source_order);

CREATE INDEX IF NOT EXISTS idx_orders_actor_date_status
  ON orders(line_user_id, order_date, status, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_date_vendor_status
  ON orders(order_date, vendor, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_active_actor_date
  ON orders(line_user_id, order_date)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_order_items_menu_item
  ON order_items(menu_item_id);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_time
  ON order_status_history(order_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_balance_ledger_actor_time
  ON balance_ledger(line_user_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_balance_ledger_reference
  ON balance_ledger(reference_id, type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_ledger_unique_order_reference
  ON balance_ledger(type, reference_id)
  WHERE reference_id IS NOT NULL AND type IN ('ORDER', 'REFUND');

CREATE INDEX IF NOT EXISTS idx_idempotency_actor_operation
  ON idempotency_keys(actor_line_user_id, operation, created_at);

CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_time
  ON admin_audit_log(actor_line_user_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_import_quarantine_batch_state
  ON import_quarantine(batch_id, review_state, entity_type);
