PRAGMA foreign_keys = ON;

-- Admin-controlled switch: after the 蔡老師 group closes (10:00 Taipei), the
-- cron files a PENDING reimbursement request for the chosen ProxyAdmin. The
-- Admin still approves it. Single row (setting_id = 1); absent/disabled = off.
CREATE TABLE IF NOT EXISTS auto_reimbursement_settings (
  setting_id INTEGER PRIMARY KEY CHECK (setting_id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  requester_user_id TEXT REFERENCES users(user_id) ON DELETE RESTRICT,
  updated_by_user_id TEXT REFERENCES users(user_id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL
);
