PRAGMA foreign_keys = ON;

-- Short-lived diagnostic log of login/bootstrap failures, reported by the
-- frontend and recorded by the Worker. It never holds LINE tokens, user IDs,
-- employee IDs or names; client_ref is a truncated hash of the caller address.
-- Rows older than 14 days are purged by the daily cron.
CREATE TABLE auth_error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('frontend', 'backend')),
  stage TEXT NOT NULL,
  error_code TEXT NOT NULL,
  http_status INTEGER,
  error_class TEXT,
  line_profile_status INTEGER,
  line_verify_status INTEGER,
  duration_ms INTEGER,
  in_line INTEGER,
  app_version TEXT,
  ua_summary TEXT,
  client_ref TEXT,
  request_id TEXT,
  detail TEXT
);

CREATE INDEX idx_auth_error_log_occurred_at ON auth_error_log (occurred_at);
