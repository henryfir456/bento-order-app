# Legacy Reconciliation Dry-Run Foundation

**Status:** Approved for implementation; dry-run foundation only  
**Date:** 2026-09-13  
**Scope:** Cloudflare Worker + D1 canonical identity architecture

## Goal and boundary

Build a deterministic, pure, read-only reconciliation foundation for the two
Legacy sources. This slice produces evidence and semantic mutation previews;
it does not connect to remote D1, execute SQL, apply migrations, deploy, write
production data, or alter either source.

The existing workbook path remains:

```text
readLegacyWorkbook -> normalizeLegacyWorkbook -> resolveLegacyIdentities
  -> validateImport
```

The independent planner receives `{ currentSnapshot, historicalFacts,
d1Snapshot }`. `d1Snapshot` is an offline fixture/export. The planner never
opens a D1 binding, runs a SQL statement, allocates a production identity
sequence, or performs a remote lookup.

## Source-of-truth architecture

### Historical source: `gas/bento_script.sql`

The SQL file is a UTF-16LE SQL Server/SSMS schema plus historical data dump. It
contains four tables and 8,121 INSERT rows:

| Table | Rows | Meaning | Identity / reconciliation role |
| --- | ---: | --- | --- |
| `bento_order_count` | 3,030 | aggregate order counts | `username` is employee identity; order fact only |
| `bento_order_status` | 5,007 | mixed event history | `username` is employee identity; `status` is event type |
| `bento_price` | 34 | historical menu prices | menu fact, not user identity |
| `bento_type` | 50 | historical menu/type definitions | menu/type fact, not user identity |

`bento_order_status` events: `order` 2,795, `wallet_sub` 1,009,
`wallet_add` 168, `heart` 458, `heart-outline` 85, `open` 417, and
`pic_id` 75. The SQL identity union is 49 normalized usernames.
`username_update` is operator/updater evidence only; it is never the owner.

The SQL adapter emits at least:

```js
{
  historicalOrderFacts,
  historicalLikeFacts,
  historicalWalletFacts,
  historicalMenuFacts,
  historicalTypeFacts,
  sourceHash,
  sourceShapeIssues
}
```

Every applicable fact retains `normalizedEmployeeId`, `sourceTable`, source
row and source ID, original status/event type, and raw reconciliation
evidence. Parsing is text-only and never executes the dump.

### Current/master source: `gas/便當系統設定.xlsx`

The workbook is current/master and recent operational evidence, not the full
historical source:

| Sheet | Non-empty rows | Role |
| --- | ---: | --- |
| `Settings` | 13 | current settings |
| `Likes` | 5 | recent operational evidence |
| `TopupHistory` | 2 | recent wallet evidence |
| `Users` | 3 | current users/roles/balances |
| `Menu` | 28 | current menu |
| `Announcements` | 2 | current announcements |
| `Orders` | 25 | recent orders |

The current workbook has no direct `username`/`employee_id` in its identity-
bearing sheets. It must not use name or LINE ID to infer historical identity.
Its normalized output is `currentSnapshot`; recent Orders/Likes/TopupHistory
remain operational evidence and are not substituted for SQL history.

### Source comparison and recommended authority

| Data domain | Excel | `bento_script.sql` | Recommended source |
| --- | --- | --- | --- |
| Users | current LINE/display/floor/balance/role; no employee ID in current export | no Users table | D1 snapshot for existing owners; Excel only for direct-ID current master rows |
| Orders | recent operational rows; blank status header shape | historical counts and `status=order` events | SQL history + Excel recent evidence; never fabricate modern orders |
| TopupHistory | recent operational history | `wallet_add`/`wallet_sub` history | both as evidence; D1 balance authoritative |
| Likes | recent current evidence | chronological `heart`/`heart-outline` events | SQL history + Excel evidence; materialization needs event policy |
| Balance | current operational evidence | wallet event evidence | D1 current balance; mismatch is review |
| Role | current operational evidence | none | D1 authoritative; Legacy role cannot auto-escalate |
| Employee identity | only a direct username/employee-id column | `username` | SQL `username` for history; no name/LINE inference |
| Menu/type | current menu | historical `bento_price`/`bento_type` | current vs historical views by domain policy |

## Identity contract

The confirmed domain contract is:

```text
SQL username -> strict normalize -> employee_id
```

`bento_order_count.username` and `bento_order_status.username` are formal
employee IDs. This is a domain fact, not a proof gate. Strict normalization
only applies trim and the repository's exact case normalization; it never
performs fuzzy matching, punctuation repair, substring matching, or guesswork.
Leading zeroes remain significant.

- `name` is display/evidence/conflict detection only.
- LINE user ID is existing-binding evidence/conflict detection only.
- `username_update` is operator evidence only, never owner identity.
- Excel `workbook.username -> normalized employee_id` remains valid only when
  an Excel row actually has that direct column. The current file does not, so
  it cannot supply historical identity for those rows.
- The only historical identity path is SQL username -> employee ID -> offline
  D1 snapshot -> canonical `user_id`.
- One normalized employee ID can map to at most one canonical user.

## Canonical resolution and classification

For a direct-ID current master row, or a SQL historical identity that resolves
to an existing owner:

| Condition | Planned action |
| --- | --- |
| no canonical owner and safe direct-ID master payload | `CREATE_CANONICAL` |
| no canonical owner for a SQL-only historical employee ID | `CREATE_CANONICAL` candidate with explicit incomplete-profile evidence |
| existing unique owner with `line_user_id IS NULL` | `MERGE_EXISTING_NONLINE` |
| existing unique owner with a LINE binding | `MERGE_EXISTING_LINE` |
| identical state and no required history relationship | `NO_CHANGE` |
| balance differs | `REVIEW_BALANCE` |
| normalized collision, multiple owner, LINE ownership conflict, or unprovable state | `AMBIGUOUS` or `ERROR` |

Ambiguity always fails closed. A SQL-only employee ID with no existing D1
owner receives one deterministic `CREATE_CANONICAL` candidate keyed only by
the normalized SQL username. This is a semantic candidate, not an executable
user insert. The candidate uses the lowest-privilege `User` role, a null LINE
binding, `active=1`, `verification_status=UNVERIFIED`, and canonical balance
default `0` explicitly marked as not legacy-reconciled. Its display name is a
deterministic provisional value derived from the employee ID. The local policy
gate permits `pickup_floor = NULL` and reports `profileComplete=false`; it
does not invent a floor or infer one from Excel, names, LINE, or orders. The
candidate remains non-executable until a later approved write gate.

`CREATE_CANONICAL` previews a deterministic stable user ID, normalized
employee ID, `line_user_id: null`, and the centralized SQL-only provisional
profile policy. It does not allocate a production sequence, write D1, create a
ledger, or cause a side effect. Future employee login and an authenticated
guest-session LINE bind/claim flow must resolve to this same canonical user
rather than create a provisional duplicate. Direct unauthenticated LINE
claims remain rejected, and existing LINE-bound ownership remains protected.

Existing canonical owners are always the target. Existing `Admin`/
`ProxyAdmin` authority is never lowered. A Legacy role higher than the current
role is review/ambiguous and never auto-escalates.

## Historical fact policy

### Orders

`bento_order_count` and `bento_order_status.status=order` become historical
order facts and relationship previews only. The adapter must not fabricate a
modern `order_id`, item-level contract, or current status/cancellation
semantics. A deterministic target may produce a preview pointing at the
canonical user, but `materializeModernOrder=false` and
`syntheticOrderId=false`.

### Likes

`heart` and `heart-outline` become chronological historical like events. A
preview may point at a target user, but it must not treat each event as one
current Like. Current-state materialization requires a deterministic event
policy and is out of scope here.

### Wallet and balance

`wallet_add` and `wallet_sub` are historical wallet evidence only. Legacy
balance never overwrites current D1 balance. The planner emits review evidence
where relevant and never creates a synthetic ledger, opening adjustment, or
authoritative rebalance. `TopupHistory` remains behind its existing balance
migration policy gate.

## Excel Orders status safety

The known workbook Orders shape has a blank 13th header while its data contains
`ACTIVE`/`CANCELLED`. The parser recognizes only the explicit surrounding
header signature and accepted status values. It never defaults a missing status
to `ACTIVE`; `CANCELLED` remains `CANCELLED`. An unrecognized shape fails
closed with a shape issue and no guessed status.

## Report, determinism, and safety

The report includes per-row source reference, source table/id where applicable,
normalized employee ID, name, target canonical user, LINE binding state,
existing/Legacy role, existing/Legacy balance, action, reason, semantic
`mutationPreview`, and conflict flags. Previews have `execute:false`, contain
no SQL, and are not callable.

Summary includes `totalSqlHistoricalIdentities`,
`uniqueNormalizedEmployeeIds`, every action count, historical order/like/wallet
fact counts, normalization collisions, unresolved/conflicting historical rows,
and deterministic `planHash`.

The same SQL dump, Excel snapshot, and offline D1 snapshot produce identical
rows, previews, summary, and hash. The report proves:

```text
rowsWritten = 0
changedDb = false
no SQL execution / remote D1 / deploy / migration apply / remote mutation
```

Only an explicitly requested local report file may be written.

## Acceptance criteria

1. SQL `username` is the historical primary identity and strict-normalizes to employee ID.
2. No name, LINE ID, fuzzy match, or `username_update` owner inference exists.
3. One normalized employee ID never plans two canonical users.
4. Missing identity, normalization collision, multiple owner, LINE conflict, and unprovable state fail closed.
5. New safe direct-ID master rows preview a deterministic non-LINE canonical user with `line_user_id=null`.
6. Existing non-LINE and LINE-bound owners classify separately and never create a second user.
7. Existing Admin/ProxyAdmin authority is preserved; Legacy escalation is review/ambiguous.
8. Balance mismatch is `REVIEW_BALANCE` with no overwrite, synthetic ledger, or adjustment.
9. Historical Orders/Likes/TopupHistory link only after deterministic employee-ID resolution; no dangling/guessed user IDs.
10. SQL order facts do not fabricate modern order IDs; like events use chronological preview; wallet history is policy-gated evidence.
11. Blank-header `CANCELLED` remains `CANCELLED`; unknown status shape is not defaulted to `ACTIVE`.
12. Identical three-source inputs produce identical rows, previews, summary, and `planHash`.
13. Dry-run proves zero writes and no remote capability.
14. Verification separates fresh results from captured baseline failures and unverified remote behavior.

## Out of scope and next gate

Remote import/read/write, production mutation, migration apply, deploy, commit,
push, destructive cleanup, manual reconciliation, automatic ambiguous merge,
modern order materialization, current-like materialization policy, and balance
migration policy are out of scope.

The next gate is a separately approved remote-read checkpoint using the exact
SQL/Excel hashes and an authoritative D1 snapshot, followed by explicit review
of identity creation/binding, historical fact materialization, and balance
policy. This foundation authorizes none of those writes.
