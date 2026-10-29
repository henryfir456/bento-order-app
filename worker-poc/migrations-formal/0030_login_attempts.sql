PRAGMA foreign_keys = ON;

-- Failed employee-code login counters, keyed by client address, so repeated
-- guessing of employee IDs can be throttled. Rows hold no user data.
CREATE TABLE login_attempts (
  attempt_key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0 CHECK (fail_count >= 0)
);
