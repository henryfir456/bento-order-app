# Opening Balance and Adjustment Policy Gate

Status: pending explicit product and finance approval.

The importer may preserve a legacy `Users.balance` value as source evidence and
as the current local user snapshot, but it must not emit a synthetic `TOPUP`,
`ORDER`, `REFUND`, or `ADJUSTMENT` row to explain that value. Incomplete
`TopupHistory` rows remain in `import_quarantine` with
`INCOMPLETE_LEDGER_POLICY` until this gate is approved.

Before any opening balance or adjustment is promoted into the formal ledger, an
approved policy record must identify all of the following:

- policy identifier and reviewed version;
- approving operator and UTC approval timestamp;
- the opening-balance effective date/time and timezone interpretation;
- the target user and exact integer amount;
- the explicit adjustment type, reference, and supporting evidence.

Until those fields are supplied and reviewed, balance history returns the
`OPENING_BALANCE_POLICY_REQUIRED` boundary for a non-zero snapshot without
ledger evidence. This document is not an approval record and does not authorize
ledger promotion.
