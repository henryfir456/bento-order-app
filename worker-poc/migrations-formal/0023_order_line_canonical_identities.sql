PRAGMA foreign_keys = ON;

-- Reviewed canonical identity of individual stored order lines. Old orders keep
-- their snapshot (code, name, price) untouched; this append-only overlay records
-- which vendor and normalized menu item (item code + variant) each line really
-- is, or that it is a non-meal adjustment. The latest revision per line wins.
CREATE TABLE IF NOT EXISTS order_line_canonical_identities (
  identity_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  line_kind TEXT NOT NULL CHECK (line_kind IN ('MEAL', 'ADJUSTMENT')),
  vendor_id TEXT REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  item_code TEXT,
  variant_key TEXT CHECK (variant_key IS NULL OR variant_key IN ('BASE', 'HALF', 'PLUS')),
  basis TEXT NOT NULL CHECK (length(trim(basis)) > 0),
  reviewed_by_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TEXT NOT NULL,
  UNIQUE (order_id, line_no, revision),
  FOREIGN KEY (order_id, line_no) REFERENCES order_items(order_id, line_no) ON DELETE RESTRICT,
  CHECK ((line_kind = 'MEAL' AND vendor_id IS NOT NULL
      AND length(trim(COALESCE(item_code, ''))) > 0 AND variant_key IS NOT NULL)
    OR (line_kind = 'ADJUSTMENT' AND vendor_id IS NULL AND item_code IS NULL AND variant_key IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_order_line_canonical_identities_latest
  ON order_line_canonical_identities(order_id, line_no, revision DESC);

CREATE TRIGGER IF NOT EXISTS order_line_canonical_identity_insert_guard
BEFORE INSERT ON order_line_canonical_identities
WHEN NEW.revision <> COALESCE((
  SELECT MAX(previous.revision) + 1
  FROM order_line_canonical_identities previous
  WHERE previous.order_id = NEW.order_id AND previous.line_no = NEW.line_no
), 1) OR NOT EXISTS (
  SELECT 1 FROM users reviewer
  WHERE reviewer.user_id = NEW.reviewed_by_user_id
    AND reviewer.role = 'Admin' AND reviewer.active = 1
)
BEGIN SELECT RAISE(ABORT, 'ORDER_LINE_CANONICAL_IDENTITY_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS order_line_canonical_identity_immutable_update
BEFORE UPDATE ON order_line_canonical_identities
BEGIN SELECT RAISE(ABORT, 'ORDER_LINE_CANONICAL_IDENTITY_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS order_line_canonical_identity_immutable_delete
BEFORE DELETE ON order_line_canonical_identities
BEGIN SELECT RAISE(ABORT, 'ORDER_LINE_CANONICAL_IDENTITY_APPEND_ONLY'); END;

CREATE VIEW IF NOT EXISTS order_line_current_identities AS
SELECT identity.order_id, identity.line_no, identity.line_kind, identity.vendor_id,
  identity.item_code, identity.variant_key, identity.basis
FROM order_line_canonical_identities identity
WHERE identity.revision = (
  SELECT MAX(latest.revision) FROM order_line_canonical_identities latest
  WHERE latest.order_id = identity.order_id AND latest.line_no = identity.line_no
);

-- Same attributions as migration 0022, plus orders whose every line has a
-- reviewed canonical identity. A direct assignment still wins; otherwise the
-- reviewed lines win over menu-version and shop-name attribution. Such an order
-- belongs to a vendor only when all of its MEAL lines agree on one vendor.
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
), reviewed_lines AS (
  SELECT o.order_id, MIN(line.vendor_id) AS vendor_id
  FROM orders o
  JOIN order_line_current_identities line ON line.order_id = o.order_id
  WHERE line.line_kind = 'MEAL'
    AND NOT EXISTS (
      SELECT 1 FROM canonical_order_vendor_assignments direct
      WHERE direct.order_id = o.order_id
    )
  GROUP BY o.order_id
  HAVING MIN(line.vendor_id) = MAX(line.vendor_id)
    AND (SELECT COUNT(*) FROM order_items all_items WHERE all_items.order_id = o.order_id)
      = (SELECT COUNT(*) FROM order_line_current_identities covered WHERE covered.order_id = o.order_id)
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
SELECT reviewed.order_id, reviewed.vendor_id
FROM reviewed_lines reviewed
UNION ALL
SELECT historical.order_id, historical.vendor_id
FROM resolved_legacy_orders historical
WHERE NOT EXISTS (SELECT 1 FROM reviewed_lines reviewed WHERE reviewed.order_id = historical.order_id)
UNION ALL
SELECT named.order_id, named.vendor_id
FROM name_legacy_orders named
WHERE NOT EXISTS (SELECT 1 FROM reviewed_lines reviewed WHERE reviewed.order_id = named.order_id);
