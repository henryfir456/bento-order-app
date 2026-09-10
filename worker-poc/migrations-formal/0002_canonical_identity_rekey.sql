PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS balance_ledger_sequence_assign;

ALTER TABLE users RENAME TO users_legacy;
ALTER TABLE calendar_settings RENAME TO calendar_settings_legacy;
ALTER TABLE likes RENAME TO likes_legacy;
ALTER TABLE orders RENAME TO orders_legacy;
ALTER TABLE order_items RENAME TO order_items_legacy;
ALTER TABLE order_status_history RENAME TO order_status_history_legacy;
ALTER TABLE balance_ledger RENAME TO balance_ledger_legacy;
ALTER TABLE idempotency_keys RENAME TO idempotency_keys_legacy;
ALTER TABLE admin_audit_log RENAME TO admin_audit_log_legacy;
ALTER TABLE import_quarantine RENAME TO import_quarantine_legacy;
ALTER TABLE opening_balance_snapshots RENAME TO opening_balance_snapshots_legacy;

CREATE TABLE legacy_user_map (
  legacy_line_user_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE
);

INSERT INTO legacy_user_map (legacy_line_user_id, user_id)
SELECT line_user_id, 'legacy_' || lower(hex(line_user_id))
FROM users_legacy;

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  employee_id TEXT,
  line_user_id TEXT,
  display_name TEXT NOT NULL,
  pickup_floor TEXT NOT NULL
    CHECK (pickup_floor IN ('1樓', '9樓')),
  balance INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'User'
    CHECK (role IN ('User', 'ProxyAdmin', 'Admin')),
  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE calendar_settings (
  order_date TEXT PRIMARY KEY,
  vendor TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'A'
    CHECK (mode IN ('A', 'B')),
  vendor_source TEXT NOT NULL DEFAULT 'CONFIGURED'
    CHECK (vendor_source IN ('CONFIGURED', 'LIKE_DEFAULT')),
  updated_by_user_id TEXT REFERENCES users(user_id),
  updated_by_auth_mode TEXT
    CHECK (updated_by_auth_mode IS NULL OR updated_by_auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE likes (
  order_date TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_date, user_id)
);

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  employee_id_snapshot TEXT,
  line_user_id_snapshot TEXT,
  display_name_snapshot TEXT NOT NULL,
  order_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  pickup_floor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_by_user_id TEXT NOT NULL REFERENCES users(user_id),
  created_auth_mode TEXT NOT NULL DEFAULT 'line'
    CHECK (created_auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  cancelled_by_user_id TEXT REFERENCES users(user_id),
  cancelled_auth_mode TEXT
    CHECK (cancelled_auth_mode IS NULL OR cancelled_auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  source_batch_id TEXT REFERENCES import_batches(batch_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  line_no INTEGER NOT NULL CHECK (line_no > 0),
  menu_item_id TEXT REFERENCES menu_items(menu_item_id),
  legacy_item_id TEXT,
  item_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE order_status_history (
  transition_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(order_id),
  from_status TEXT
    CHECK (from_status IS NULL OR from_status IN ('ACTIVE', 'CANCELLED')),
  to_status TEXT NOT NULL
    CHECK (to_status IN ('ACTIVE', 'CANCELLED')),
  actor_user_id TEXT REFERENCES users(user_id),
  actor_auth_mode TEXT NOT NULL DEFAULT 'legacy_import'
    CHECK (actor_auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  employee_id_snapshot TEXT,
  line_user_id_snapshot TEXT,
  display_name_snapshot TEXT,
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE balance_ledger (
  transaction_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  employee_id_snapshot TEXT,
  line_user_id_snapshot TEXT,
  display_name_snapshot TEXT,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('TOPUP', 'ORDER', 'REFUND', 'ADJUSTMENT')),
  reference_id TEXT,
  operator_user_id TEXT REFERENCES users(user_id),
  operator_employee_id_snapshot TEXT,
  operator_line_user_id_snapshot TEXT,
  operator_display_name_snapshot TEXT,
  operator_auth_mode TEXT
    CHECK (operator_auth_mode IS NULL OR operator_auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  auth_mode TEXT NOT NULL DEFAULT 'legacy_import'
    CHECK (auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  note TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_batch_id TEXT REFERENCES import_batches(batch_id)
);

CREATE TABLE idempotency_keys (
  actor_user_id TEXT NOT NULL REFERENCES users(user_id),
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  response_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  PRIMARY KEY (actor_user_id, operation, idempotency_key)
);

CREATE TABLE admin_audit_log (
  audit_id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(user_id),
  actor_auth_mode TEXT NOT NULL DEFAULT 'legacy_import'
    CHECK (actor_auth_mode IN ('line', 'employee_guest', 'legacy_import')),
  actor_employee_id_snapshot TEXT,
  actor_line_user_id_snapshot TEXT,
  target_user_id TEXT REFERENCES users(user_id),
  target_employee_id_snapshot TEXT,
  target_line_user_id_snapshot TEXT,
  action TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_quarantine (
  quarantine_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(batch_id),
  entity_type TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  raw_payload_json TEXT NOT NULL,
  normalized_payload_json TEXT,
  review_state TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (review_state IN ('OPEN', 'APPROVED', 'REJECTED', 'RESOLVED')),
  reviewed_by_user_id TEXT REFERENCES users(user_id),
  resolution_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE TABLE opening_balance_snapshots (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id),
  snapshot_balance INTEGER NOT NULL,
  source_batch_id TEXT NOT NULL REFERENCES import_batches(batch_id),
  policy_status TEXT NOT NULL
    CHECK (policy_status IN ('REQUIRED', 'NOT_REQUIRED', 'RESOLVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employee_guest_sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  auth_mode TEXT NOT NULL DEFAULT 'employee_guest'
    CHECK (auth_mode = 'employee_guest'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_reason TEXT
    CHECK (revoked_reason IS NULL OR revoked_reason IN ('line_bound', 'admin_revoke'))
);

INSERT INTO users (
  user_id, employee_id, line_user_id, display_name, pickup_floor,
  balance, role, active, created_at, updated_at
)
SELECT m.user_id, NULL, NULLIF(trim(u.line_user_id), ''), u.display_name, u.pickup_floor,
       u.balance, u.role, 1, u.created_at, u.updated_at
FROM users_legacy u
JOIN legacy_user_map m ON m.legacy_line_user_id = u.line_user_id;

INSERT INTO calendar_settings (
  order_date, vendor, mode, vendor_source, updated_by_user_id,
  updated_by_auth_mode, created_at, updated_at
)
SELECT c.order_date, c.vendor, c.mode, c.vendor_source, m.user_id,
       CASE WHEN m.user_id IS NULL THEN NULL ELSE 'legacy_import' END,
       c.created_at, c.updated_at
FROM calendar_settings_legacy c
LEFT JOIN legacy_user_map m ON m.legacy_line_user_id = c.updated_by_line_user_id;

INSERT INTO likes (order_date, user_id, created_at)
SELECT l.order_date, m.user_id, l.created_at
FROM likes_legacy l
JOIN legacy_user_map m ON m.legacy_line_user_id = l.line_user_id;

INSERT INTO orders (
  order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, order_date, vendor, pickup_floor, note,
  total_amount, status, created_by_user_id, created_auth_mode,
  cancelled_by_user_id, cancelled_auth_mode, source_batch_id,
  created_at, updated_at
)
SELECT o.order_id, m.user_id, NULL, o.line_user_id, u.display_name,
       o.order_date, o.vendor, o.pickup_floor, o.note, o.total_amount,
       o.status, m.user_id, 'legacy_import', NULL, NULL, o.source_batch_id,
       o.created_at, o.updated_at
FROM orders_legacy o
JOIN legacy_user_map m ON m.legacy_line_user_id = o.line_user_id
JOIN users_legacy u ON u.line_user_id = o.line_user_id;

INSERT INTO order_items (
  order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
  quantity, unit_price, subtotal
)
SELECT order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
       quantity, unit_price, subtotal
FROM order_items_legacy;

INSERT INTO order_status_history (
  transition_id, order_id, from_status, to_status, actor_user_id,
  actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, reason, metadata_json, occurred_at
)
SELECT h.transition_id, h.order_id, h.from_status, h.to_status, m.user_id,
       'legacy_import', NULL, h.actor_line_user_id, u.display_name,
       h.reason, h.metadata_json, h.occurred_at
FROM order_status_history_legacy h
LEFT JOIN legacy_user_map m ON m.legacy_line_user_id = h.actor_line_user_id
LEFT JOIN users_legacy u ON u.line_user_id = h.actor_line_user_id;

INSERT INTO balance_ledger (
  transaction_id, user_id, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, amount, balance_after, type, reference_id,
  operator_user_id, operator_employee_id_snapshot,
  operator_line_user_id_snapshot, operator_display_name_snapshot,
  operator_auth_mode, auth_mode, note, occurred_at, source_batch_id
)
SELECT b.transaction_id, m.user_id, NULL, b.line_user_id, u.display_name,
       b.amount, b.balance_after, b.type, b.reference_id, op.user_id,
       NULL, b.operator_line_user_id, op_user.display_name, 'legacy_import',
       'legacy_import', b.note, b.occurred_at, b.source_batch_id
FROM balance_ledger_legacy b
JOIN legacy_user_map m ON m.legacy_line_user_id = b.line_user_id
JOIN users_legacy u ON u.line_user_id = b.line_user_id
LEFT JOIN legacy_user_map op ON op.legacy_line_user_id = b.operator_line_user_id
LEFT JOIN users_legacy op_user ON op_user.line_user_id = b.operator_line_user_id;

INSERT INTO idempotency_keys (
  actor_user_id, operation, idempotency_key, request_hash, claim_token,
  status, response_json, created_at, completed_at
)
SELECT m.user_id, i.operation, i.idempotency_key, i.request_hash,
       i.claim_token, i.status, i.response_json, i.created_at, i.completed_at
FROM idempotency_keys_legacy i
JOIN legacy_user_map m ON m.legacy_line_user_id = i.actor_line_user_id;

INSERT INTO admin_audit_log (
  audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
  actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
  target_line_user_id_snapshot, action, metadata_json, occurred_at
)
SELECT a.audit_id, actor.user_id, 'legacy_import', NULL,
       a.actor_line_user_id, target.user_id, NULL, a.target_line_user_id,
       a.action, a.metadata_json, a.occurred_at
FROM admin_audit_log_legacy a
JOIN legacy_user_map actor ON actor.legacy_line_user_id = a.actor_line_user_id
LEFT JOIN legacy_user_map target ON target.legacy_line_user_id = a.target_line_user_id;

INSERT INTO import_quarantine (
  quarantine_id, batch_id, entity_type, source_sheet, source_row,
  reason_code, raw_payload_json, normalized_payload_json, review_state,
  reviewed_by_user_id, resolution_json, created_at, reviewed_at
)
SELECT q.quarantine_id, q.batch_id, q.entity_type, q.source_sheet, q.source_row,
       q.reason_code, q.raw_payload_json, q.normalized_payload_json,
       q.review_state, m.user_id, q.resolution_json, q.created_at, q.reviewed_at
FROM import_quarantine_legacy q
LEFT JOIN legacy_user_map m ON m.legacy_line_user_id = q.reviewed_by_line_user_id;

INSERT INTO opening_balance_snapshots (
  user_id, snapshot_balance, source_batch_id, policy_status, created_at
)
SELECT m.user_id, o.snapshot_balance, o.source_batch_id, o.policy_status,
       o.created_at
FROM opening_balance_snapshots_legacy o
JOIN legacy_user_map m ON m.legacy_line_user_id = o.line_user_id;

DROP TABLE order_items_legacy;
DROP TABLE order_status_history_legacy;
DROP TABLE balance_ledger_legacy;
DROP TABLE idempotency_keys_legacy;
DROP TABLE admin_audit_log_legacy;
DROP TABLE import_quarantine_legacy;
DROP TABLE opening_balance_snapshots_legacy;
DROP TABLE likes_legacy;
DROP TABLE orders_legacy;
DROP TABLE calendar_settings_legacy;
DROP TABLE users_legacy;
DROP TABLE legacy_user_map;

CREATE UNIQUE INDEX users_employee_id_unique
  ON users(employee_id)
  WHERE employee_id IS NOT NULL AND length(trim(employee_id)) > 0;

CREATE UNIQUE INDEX users_line_user_id_unique
  ON users(line_user_id)
  WHERE line_user_id IS NOT NULL AND length(trim(line_user_id)) > 0;

CREATE INDEX idx_calendar_settings_updated_by
  ON calendar_settings(updated_by_user_id);

CREATE INDEX idx_likes_user_order_date
  ON likes(user_id, order_date);

CREATE INDEX IF NOT EXISTS idx_menu_versions_effective
  ON menu_versions(vendor, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_menu_items_version_legacy
  ON menu_items(menu_version_id, legacy_item_id);

CREATE INDEX IF NOT EXISTS idx_menu_items_customer
  ON menu_items(menu_version_id, enabled, source_order);

CREATE INDEX IF NOT EXISTS idx_announcements_active_window
  ON announcements(enabled, start_date, end_date, source_order);

CREATE INDEX idx_orders_actor_date_status
  ON orders(user_id, order_date, status, created_at);

CREATE INDEX idx_orders_date_vendor_status
  ON orders(order_date, vendor, status);

CREATE UNIQUE INDEX idx_orders_one_active_actor_date
  ON orders(user_id, order_date)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_order_items_menu_item
  ON order_items(menu_item_id);

CREATE INDEX idx_order_status_history_order_time
  ON order_status_history(order_id, occurred_at);

CREATE INDEX idx_balance_ledger_actor_time
  ON balance_ledger(user_id, occurred_at);

CREATE INDEX idx_balance_ledger_reference
  ON balance_ledger(reference_id, type);

CREATE UNIQUE INDEX idx_balance_ledger_unique_order_reference
  ON balance_ledger(type, reference_id)
  WHERE reference_id IS NOT NULL AND type IN ('ORDER', 'REFUND');

CREATE INDEX idx_idempotency_actor_operation
  ON idempotency_keys(actor_user_id, operation, created_at);

CREATE INDEX idx_admin_audit_actor_time
  ON admin_audit_log(actor_user_id, occurred_at);

CREATE INDEX idx_import_quarantine_batch_state
  ON import_quarantine(batch_id, review_state, entity_type);

CREATE INDEX idx_employee_guest_sessions_user_state
  ON employee_guest_sessions(user_id, revoked_at, expires_at);

CREATE TRIGGER balance_ledger_sequence_assign
AFTER INSERT ON balance_ledger
BEGIN
  INSERT INTO balance_ledger_sequence (transaction_id)
  VALUES (NEW.transaction_id);
END;

PRAGMA foreign_keys = ON;
