PRAGMA foreign_keys = ON;

-- Allow the ADMIN_ORDER_CLOSED kind (10:00 蔡老師 close summary for
-- Admin/ProxyAdmin). SQLite cannot alter a CHECK, so rebuild.
CREATE TABLE user_notifications_new (
  notification_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('GROUP_CANCELLED', 'VENDOR_ORDER_CLOSED', 'ADMIN_ORDER_CLOSED')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body TEXT NOT NULL,
  ref_date TEXT CHECK (ref_date IS NULL OR ref_date GLOB '????-??-??'),
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT
);

INSERT INTO user_notifications_new (
  notification_id, user_id, kind, title, body, ref_date, dedupe_key, created_at, read_at
)
SELECT notification_id, user_id, kind, title, body, ref_date, dedupe_key, created_at, read_at
FROM user_notifications;

DROP TABLE user_notifications;
ALTER TABLE user_notifications_new RENAME TO user_notifications;

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
  ON user_notifications(user_id, created_at DESC);
