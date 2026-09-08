-- Committed ledger order is separate from business timestamps.  AUTOINCREMENT
-- assigns the sequence when the row is inserted inside the D1 batch.
CREATE TABLE IF NOT EXISTS balance_ledger_sequence (
  sequence_number INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL UNIQUE
);

-- Formal databases created before this migration have no legacy ledger rows,
-- but preserve insertion order for any existing formal rows without changing
-- their occurred_at timestamps.
INSERT OR IGNORE INTO balance_ledger_sequence (transaction_id)
SELECT transaction_id
FROM balance_ledger
ORDER BY rowid ASC;

CREATE TRIGGER IF NOT EXISTS balance_ledger_sequence_assign
AFTER INSERT ON balance_ledger
BEGIN
  INSERT INTO balance_ledger_sequence (transaction_id)
  VALUES (NEW.transaction_id);
END;

-- Imported Users.balance values are operational snapshots.  Their policy
-- state must survive later ledger mutations without creating historical rows.
CREATE TABLE IF NOT EXISTS opening_balance_snapshots (
  line_user_id TEXT PRIMARY KEY REFERENCES users(line_user_id),
  snapshot_balance INTEGER NOT NULL,
  source_batch_id TEXT NOT NULL REFERENCES import_batches(batch_id),
  policy_status TEXT NOT NULL
    CHECK (policy_status IN ('REQUIRED', 'NOT_REQUIRED', 'RESOLVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
