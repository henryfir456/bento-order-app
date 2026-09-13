# Legacy Reconciliation Dry-Run

This is a local, pure reconciliation report for the Worker + D1 canonical
identity model. It has two inputs:

```text
gas/bento_script.sql       historical SQL Server dump
gas/便當系統設定.xlsx       current/master + recent operational snapshot
```

The planner input is `{ currentSnapshot, historicalFacts, d1Snapshot }`.
The SQL file is parsed as text only; it is never executed.

## Identity and source mapping

The only historical identity path is:

```text
bento_order_count.username / bento_order_status.username
  -> strict trim + case normalization -> employee_id
  -> offline D1 snapshot -> canonical user_id
```

`username_update` is operator evidence, not row ownership. Names, LINE IDs,
fuzzy matching, and identity maps cannot fill a missing SQL username. The
current workbook has no direct employee ID in its current identity-bearing
export, so it cannot be used to infer SQL history.

The SQL adapter emits order, like, wallet, menu, and type facts with source
table/row/id, original event type, normalized employee ID where applicable,
and raw evidence. `order` events are historical facts only: no modern
`order_id` is fabricated. `heart`/`heart-outline` remain chronological like
events. `wallet_add`/`wallet_sub` are evidence only.

Excel remains the source for current Users/Menu/Settings/Announcements and
recent Orders/Likes/TopupHistory evidence. The Excel Orders parser recognizes
the known blank 13th header only with its full surrounding shape; it never
defaults a missing status to `ACTIVE`, and preserves `CANCELLED`.

## Run locally

```text
npm run legacy:reconciliation:dry-run -- \
  --input ../gas/便當系統設定.xlsx \
  --sql-dump ../gas/bento_script.sql \
  --d1-snapshot ./fixtures/d1-snapshot.json \
  --output ./reports/legacy-reconciliation.json
```

The input workbook, SQL dump, snapshot, and report path are local. The CLI
rejects remote/apply/execute/deploy/migration/write flags and refuses to
overwrite an existing report.

## Classification

The report uses only:

```text
CREATE_CANONICAL
MERGE_EXISTING_NONLINE
MERGE_EXISTING_LINE
NO_CHANGE
REVIEW_BALANCE
AMBIGUOUS
ERROR
```

A SQL-only employee ID without an existing D1 owner is one deterministic
`CREATE_CANONICAL` candidate keyed by the normalized SQL username. It is a
semantic candidate only: `line_user_id` is null, role is `User`, balance `0`
is explicitly a canonical default rather than legacy reconciliation, and the
display name is deterministic provisional evidence. The local policy gate
allows the identity row to keep `pickup_floor = NULL` until explicit profile
completion; it reports `profileComplete=false` and never invents a floor. The
candidate remains non-executable until a later approved write gate. Multiple
owners, normalized collisions, LINE ownership conflicts, inactive owners, role escalation, and unprovable identity
all fail closed. Existing canonical Admin/ProxyAdmin roles are never lowered.

Wallet and balance previews are review-only. They do not overwrite D1 balance,
create a synthetic ledger/opening adjustment, or recalculate authoritative
balance. Like previews do not materialize one current Like per event. Order
previews do not materialize modern Orders.

## Report and safety contract

Each row records source reference/table/id, normalized employee ID, name,
target canonical user, LINE binding state, roles, balances, action, reason,
semantic `mutationPreview`, and conflict flags. Every preview has
`execute:false` and contains no executable SQL.

Summary includes SQL historical identity count, unique normalized IDs, all
action counts, order/like/wallet fact counts, unresolved/conflicting rows,
normalization collisions, and `planHash`. Identical SQL + Excel snapshot + D1
snapshot inputs produce identical rows, summary, previews, and hash.

The report must prove:

```text
rowsWritten: 0
changedDb: false
sqlExecuted: false
remoteD1Accessed: false
remoteMutation: false
migrationApplied: false
deployed: false
mutationPreviewExecutable: false
```

## Next gate

Formal import requires a separately approved remote-read checkpoint using the
exact source hashes and authoritative D1 snapshot. Identity creation/binding,
historical fact materialization, current Like event policy, and balance policy
must each be reviewed before any remote write. This dry-run does not authorize
those operations.
