PRAGMA foreign_keys = ON;

-- Feedback area: any signed-in member (employee, ProxyAdmin, Admin, Vendor)
-- may leave feedback with an optional 1-5 rating. Visible only to the
-- submitter and Admins; never shown to other employees or vendors.
-- is_anonymous hides the submitter's name from the Admin screens (the row
-- still keeps user_id so the submitter sees their own history and so a daily
-- submission limit can be enforced).
CREATE TABLE IF NOT EXISTS feedback_entries (
  feedback_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  role_snapshot TEXT NOT NULL DEFAULT '',
  display_name_snapshot TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('SYSTEM', 'MENU', 'VENDOR', 'OTHER')),
  target_name TEXT NOT NULL DEFAULT '',
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  message TEXT NOT NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IN_PROGRESS', 'DONE')),
  admin_note TEXT NOT NULL DEFAULT '',
  handled_by_user_id TEXT REFERENCES users(user_id) ON DELETE RESTRICT,
  handled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_created
  ON feedback_entries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_status_created
  ON feedback_entries(status, created_at DESC);
