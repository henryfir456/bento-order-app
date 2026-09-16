PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  menu_source_url TEXT NOT NULL DEFAULT '',
  menu_image_url TEXT NOT NULL DEFAULT '',
  menu_updated_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vendors_enabled_name
  ON vendors(enabled DESC, name ASC);

INSERT OR IGNORE INTO vendors (vendor_id, name)
SELECT
  'vendor_' || lower(hex(source.vendor)),
  source.vendor
FROM (
  SELECT CASE WHEN trim(vendor) = '合十' THEN '禾拾' ELSE trim(vendor) END AS vendor
  FROM menu_versions
  UNION
  SELECT CASE WHEN trim(vendor) = '合十' THEN '禾拾' ELSE trim(vendor) END AS vendor
  FROM calendar_settings
) AS source
WHERE length(source.vendor) > 0;
