PRAGMA foreign_keys = ON;

-- Vendor identity is a separate login principal linked to a canonical user.
-- Role is constrained here, while authorization still requires an active
-- vendor membership and an enabled canonical vendor entity.
CREATE TABLE IF NOT EXISTS vendor_principals (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE RESTRICT,
  principal_role TEXT NOT NULL DEFAULT 'Vendor'
    CHECK (principal_role = 'Vendor'),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendor_memberships (
  user_id TEXT NOT NULL REFERENCES vendor_principals(user_id) ON DELETE RESTRICT,
  vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_memberships_vendor_status
  ON vendor_memberships(vendor_id, status, user_id);

CREATE TRIGGER IF NOT EXISTS vendor_principals_require_user_role_insert
BEFORE INSERT ON vendor_principals
WHEN EXISTS (
  SELECT 1 FROM users
  WHERE user_id = NEW.user_id AND role <> 'User'
)
BEGIN
  SELECT RAISE(ABORT, 'VENDOR_PRINCIPAL_REQUIRES_USER');
END;

CREATE TRIGGER IF NOT EXISTS vendor_principals_prevent_privileged_user_role_update
BEFORE UPDATE OF role ON users
WHEN NEW.role <> 'User' AND EXISTS (
  SELECT 1 FROM vendor_principals
  WHERE user_id = NEW.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'VENDOR_PRINCIPAL_REQUIRES_USER');
END;
