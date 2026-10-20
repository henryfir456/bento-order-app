-- Existing announcements intentionally keep NULL eligibility so rollout never
-- causes historical announcements to be shown as popups.
ALTER TABLE announcements ADD COLUMN auto_popup_eligible_at TEXT;

CREATE TABLE announcement_user_preferences (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL REFERENCES announcements(announcement_id) ON DELETE CASCADE,
  read_at TEXT,
  dismiss_auto_popup_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, announcement_id)
);

CREATE INDEX idx_announcement_user_preferences_user_read
  ON announcement_user_preferences (user_id, read_at, announcement_id);
