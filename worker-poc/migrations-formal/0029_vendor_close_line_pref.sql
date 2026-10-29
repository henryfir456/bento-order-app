PRAGMA foreign_keys = ON;

-- Let a vendor principal opt out of the 18:00 close LINE push by storing a
-- VENDOR_CLOSE preference. No row means enabled, so behavior is unchanged.
-- SQLite cannot alter a CHECK, so rebuild.
CREATE TABLE user_reminder_prefs_new (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('A', 'B', 'ADMIN_CLOSE', 'VENDOR_CLOSE')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, mode)
);

INSERT INTO user_reminder_prefs_new (user_id, mode, enabled, updated_at)
SELECT user_id, mode, enabled, updated_at FROM user_reminder_prefs;

DROP TABLE user_reminder_prefs;
ALTER TABLE user_reminder_prefs_new RENAME TO user_reminder_prefs;
