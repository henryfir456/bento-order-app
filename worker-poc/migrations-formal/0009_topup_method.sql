-- Migration 0009: structured payment method for new admin top-ups.
-- Existing ledger rows remain unchanged and retain NULL for this field.
ALTER TABLE balance_ledger ADD COLUMN topup_method TEXT NULL
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
  );
