-- Migration 0011: explicit legacy/normalized menu identity and deterministic
-- append-only revision ordering.
--
-- Existing rows are immutable legacy identities. The table rebuild is needed
-- because 0008's table-level UNIQUE constraint cannot represent repeated
-- same-day normalized revisions. A partial unique index retains that guard for
-- legacy rows while normalized rows use the sequence table for winner order.
CREATE TABLE menu_item_changes_v11 (
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
  identity_schema_version INTEGER NOT NULL DEFAULT 1
    CHECK (identity_schema_version IN (1, 2))
);

INSERT INTO menu_item_changes_v11 (
  menu_item_change_id, effective_date, vendor, item_code, variant_key,
  item_name, price, enabled, image_url, note, display_order,
  source_kind, source_batch_id, source_table, source_row, source_record_id,
  updated_by_user_id, created_at, updated_at, identity_schema_version
)
SELECT menu_item_change_id, effective_date, vendor, item_code, variant_key,
       item_name, price, enabled, image_url, note, display_order,
       source_kind, source_batch_id, source_table, source_row, source_record_id,
       updated_by_user_id, created_at, updated_at, 1
FROM menu_item_changes
ORDER BY rowid;

DROP TRIGGER IF EXISTS menu_item_changes_append_only_update_guard;
DROP TRIGGER IF EXISTS menu_item_changes_append_only_delete_guard;
DROP INDEX IF EXISTS idx_menu_item_changes_effective;
DROP INDEX IF EXISTS idx_menu_item_changes_identity;
DROP TABLE menu_item_changes;
ALTER TABLE menu_item_changes_v11 RENAME TO menu_item_changes;

CREATE INDEX idx_menu_item_changes_effective
  ON menu_item_changes(vendor, effective_date, display_order, menu_item_change_id);

CREATE INDEX idx_menu_item_changes_identity
  ON menu_item_changes(vendor, item_code, variant_key, effective_date DESC);

CREATE UNIQUE INDEX idx_menu_item_changes_legacy_identity_unique
  ON menu_item_changes(vendor, item_code, variant_key, effective_date)
  WHERE identity_schema_version = 1;

CREATE TABLE menu_item_change_sequence (
  sequence_number INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_change_id TEXT NOT NULL UNIQUE
    REFERENCES menu_item_changes(menu_item_change_id)
);

-- This is the one-time migration backfill. Runtime ordering must use this
-- persisted sequence, never the source table's implicit rowid.
INSERT INTO menu_item_change_sequence (menu_item_change_id)
SELECT menu_item_change_id
FROM menu_item_changes
ORDER BY rowid;

CREATE INDEX idx_menu_item_change_sequence_id
  ON menu_item_change_sequence(menu_item_change_id);

CREATE TRIGGER menu_item_changes_sequence_after_insert
AFTER INSERT ON menu_item_changes
BEGIN
  INSERT INTO menu_item_change_sequence (menu_item_change_id)
  VALUES (NEW.menu_item_change_id);
END;

CREATE TRIGGER menu_item_changes_append_only_update_guard
BEFORE UPDATE ON menu_item_changes
BEGIN
  SELECT RAISE(ABORT, 'menu_item_changes are append-only');
END;

CREATE TRIGGER menu_item_changes_append_only_delete_guard
BEFORE DELETE ON menu_item_changes
BEGIN
  SELECT RAISE(ABORT, 'menu_item_changes are append-only');
END;

CREATE TRIGGER menu_item_change_sequence_append_only_update_guard
BEFORE UPDATE ON menu_item_change_sequence
BEGIN
  SELECT RAISE(ABORT, 'menu_item_change_sequence is append-only');
END;

CREATE TRIGGER menu_item_change_sequence_append_only_delete_guard
BEFORE DELETE ON menu_item_change_sequence
BEGIN
  SELECT RAISE(ABORT, 'menu_item_change_sequence is append-only');
END;
