PRAGMA foreign_keys = ON;

-- Reviewed shop-name attribution for orders placed before canonical vendor IDs
-- existed. An Admin confirms that legacy orders recorded under a shop name
-- (orders.vendor) before a date belong to one vendor, so a whole legacy order
-- is attributed even when some of its lines have no verified menu identity.
-- Events are append-only; the latest revision per shop name wins.
CREATE TABLE IF NOT EXISTS vendor_legacy_name_mapping_events (
  event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  vendor_name TEXT NOT NULL CHECK (length(trim(vendor_name)) > 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  vendor_id TEXT REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  before_date TEXT NOT NULL CHECK (before_date GLOB '????-??-??'),
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('VERIFIED', 'REVOKED')),
  reviewed_by_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TEXT NOT NULL,
  UNIQUE (vendor_name, revision),
  CHECK ((mapping_status = 'VERIFIED' AND vendor_id IS NOT NULL)
    OR (mapping_status = 'REVOKED' AND vendor_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_vendor_legacy_name_mapping_latest
  ON vendor_legacy_name_mapping_events(vendor_name, revision DESC);

CREATE TRIGGER IF NOT EXISTS vendor_legacy_name_mapping_insert_guard
BEFORE INSERT ON vendor_legacy_name_mapping_events
WHEN NEW.revision <> COALESCE((
  SELECT MAX(previous.revision) + 1
  FROM vendor_legacy_name_mapping_events previous
  WHERE previous.vendor_name = NEW.vendor_name
), 1) OR NOT EXISTS (
  SELECT 1 FROM users reviewer
  WHERE reviewer.user_id = NEW.reviewed_by_user_id
    AND reviewer.role = 'Admin' AND reviewer.active = 1
)
BEGIN SELECT RAISE(ABORT, 'VENDOR_LEGACY_NAME_MAPPING_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS vendor_legacy_name_mapping_immutable_update
BEFORE UPDATE ON vendor_legacy_name_mapping_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_LEGACY_NAME_MAPPING_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_legacy_name_mapping_immutable_delete
BEFORE DELETE ON vendor_legacy_name_mapping_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_LEGACY_NAME_MAPPING_APPEND_ONLY'); END;

-- Same attributions as migration 0020, plus legacy orders matched by a
-- reviewed shop name. Direct assignments and menu-identity attributions keep
-- precedence; an order with any line verified for a different vendor is
-- never attributed by name.
DROP VIEW IF EXISTS vendor_order_vendor_attributions;
CREATE VIEW vendor_order_vendor_attributions AS
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
), latest_name_mappings AS (
  SELECT mapping.vendor_name, mapping.vendor_id, mapping.before_date
  FROM vendor_legacy_name_mapping_events mapping
  WHERE mapping.revision = (
    SELECT MAX(latest.revision)
    FROM vendor_legacy_name_mapping_events latest
    WHERE latest.vendor_name = mapping.vendor_name
  )
    AND mapping.mapping_status = 'VERIFIED'
), name_legacy_orders AS (
  SELECT o.order_id, mapping.vendor_id
  FROM orders o
  JOIN latest_name_mappings mapping ON mapping.vendor_name = trim(o.vendor)
  WHERE o.order_date < mapping.before_date
    AND NOT EXISTS (
      SELECT 1 FROM canonical_order_vendor_assignments direct
      WHERE direct.order_id = o.order_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM resolved_legacy_orders resolved
      WHERE resolved.order_id = o.order_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM resolved_items other
      WHERE other.order_id = o.order_id AND other.vendor_id <> mapping.vendor_id
    )
)
SELECT direct.order_id, direct.vendor_id
FROM canonical_order_vendor_assignments direct
UNION ALL
SELECT historical.order_id, historical.vendor_id
FROM resolved_legacy_orders historical
UNION ALL
SELECT named.order_id, named.vendor_id
FROM name_legacy_orders named;
