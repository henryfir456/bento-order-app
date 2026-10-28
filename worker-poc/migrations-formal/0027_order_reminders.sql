PRAGMA foreign_keys = ON;

-- Opt-in LINE reminder 10 minutes before an order deadline. One row per user
-- and calendar mode: A = same-day 10:00 group (蔡老師), B = previous-day 18:00 group.
CREATE TABLE IF NOT EXISTS user_reminder_prefs (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('A', 'B')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, mode)
);

-- One row per reminder actually attempted; makes a retried cron run idempotent.
CREATE TABLE IF NOT EXISTS order_reminder_log (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  order_date TEXT NOT NULL CHECK (order_date GLOB '????-??-??'),
  mode TEXT NOT NULL CHECK (mode IN ('A', 'B')),
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, order_date, mode)
);
