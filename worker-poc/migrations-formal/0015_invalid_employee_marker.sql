ALTER TABLE users
  ADD COLUMN invalid_reason TEXT
    CHECK (invalid_reason IS NULL OR invalid_reason = 'INVALID_EMPLOYEE_ID');

CREATE INDEX idx_users_invalid_reason
  ON users(invalid_reason, active)
  WHERE invalid_reason IS NOT NULL;
