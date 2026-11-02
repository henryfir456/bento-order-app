PRAGMA foreign_keys = ON;

-- ProxyAdmin reimbursement requests: a ProxyAdmin who placed orders for
-- others on a given order date may ask for that day's total; an Admin
-- approves (credits the ProxyAdmin wallet via a TOPUP ledger row) or rejects.
CREATE TABLE IF NOT EXISTS reimbursement_requests (
  request_id TEXT PRIMARY KEY,
  requester_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  order_date TEXT NOT NULL CHECK (order_date GLOB '????-??-??'),
  amount INTEGER NOT NULL CHECK (amount > 0),
  order_count INTEGER NOT NULL CHECK (order_count > 0),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requester_note TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by_user_id TEXT REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TEXT,
  ledger_transaction_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One open/approved request per requester and order date; rejected ones may
-- be filed again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reimbursement_one_open_per_date
  ON reimbursement_requests(requester_user_id, order_date)
  WHERE status IN ('PENDING', 'APPROVED');

CREATE INDEX IF NOT EXISTS idx_reimbursement_status_created
  ON reimbursement_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reimbursement_requester_created
  ON reimbursement_requests(requester_user_id, created_at DESC);

-- Allow the two reimbursement notification kinds (SQLite cannot alter a
-- CHECK, so rebuild like 0026).
CREATE TABLE user_notifications_new (
  notification_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN (
    'GROUP_CANCELLED', 'VENDOR_ORDER_CLOSED', 'ADMIN_ORDER_CLOSED',
    'REIMBURSEMENT_REQUESTED', 'REIMBURSEMENT_REVIEWED'
  )),
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
