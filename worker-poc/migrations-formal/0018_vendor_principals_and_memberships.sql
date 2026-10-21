PRAGMA foreign_keys = ON;

-- Vendor identity is a separate login principal linked to a canonical user.
-- Role is constrained here, while authorization still requires an active
-- vendor membership and an enabled canonical vendor entity.
CREATE TABLE IF NOT EXISTS vendor_principals (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE RESTRICT,
  vendor_login_id TEXT,
  principal_role TEXT NOT NULL DEFAULT 'Vendor'
    CHECK (principal_role = 'Vendor'),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (vendor_login_id IS NULL OR (
    length(trim(vendor_login_id)) > 0
    AND vendor_login_id = UPPER(trim(vendor_login_id))
  ))
);

-- The vendor login identifier is a separate namespace field. It is not a
-- users.employee_id, users.role, or canonical vendors.vendor_id value.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_principals_login_id_unique
  ON vendor_principals(UPPER(trim(vendor_login_id)))
  WHERE vendor_login_id IS NOT NULL;

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

CREATE TRIGGER IF NOT EXISTS vendor_principals_login_id_no_employee_collision_insert
BEFORE INSERT ON vendor_principals
WHEN NEW.vendor_login_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE UPPER(trim(employee_id)) = UPPER(trim(NEW.vendor_login_id))
  )
BEGIN
  SELECT RAISE(ABORT, 'VENDOR_LOGIN_ID_COLLIDES_EMPLOYEE_ID');
END;

CREATE TRIGGER IF NOT EXISTS vendor_principals_login_id_no_employee_collision_update
BEFORE UPDATE OF vendor_login_id ON vendor_principals
WHEN NEW.vendor_login_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE UPPER(trim(employee_id)) = UPPER(trim(NEW.vendor_login_id))
  )
BEGIN
  SELECT RAISE(ABORT, 'VENDOR_LOGIN_ID_COLLIDES_EMPLOYEE_ID');
END;

CREATE TRIGGER IF NOT EXISTS users_employee_id_no_vendor_login_collision_insert
BEFORE INSERT ON users
WHEN NEW.employee_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM vendor_principals
    WHERE UPPER(trim(vendor_login_id)) = UPPER(trim(NEW.employee_id))
  )
BEGIN
  SELECT RAISE(ABORT, 'VENDOR_LOGIN_ID_COLLIDES_EMPLOYEE_ID');
END;

CREATE TRIGGER IF NOT EXISTS users_employee_id_no_vendor_login_collision_update
BEFORE UPDATE OF employee_id ON users
WHEN NEW.employee_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM vendor_principals
    WHERE UPPER(trim(vendor_login_id)) = UPPER(trim(NEW.employee_id))
  )
BEGIN
  SELECT RAISE(ABORT, 'VENDOR_LOGIN_ID_COLLIDES_EMPLOYEE_ID');
END;
