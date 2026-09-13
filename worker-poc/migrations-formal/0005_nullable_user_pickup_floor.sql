-- Local policy-gate migration only. Applying this to formal D1 requires a
-- separate approved remote schema/write gate.
--
-- Canonical identity may exist before the operational pickup-floor profile is
-- complete. Keep the operational domain strict for non-null values and do not
-- introduce a sentinel floor.
PRAGMA foreign_keys = OFF;

CREATE TABLE users_profile_policy_new (
  user_id TEXT PRIMARY KEY,
  employee_id TEXT,
  line_user_id TEXT,
  display_name TEXT NOT NULL,
  pickup_floor TEXT
    CHECK (pickup_floor IS NULL OR pickup_floor IN ('1樓', '9樓')),
  balance INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'User'
    CHECK (role IN ('User', 'ProxyAdmin', 'Admin')),
  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verification_status TEXT NOT NULL DEFAULT 'VERIFIED'
    CHECK (verification_status IN ('VERIFIED', 'UNVERIFIED'))
);

INSERT INTO users_profile_policy_new (
  user_id, employee_id, line_user_id, display_name, pickup_floor,
  balance, role, active, created_at, updated_at, verification_status
)
SELECT user_id, employee_id, line_user_id, display_name, pickup_floor,
       balance, role, active, created_at, updated_at, verification_status
FROM users;

DROP TABLE users;
ALTER TABLE users_profile_policy_new RENAME TO users;

CREATE UNIQUE INDEX users_employee_id_unique
  ON users(employee_id)
  WHERE employee_id IS NOT NULL AND length(trim(employee_id)) > 0;

CREATE UNIQUE INDEX users_line_user_id_unique
  ON users(line_user_id)
  WHERE line_user_id IS NOT NULL AND length(trim(line_user_id)) > 0;

CREATE UNIQUE INDEX users_employee_id_normalized_unique
  ON users(UPPER(trim(employee_id)))
  WHERE employee_id IS NOT NULL AND length(trim(employee_id)) > 0;

PRAGMA foreign_keys = ON;
