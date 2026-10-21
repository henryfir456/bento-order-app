PRAGMA foreign_keys = ON;

-- Forward-only compatibility for environments that already applied the first
-- 0019 revision. Drop only the name/alias-driven behavior; do not rewrite orders.
DROP TRIGGER IF EXISTS orders_vendor_id_insert_guard;
DROP TRIGGER IF EXISTS orders_vendor_id_update_guard;
DROP TRIGGER IF EXISTS orders_vendor_identity_after_insert;
DROP TRIGGER IF EXISTS orders_vendor_identity_after_update;

CREATE TABLE IF NOT EXISTS vendor_menu_version_mapping_events (
  event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  menu_version_id TEXT NOT NULL REFERENCES menu_versions(menu_version_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  vendor_id TEXT REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  effective_date TEXT NOT NULL CHECK (effective_date GLOB '????-??-??'),
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('VERIFIED', 'REVOKED')),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind = 'MENU_VERSION_ID_EFFECTIVE_DATE'),
  reviewed_by_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TEXT NOT NULL,
  UNIQUE (menu_version_id, revision),
  CHECK ((mapping_status = 'VERIFIED' AND vendor_id IS NOT NULL)
    OR (mapping_status = 'REVOKED' AND vendor_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_vendor_menu_version_mapping_latest
  ON vendor_menu_version_mapping_events(menu_version_id, revision DESC);

CREATE TRIGGER IF NOT EXISTS vendor_menu_version_mapping_insert_guard
BEFORE INSERT ON vendor_menu_version_mapping_events
WHEN NOT EXISTS (
  SELECT 1 FROM menu_versions mv
  WHERE mv.menu_version_id = NEW.menu_version_id
    AND mv.effective_date = NEW.effective_date
) OR NEW.revision <> COALESCE((
  SELECT MAX(previous.revision) + 1
  FROM vendor_menu_version_mapping_events previous
  WHERE previous.menu_version_id = NEW.menu_version_id
), 1) OR NOT EXISTS (
  SELECT 1 FROM users reviewer
  WHERE reviewer.user_id = NEW.reviewed_by_user_id
    AND reviewer.role = 'Admin' AND reviewer.active = 1
)
BEGIN SELECT RAISE(ABORT, 'VENDOR_MENU_VERSION_MAPPING_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS vendor_menu_version_mapping_immutable_update
BEFORE UPDATE ON vendor_menu_version_mapping_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_MENU_VERSION_MAPPING_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_menu_version_mapping_immutable_delete
BEFORE DELETE ON vendor_menu_version_mapping_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_MENU_VERSION_MAPPING_APPEND_ONLY'); END;

CREATE TABLE IF NOT EXISTS canonical_order_vendor_assignments (
  order_id TEXT PRIMARY KEY REFERENCES orders(order_id) ON DELETE RESTRICT,
  vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_order_vendor_assignments_vendor_date
  ON canonical_order_vendor_assignments(vendor_id, assigned_at, order_id);

CREATE TRIGGER IF NOT EXISTS canonical_order_vendor_assignment_insert_guard
BEFORE INSERT ON canonical_order_vendor_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM orders o
  WHERE o.order_id = NEW.order_id
    AND o.vendor_id = NEW.vendor_id
    AND o.created_at = NEW.assigned_at
)
BEGIN SELECT RAISE(ABORT, 'CANONICAL_ORDER_VENDOR_ASSIGNMENT_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS canonical_order_vendor_assignment_after_insert
AFTER INSERT ON orders
WHEN NEW.vendor_id IS NOT NULL
BEGIN
  INSERT INTO canonical_order_vendor_assignments (order_id, vendor_id, assigned_at)
  VALUES (NEW.order_id, NEW.vendor_id, NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS canonical_order_vendor_assignment_immutable_update
BEFORE UPDATE ON canonical_order_vendor_assignments
BEGIN SELECT RAISE(ABORT, 'CANONICAL_ORDER_VENDOR_ASSIGNMENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS canonical_order_vendor_assignment_immutable_delete
BEFORE DELETE ON canonical_order_vendor_assignments
BEGIN SELECT RAISE(ABORT, 'CANONICAL_ORDER_VENDOR_ASSIGNMENT_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS orders_vendor_id_immutable_update
BEFORE UPDATE OF vendor_id ON orders
WHEN NEW.vendor_id IS NOT OLD.vendor_id
BEGIN SELECT RAISE(ABORT, 'ORDER_VENDOR_ID_IMMUTABLE'); END;

CREATE VIEW IF NOT EXISTS vendor_order_vendor_attributions AS
WITH latest_mappings AS (
  SELECT mapping.menu_version_id, mapping.vendor_id, mapping.effective_date
  FROM vendor_menu_version_mapping_events mapping
  WHERE mapping.revision = (
    SELECT MAX(latest.revision)
    FROM vendor_menu_version_mapping_events latest
    WHERE latest.menu_version_id = mapping.menu_version_id
  )
    AND mapping.mapping_status = 'VERIFIED'
), resolved_items AS (
  SELECT o.order_id, mapping.vendor_id
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  JOIN menu_items mi ON mi.menu_item_id = oi.menu_item_id
  JOIN menu_versions mv ON mv.menu_version_id = mi.menu_version_id
  JOIN latest_mappings mapping ON mapping.menu_version_id = mv.menu_version_id
  WHERE mapping.effective_date = mv.effective_date
    AND mapping.effective_date <= o.order_date
    AND (oi.legacy_item_id IS NULL OR oi.legacy_item_id = mi.legacy_item_id)
    AND NOT EXISTS (
      SELECT 1 FROM canonical_order_vendor_assignments direct
      WHERE direct.order_id = o.order_id
    )
), resolved_legacy_orders AS (
  SELECT resolved.order_id, MIN(resolved.vendor_id) AS vendor_id
  FROM resolved_items resolved
  GROUP BY resolved.order_id
  HAVING COUNT(*) = (
    SELECT COUNT(*) FROM order_items all_items
    WHERE all_items.order_id = resolved.order_id
  )
    AND MIN(resolved.vendor_id) = MAX(resolved.vendor_id)
)
SELECT direct.order_id, direct.vendor_id
FROM canonical_order_vendor_assignments direct
UNION ALL
SELECT historical.order_id, historical.vendor_id
FROM resolved_legacy_orders historical;

-- Rebuild settlement capacity checks to include explicitly resolved historical
-- orders while keeping unresolved rows outside every Vendor's receivable.
DROP TRIGGER IF EXISTS vendor_transfer_allocations_day_receivable;
CREATE TRIGGER vendor_transfer_allocations_day_receivable
BEFORE INSERT ON vendor_transfer_allocations
WHEN NEW.amount_twd + COALESCE((
  SELECT SUM(a.amount_twd + COALESCE((
    SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
    WHERE e.allocation_id = a.allocation_id
  ), 0))
  FROM vendor_transfer_allocations a
  WHERE a.vendor_id = NEW.vendor_id AND a.service_date = NEW.service_date
), 0) > COALESCE((
  SELECT s.amount_twd FROM vendor_day_snapshots s
  WHERE s.vendor_id = NEW.vendor_id AND s.service_date = NEW.service_date
  ORDER BY s.revision DESC LIMIT 1
), COALESCE((
  SELECT SUM(oi.subtotal)
  FROM vendor_order_vendor_attributions attribution
  JOIN orders o ON o.order_id = attribution.order_id
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE attribution.vendor_id = NEW.vendor_id
    AND o.order_date = NEW.service_date
    AND o.status = 'ACTIVE'
), -1))
BEGIN SELECT RAISE(ABORT, 'VENDOR_DAY_RECEIVABLE_EXCEEDED'); END;

DROP TRIGGER IF EXISTS vendor_transfer_allocation_events_capacity;
CREATE TRIGGER vendor_transfer_allocation_events_capacity
BEFORE INSERT ON vendor_transfer_allocation_events
WHEN NOT EXISTS (
  SELECT 1
  FROM vendor_transfer_allocations a
  JOIN vendor_transfer_payments p ON p.payment_id = a.payment_id AND p.vendor_id = a.vendor_id
  WHERE a.allocation_id = NEW.allocation_id
    AND NOT EXISTS (
      SELECT 1 FROM vendor_payment_events e
      WHERE e.payment_id = p.payment_id AND e.event_type = 'REVERSED'
    )
    AND a.amount_twd + COALESCE((
      SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
      WHERE e.allocation_id = a.allocation_id
    ), 0) + NEW.delta_twd >= 0
    AND COALESCE((
      SELECT SUM(other.amount_twd + COALESCE((
        SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
        WHERE e.allocation_id = other.allocation_id
      ), 0))
      FROM vendor_transfer_allocations other WHERE other.payment_id = p.payment_id
    ), 0) + NEW.delta_twd <= p.amount_twd
    AND COALESCE((
      SELECT SUM(other.amount_twd + COALESCE((
        SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
        WHERE e.allocation_id = other.allocation_id
      ), 0))
      FROM vendor_transfer_allocations other
      WHERE other.vendor_id = a.vendor_id AND other.service_date = a.service_date
    ), 0) + NEW.delta_twd <= COALESCE((
      SELECT s.amount_twd FROM vendor_day_snapshots s
      WHERE s.vendor_id = a.vendor_id AND s.service_date = a.service_date
      ORDER BY s.revision DESC LIMIT 1
    ), COALESCE((
      SELECT SUM(oi.subtotal)
      FROM vendor_order_vendor_attributions attribution
      JOIN orders o ON o.order_id = attribution.order_id
      JOIN order_items oi ON oi.order_id = o.order_id
      WHERE attribution.vendor_id = a.vendor_id
        AND o.order_date = a.service_date
        AND o.status = 'ACTIVE'
    ), -1))
)
BEGIN SELECT RAISE(ABORT, 'VENDOR_ALLOCATION_ADJUSTMENT_INVALID'); END;
