PRAGMA foreign_keys = OFF;

ALTER TABLE users
  ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'VERIFIED'
    CHECK (verification_status IN ('VERIFIED', 'UNVERIFIED'));

DROP INDEX IF EXISTS idx_employee_guest_sessions_user_state;
ALTER TABLE employee_guest_sessions RENAME TO employee_guest_sessions_legacy;

CREATE TABLE employee_guest_sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(user_id),
  employee_id TEXT,
  auth_mode TEXT NOT NULL DEFAULT 'employee_guest'
    CHECK (auth_mode = 'employee_guest'),
  status TEXT NOT NULL DEFAULT 'VERIFIED'
    CHECK (status IN ('VERIFIED', 'UNVERIFIED_EMPLOYEE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT
    CHECK (revoked_reason IS NULL OR revoked_reason IN ('line_bound', 'admin_revoke'))
);

INSERT INTO employee_guest_sessions (
  session_id, token_hash, user_id, employee_id, auth_mode, status,
  created_at, expires_at, revoked_at, revoked_reason
)
SELECT s.session_id, s.token_hash, s.user_id, u.employee_id, s.auth_mode,
       CASE WHEN u.verification_status = 'UNVERIFIED'
         THEN 'UNVERIFIED_EMPLOYEE'
         ELSE 'VERIFIED'
       END,
       s.created_at, s.expires_at, s.revoked_at, s.revoked_reason
FROM employee_guest_sessions_legacy s
LEFT JOIN users u ON u.user_id = s.user_id;

DROP TABLE employee_guest_sessions_legacy;

CREATE INDEX idx_employee_guest_sessions_user_state
  ON employee_guest_sessions(user_id, revoked_at, expires_at);

CREATE INDEX idx_employee_guest_sessions_employee_state
  ON employee_guest_sessions(employee_id, status, revoked_at, expires_at);

PRAGMA foreign_keys = ON;
