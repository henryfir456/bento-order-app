PRAGMA foreign_keys = ON;

-- Reading vendor_order_vendor_attributions recomputed every legacy attribution
-- over the whole orders table on each query (~25k D1 rows read per vendor
-- calendar load), which exhausted the daily D1 read quota. The full computation
-- is kept as vendor_order_vendor_attributions_live; the name the application
-- reads is now a direct-assignment arm plus a cache of the legacy arms.
-- The cache is rebuilt lazily by the Worker whenever a reviewed mapping or
-- identity row is inserted (the triggers below bump source_version).
-- Same attributions as migration 0023, defined as the live view:
CREATE VIEW vendor_order_vendor_attributions_live AS
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

CREATE TABLE IF NOT EXISTS vendor_legacy_attribution_cache (
  order_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  order_date TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_legacy_attribution_cache_vendor
  ON vendor_legacy_attribution_cache(vendor_id, order_date, order_id);

CREATE TABLE IF NOT EXISTS vendor_attribution_cache_state (
  state_id INTEGER PRIMARY KEY CHECK (state_id = 1),
  source_version INTEGER NOT NULL,
  built_version INTEGER NOT NULL,
  built_at TEXT
);

INSERT OR IGNORE INTO vendor_legacy_attribution_cache (order_id, vendor_id, order_date)
SELECT live.order_id, live.vendor_id, o.order_date
FROM vendor_order_vendor_attributions_live live
JOIN orders o ON o.order_id = live.order_id
WHERE NOT EXISTS (
  SELECT 1 FROM canonical_order_vendor_assignments direct
  WHERE direct.order_id = live.order_id
);

INSERT OR IGNORE INTO vendor_attribution_cache_state (state_id, source_version, built_version, built_at)
VALUES (1, 1, 1, CURRENT_TIMESTAMP);

CREATE TRIGGER IF NOT EXISTS vendor_attribution_cache_stale_menu_mapping
AFTER INSERT ON vendor_menu_version_mapping_events
BEGIN UPDATE vendor_attribution_cache_state SET source_version = source_version + 1 WHERE state_id = 1; END;
CREATE TRIGGER IF NOT EXISTS vendor_attribution_cache_stale_name_mapping
AFTER INSERT ON vendor_legacy_name_mapping_events
BEGIN UPDATE vendor_attribution_cache_state SET source_version = source_version + 1 WHERE state_id = 1; END;
CREATE TRIGGER IF NOT EXISTS vendor_attribution_cache_stale_line_identity
AFTER INSERT ON order_line_canonical_identities
BEGIN UPDATE vendor_attribution_cache_state SET source_version = source_version + 1 WHERE state_id = 1; END;

DROP VIEW IF EXISTS vendor_order_vendor_attributions;
CREATE VIEW vendor_order_vendor_attributions AS
SELECT direct.order_id, direct.vendor_id, o.order_date
FROM canonical_order_vendor_assignments direct
JOIN orders o ON o.order_id = direct.order_id
UNION ALL
SELECT cached.order_id, cached.vendor_id, cached.order_date
FROM vendor_legacy_attribution_cache cached
WHERE NOT EXISTS (
  SELECT 1 FROM canonical_order_vendor_assignments direct
  WHERE direct.order_id = cached.order_id
);
