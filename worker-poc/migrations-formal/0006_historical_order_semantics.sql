PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_orders_actor_date_status;
DROP INDEX IF EXISTS idx_orders_date_vendor_status;
DROP INDEX IF EXISTS idx_orders_one_active_actor_date;
DROP INDEX IF EXISTS idx_order_items_menu_item;
DROP INDEX IF EXISTS idx_order_status_history_order_time;

ALTER TABLE orders RENAME TO orders_legacy;
ALTER TABLE order_items RENAME TO order_items_legacy;
ALTER TABLE order_status_history RENAME TO order_status_history_legacy;

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  employee_id_snapshot TEXT,
  line_user_id_snapshot TEXT,
  display_name_snapshot TEXT NOT NULL,
  order_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  pickup_floor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CANCELLED', 'COMPLETED')),
  created_by_user_id TEXT NOT NULL REFERENCES users(user_id),
  created_auth_mode TEXT NOT NULL DEFAULT 'line'
    CHECK (created_auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  cancelled_by_user_id TEXT REFERENCES users(user_id),
  cancelled_auth_mode TEXT
    CHECK (cancelled_auth_mode IS NULL OR cancelled_auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  source_batch_id TEXT REFERENCES import_batches(batch_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO orders (
  order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, order_date, vendor, pickup_floor, note,
  total_amount, status, created_by_user_id, created_auth_mode,
  cancelled_by_user_id, cancelled_auth_mode, source_batch_id,
  created_at, updated_at
)
SELECT
  order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, order_date, vendor, pickup_floor, note,
  total_amount, status, created_by_user_id, created_auth_mode,
  cancelled_by_user_id, cancelled_auth_mode, source_batch_id,
  created_at, updated_at
FROM orders_legacy;

CREATE TABLE order_items (
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  menu_item_id TEXT REFERENCES menu_items(menu_item_id),
  legacy_item_id TEXT,
  item_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  PRIMARY KEY (order_id, line_no)
);

INSERT INTO order_items (
  order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
  quantity, unit_price, subtotal
)
SELECT
  order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
  quantity, unit_price, subtotal
FROM order_items_legacy;

CREATE TABLE order_status_history (
  transition_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  from_status TEXT
    CHECK (from_status IS NULL OR from_status IN ('ACTIVE', 'CANCELLED', 'COMPLETED')),
  to_status TEXT NOT NULL
    CHECK (to_status IN ('ACTIVE', 'CANCELLED', 'COMPLETED')),
  actor_user_id TEXT REFERENCES users(user_id),
  actor_auth_mode TEXT NOT NULL DEFAULT 'legacy_import'
    CHECK (actor_auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  employee_id_snapshot TEXT,
  line_user_id_snapshot TEXT,
  display_name_snapshot TEXT,
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO order_status_history (
  transition_id, order_id, from_status, to_status, actor_user_id,
  actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, reason, metadata_json, occurred_at
)
SELECT
  transition_id, order_id, from_status, to_status, actor_user_id,
  actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, reason, metadata_json, occurred_at
FROM order_status_history_legacy;

DROP TABLE order_items_legacy;
DROP TABLE order_status_history_legacy;
DROP TABLE orders_legacy;

CREATE INDEX idx_orders_actor_date_status
  ON orders(user_id, order_date, status, created_at);

CREATE INDEX idx_orders_date_vendor_status
  ON orders(order_date, vendor, status);

CREATE UNIQUE INDEX idx_orders_one_active_actor_date
  ON orders(user_id, order_date)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_order_items_menu_item
  ON order_items(menu_item_id);

CREATE INDEX idx_order_status_history_order_time
  ON order_status_history(order_id, occurred_at);

CREATE TRIGGER order_items_historical_negative_money_guard
BEFORE INSERT ON order_items
WHEN (NEW.unit_price < 0 OR NEW.subtotal < 0)
  AND NOT EXISTS (
    SELECT 1
    FROM orders
    WHERE order_id = NEW.order_id
      AND created_auth_mode = 'legacy_import'
      AND status = 'COMPLETED'
  )
BEGIN
  SELECT RAISE(ABORT, 'negative order item money requires a completed legacy import');
END;

CREATE TRIGGER order_items_historical_negative_money_update_guard
BEFORE UPDATE OF order_id, unit_price, subtotal ON order_items
WHEN (NEW.unit_price < 0 OR NEW.subtotal < 0)
  AND NOT EXISTS (
    SELECT 1
    FROM orders
    WHERE order_id = NEW.order_id
      AND created_auth_mode = 'legacy_import'
      AND status = 'COMPLETED'
  )
BEGIN
  SELECT RAISE(ABORT, 'negative order item money requires a completed legacy import');
END;

CREATE TRIGGER orders_historical_negative_money_context_guard
BEFORE UPDATE OF created_auth_mode, status ON orders
WHEN (NEW.created_auth_mode <> 'legacy_import' OR NEW.status <> 'COMPLETED')
  AND EXISTS (
    SELECT 1
    FROM order_items
    WHERE order_id = NEW.order_id
      AND (unit_price < 0 OR subtotal < 0)
  )
BEGIN
  SELECT RAISE(ABORT, 'negative order item money requires a completed legacy import');
END;

PRAGMA foreign_keys = ON;
