-- Trusted employee verification source. This migration intentionally creates
-- no rows; remote import remains a separately reviewed operation.
CREATE TABLE IF NOT EXISTS employee_roster (
  roster_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL CHECK (length(trim(employee_id)) > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  provenance TEXT NOT NULL CHECK (provenance IN ('TRUSTED_IMPORT', 'ADMIN_APPROVED')),
  source_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Do not make employee_id unique: duplicate rows must remain representable so
-- auto-verification fails closed on ambiguity. Canonical users retain their
-- existing partial unique employee_id index plus a normalized ownership index.
CREATE INDEX IF NOT EXISTS idx_employee_roster_employee_id
  ON employee_roster(employee_id);

-- Imported IDs are textual and case-sensitive in their source contract, but
-- identity ownership is case-insensitive after trim/case normalization. A
-- pre-existing case-variant collision must make migration fail closed.
CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_normalized_unique
  ON users(UPPER(trim(employee_id)))
  WHERE employee_id IS NOT NULL AND length(trim(employee_id)) > 0;
