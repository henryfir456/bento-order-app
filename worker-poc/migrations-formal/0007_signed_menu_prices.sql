-- Migration 0007: menu prices are signed integer business values.
--
-- SQLite rewrites REFERENCES to a renamed table. Rebuild order_items along
-- with menu_items so its menu-item FK continues to point at the live table.
-- The 0006 order-item guards are recreated below because their owner table is
-- rebuilt as part of this dependency-safe operation.
PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_menu_items_version_legacy;
DROP INDEX IF EXISTS idx_menu_items_customer;
DROP INDEX IF EXISTS idx_order_items_menu_item;
DROP TRIGGER IF EXISTS orders_historical_negative_money_context_guard;

ALTER TABLE order_items RENAME TO order_items_legacy;
ALTER TABLE menu_items RENAME TO menu_items_legacy;

CREATE TABLE menu_items (
  menu_item_id TEXT PRIMARY KEY,
  menu_version_id TEXT NOT NULL REFERENCES menu_versions(menu_version_id),
  legacy_item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  source_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

INSERT INTO menu_items (
  menu_item_id, menu_version_id, legacy_item_id, item_name, price, enabled,
  note, image_url, source_order, created_at, updated_at
)
SELECT
  menu_item_id, menu_version_id, legacy_item_id, item_name, price, enabled,
  note, image_url, source_order, created_at, updated_at
FROM menu_items_legacy;

INSERT INTO order_items (
  order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
  quantity, unit_price, subtotal
)
SELECT
  order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
  quantity, unit_price, subtotal
FROM order_items_legacy;

DROP TABLE order_items_legacy;
DROP TABLE menu_items_legacy;

CREATE INDEX idx_menu_items_version_legacy
  ON menu_items(menu_version_id, legacy_item_id);

CREATE INDEX idx_menu_items_customer
  ON menu_items(menu_version_id, enabled, source_order);

CREATE INDEX idx_order_items_menu_item
  ON order_items(menu_item_id);

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
