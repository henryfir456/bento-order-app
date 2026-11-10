PRAGMA foreign_keys = ON;

-- Let an Admin/ProxyAdmin opt in to the vendor 18:00 close notification
-- (ADMIN_VENDOR_CLOSE preference). Opt-in: no row means not subscribed.
-- SQLite cannot alter a CHECK, so rebuild.
CREATE TABLE user_reminder_prefs_new (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('A', 'B', 'ADMIN_CLOSE', 'VENDOR_CLOSE', 'ADMIN_VENDOR_CLOSE')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, mode)
);

INSERT INTO user_reminder_prefs_new (user_id, mode, enabled, updated_at)
SELECT user_id, mode, enabled, updated_at FROM user_reminder_prefs;

DROP TABLE user_reminder_prefs;
ALTER TABLE user_reminder_prefs_new RENAME TO user_reminder_prefs;
