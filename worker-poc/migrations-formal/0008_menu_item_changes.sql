-- Migration 0008: append-only authoritative menu item change history.
--
-- A change row is a complete state for one vendor/item/variant identity at an
-- effective date.  Corrections are later rows; persisted rows are immutable.
-- This table is deliberately independent from menu snapshots and orders.
CREATE TABLE IF NOT EXISTS menu_item_changes (
  menu_item_change_id TEXT PRIMARY KEY,
  effective_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  item_code TEXT NOT NULL,
  variant_key TEXT NOT NULL DEFAULT '',
  item_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  image_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('legacy_sql', 'gas_compatibility', 'admin')),
  source_batch_id TEXT REFERENCES import_batches(batch_id),
  source_table TEXT,
  source_row INTEGER,
  source_record_id TEXT,
  updated_by_user_id TEXT REFERENCES users(user_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (vendor, item_code, variant_key, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_menu_item_changes_effective
  ON menu_item_changes(vendor, effective_date, display_order, menu_item_change_id);

CREATE INDEX IF NOT EXISTS idx_menu_item_changes_identity
  ON menu_item_changes(vendor, item_code, variant_key, effective_date DESC);

CREATE TRIGGER IF NOT EXISTS menu_item_changes_append_only_update_guard
BEFORE UPDATE ON menu_item_changes
BEGIN
  SELECT RAISE(ABORT, 'menu_item_changes are append-only');
END;

CREATE TRIGGER IF NOT EXISTS menu_item_changes_append_only_delete_guard
BEFORE DELETE ON menu_item_changes
BEGIN
  SELECT RAISE(ABORT, 'menu_item_changes are append-only');
END;

-- Compatibility projections need to retain the exact identity of ambiguous
-- codes such as AP. Existing rows receive the safe unqualified default and
-- are not rewritten or re-keyed.
ALTER TABLE menu_items ADD COLUMN variant_key TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_menu_items_version_identity
  ON menu_items(menu_version_id, legacy_item_id, variant_key);
