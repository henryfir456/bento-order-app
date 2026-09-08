# Opening Balance and Adjustment Policy Gate

Status: APPROVED — Option 1, snapshot-only / defer ledger promotion.

## Approved migration policy

The legacy `Users.balance` value is imported as the current operational opening
balance snapshot. The signed integer is preserved exactly, including zero and
negative balances.

The importer must not fabricate historical ledger activity. It must not emit a
synthetic historical `TOPUP`, `ORDER`, `REFUND`, or `ADJUSTMENT` row to explain a
legacy snapshot. The formal ledger begins with future approved mutations after
cutover.

Incomplete or unverifiable `TopupHistory` rows remain legacy evidence in
`import_quarantine`. They are not promoted into the formal ledger unless a
later explicit policy approves them.

Where a balance cannot be fully explained by formal ledger entries, balance
history exposes the `OPENING_BALANCE_POLICY_REQUIRED` policy boundary rather
than inventing missing transactions.

All post-cutover balance mutations — order deductions, cancellation refunds,
admin top-ups, and any later approved adjustment — must use the existing
atomic balance + ledger + audit primitives.

## Deferred cutover adjustment

This approval does not authorize an opening `ADJUSTMENT`. A future cutover
adjustment requires a separate reviewed policy containing:

- policy identifier and reviewed version;
- approving operator and approval timestamp;
- effective timestamp and timezone interpretation;
- target user and signed amount;
- explicit adjustment type, reference, and supporting evidence;
- rollback or compensation rules.

Until that separate policy is approved, no opening adjustment is written.

This document does not authorize real-workbook modification, remote D1 work, or
promotion of legacy history.
