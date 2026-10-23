PRAGMA foreign_keys = ON;

-- Per-user bell notifications (group cancellation refunds, vendor order close).
-- Announcements keep their own tables; this holds system-generated messages.
-- dedupe_key makes retried cron runs and batches idempotent.
CREATE TABLE IF NOT EXISTS user_notifications (
  notification_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('GROUP_CANCELLED', 'VENDOR_ORDER_CLOSED')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body TEXT NOT NULL,
  ref_date TEXT CHECK (ref_date IS NULL OR ref_date GLOB '????-??-??'),
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON user_notifications(user_id, created_at DESC);
