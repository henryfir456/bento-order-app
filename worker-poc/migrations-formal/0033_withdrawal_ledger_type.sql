PRAGMA foreign_keys = OFF;

-- Allow the WITHDRAWAL ledger type (Admin registers a ProxyAdmin cash-out
-- after a bank transfer). SQLite cannot alter a CHECK, so rebuild the table
-- exactly as it stands (0002 definition + 0009 topup_method) with the wider
-- type list. Nothing references balance_ledger by foreign key;
-- balance_ledger_sequence is keyed by transaction_id only, so existing
-- sequence numbers are untouched (the assign trigger is dropped while the
-- rows are copied so no duplicate sequence rows are written).
DROP TRIGGER IF EXISTS balance_ledger_sequence_assign;
DROP INDEX IF EXISTS idx_balance_ledger_actor_time;
DROP INDEX IF EXISTS idx_balance_ledger_reference;
DROP INDEX IF EXISTS idx_balance_ledger_unique_order_reference;

ALTER TABLE balance_ledger RENAME TO balance_ledger_before_withdrawal;

CREATE TABLE balance_ledger (
  transaction_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  employee_id_snapshot TEXT,
  line_user_id_snapshot TEXT,
  display_name_snapshot TEXT,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('TOPUP', 'ORDER', 'REFUND', 'ADJUSTMENT', 'WITHDRAWAL')),
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
  source_batch_id TEXT REFERENCES import_batches(batch_id),
  topup_method TEXT NULL
    CHECK (
      topup_method IS NULL
      OR (
        type = 'TOPUP'
        AND topup_method IN (
          'TAIWAN_PAY',
          'LINE_PAY_MONEY',
          'BANK_TRANSFER',
          'CASH',
          'IPASS_MONEY'
        )
      )
    )
);

INSERT INTO balance_ledger (
  transaction_id, user_id, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, amount, balance_after, type, reference_id,
  operator_user_id, operator_employee_id_snapshot, operator_line_user_id_snapshot,
  operator_display_name_snapshot, operator_auth_mode, auth_mode, note,
  occurred_at, source_batch_id, topup_method
)
SELECT
  transaction_id, user_id, employee_id_snapshot, line_user_id_snapshot,
  display_name_snapshot, amount, balance_after, type, reference_id,
  operator_user_id, operator_employee_id_snapshot, operator_line_user_id_snapshot,
  operator_display_name_snapshot, operator_auth_mode, auth_mode, note,
  occurred_at, source_batch_id, topup_method
FROM balance_ledger_before_withdrawal
ORDER BY rowid ASC;

DROP TABLE balance_ledger_before_withdrawal;

CREATE INDEX idx_balance_ledger_actor_time
  ON balance_ledger(user_id, occurred_at);

CREATE INDEX idx_balance_ledger_reference
  ON balance_ledger(reference_id, type);

CREATE UNIQUE INDEX idx_balance_ledger_unique_order_reference
  ON balance_ledger(type, reference_id)
  WHERE reference_id IS NOT NULL AND type IN ('ORDER', 'REFUND');

CREATE TRIGGER balance_ledger_sequence_assign
AFTER INSERT ON balance_ledger
BEGIN
  INSERT INTO balance_ledger_sequence (transaction_id)
  VALUES (NEW.transaction_id);
END;

PRAGMA foreign_keys = ON;
