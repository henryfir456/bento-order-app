# Ledger consistency audit and repair plan

Date: 2026-09-21 (Asia/Taipei)

## Scope and safety

The audit was run against the formal Cloudflare D1 database in read-only
mode. No remote D1 `INSERT`, `UPDATE`, `DELETE`, migration, or deployment was
performed. The audit uses the sequence table as the ordering authority and
does not use `users.balance` to validate a sequenced chain.

The executable audit queries are in
`worker-poc/scripts/ledger-consistency-audit.sql`. The repair preview is in
`worker-poc/scripts/ledger-consistency-repair-proposal.sql`; it is deliberately
SELECT-only and is not a repair script.

## Findings

- Users scanned: 57
- `balance_ledger` rows: 1,264
- Sequenced rows: 1,264
- Affected users with a true chain origin: 3
- Origin transactions: 3
- Propagated transactions: 33
- Affected transactions including origins and propagated rows: 36
- Earliest origin: sequence 1178
- Latest origin: sequence 1186
- Current latest sequenced balance vs `users.balance`: no mismatch across the
  full population, because later writes updated the mirror to the already
  corrupted chain tip.

### Affected users

| employee_id | canonical user | origin | propagated | first origin | last affected | latest ledger | users.balance |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: |
| 070214 | `user_7fe7d73b66fdde180feef3e2` | 1 | 16 | seq 1185, 2026-09-15T05:51:45.480Z | 1265 | 0 | 0 |
| 105499 | `user_9333d4cd6a71d17f686eb83a` | 1 | 7 | seq 1186, 2026-09-15T05:52:07.527Z | 1251 | 315 | 315 |
| 121254 | `legacy_556434643765613830663634303765613934323463666230343530613833663234` | 1 | 10 | seq 1178, 2026-09-14T17:23:16.908Z | 1267 | 0 | 0 |

The propagated count intentionally does not treat every subsequent row as a
new root cause. Each propagated row is locally continuous with the previous
bad row but remains offset from the user's first-row reconstructed balance.

### Origin rows

| employee_id | seq | type | amount | previous seq / balance | expected | actual | delta | occurred_at | note / policy |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: | --- | --- |
| 121254 | 1178 | ORDER | -120 | 1177 / 800 | 680 | -120 | -800 | 2026-09-14T17:23:16.908Z | `ORDER_CREATED`; `ORD-e56b7e32-2cf5-4e0b-9aac-63c333d430ba` |
| 070214 | 1185 | ORDER | -100 | 1175 / 800 | 700 | -100 | -800 | 2026-09-15T05:51:45.480Z | `ORDER_CREATED`; `ORD-ac7edfcc-5cac-4ca3-917a-4badf109407f` |
| 105499 | 1186 | ORDER | -100 | 1173 / 1015 | 915 | -100 | -1015 | 2026-09-15T05:52:07.527Z | `ORDER_CREATED`; `ORD-d567a5f5-ff87-4952-9e5f-fec83d772d16` |

The first subsequent adjustment for 070214 is sequence 1187, amount +800,
with actual balance_after 700. It contains
`restore_missing_legacy_cutoff_balance` and policy
`BAL-ADJ-20260915-01` (the remote data uses `BAL-ADJ`, not the `BAL-AI`
spelling in the original report). It is included in the ledger, but it
continues the already-offset chain. 105499 has the analogous +1015 adjustment
at sequence 1188. 121254 has the analogous policy adjustment at sequence
1190 with policy `BAL-ADJ-20260915-02`, after another order row at sequence
1189.

### Monthly summary findings for 2026-09

Four users have a summary amount reconciliation difference:

| employee_id | opening | additions | deductions | closing (sequenced) | opening + additions - deductions | delta | classification |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 070214 | 587 | 2213 | 2000 | 0 | 800 | -800 | ledger chain corruption |
| 105499 | 435 | 2015 | 1435 | 315 | 1015 | -700 | ledger chain corruption plus period boundary effects |
| 121254 | 501 | 2019 | 1720 | 0 | 800 | -800 | ledger chain corruption |
| 147398 | 2308 | 0 | 1120 | 1288 | 1188 | +100 | sequence/date boundary mismatch, no chain discontinuity |

For 147398, a late-August row has a later sequence than a September row. It
is excluded by the UTC `occurred_at` month filter but participates in the
sequence-based opening projection. This is a separate boundary diagnostic,
not stale-mirror corruption.

## Root cause pattern

The three origin rows are all `ORDER` debits whose `balance_after` equals the
debit amount itself (`-120`, `-100`, `-100`) even though the previous
sequenced balances were 800, 800, and 1,015. This is strong evidence that the
old writer started from a zero/stale `users.balance` mirror. The origin times
are before the `aecb0dd1` authoritative projection fix deployed in source
history (commit time 2026-09-15T06:51:48+00:00), which matches the pattern.

The remote schema does not retain a transaction-time snapshot of
`users.balance`, so the historical mirror read cannot be proven directly from
the database. The evidence proves the arithmetic origin and strongly
identifies the stale mirror as the cause; it does not claim an unavailable
historical read trace.

No separate ADJUSTMENT origin was found. Adjustment rows, including legacy
cutoff restore rows, were accepted and then propagated an earlier bad offset.
No other production runtime writer was found to insert `balance_ledger` rows
outside the shared `ledgerMutationStatements` path. ORDER, REFUND, delegated
order, replacement refund, TOPUP, reconstruction/restore, and admin balance
mutation paths all converge there. The cleanup script's mirror reset is test
maintenance, not a production transaction writer.

## Code repair

The code now uses the sequence-backed `authoritativeBalanceProjection` for
every shared ledger mutation invariant, with `users.balance` only as the
no-sequenced-ledger fallback. The projection is shared by user reads and the
ledger mutation statements, and the ledger history response now exposes
sequence number, balance_before, balance_after, and reconciliation diagnostics.

Monthly closing remains the latest sequenced ledger row at the requested
month's UTC end boundary. The response exposes whether opening/closing came
from a sequenced row, the exact sequences, the amount-reconciled expected
closing, delta, out-of-period interleaving rows, origin discontinuities, and
propagated rows. It does not silently replace the canonical closing balance
with `opening + additions - deductions`.

## Repair strategy evaluation

### Directly correcting historical `balance_after`

Advantages: preserves transaction amounts and produces a mathematically
continuous chain without adding artificial financial events; the three known
origins and their propagated suffixes can be corrected by removing each
origin's offset from its suffix.

Risks: it mutates immutable ledger history, changes existing audit-visible
balances, and must be done transactionally with a before/after export, an
operator/audit event, and a post-repair full-chain verification. A generic
multi-origin repair must stop rather than assume a single offset.

### Append-only repair ledger rows

Advantages: preserves existing rows and can provide a visible corrective
event with an audit trail.

Risks: it does not repair the historical chain itself; it changes the ending
balance and monthly additions/deductions, so the original period can remain
inconsistent. Inserting a compensating row at the current end also cannot
make old `balance_after` values immutable-and-correct. It is therefore not a
substitute for correcting a bad origin, although it may be appropriate for a
separately approved business adjustment.

Recommendation: do not execute either strategy yet. First approve an
immutable-ledger repair procedure that exports the affected rows, records a
repair audit event, handles the exact origin/propagated suffixes, verifies
all 57 users, and reconciles monthly summaries. The current proposal SQL is a
read-only preview only.

## Reviewable repair preview

The current remote values and the chain-derived preview are:

| employee_id | origin seq | previous balance | amount | corrupted origin after | corrected origin after | corrupted latest | corrected latest | rows to correct | proposed final users.balance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 070214 | 1185 | 800 | -100 | -100 | 700 | 0 | 800 | 17 | 800 |
| 105499 | 1186 | 1015 | -100 | -100 | 915 | 315 | 1330 | 8 | 1330 |
| 121254 | 1178 | 800 | -120 | -120 | 680 | 0 | 800 | 11 | 800 |

The proposed row counts include the origin row and every propagated suffix
row. The propagated sequence numbers are:

- 070214: `1187, 1196, 1203, 1205, 1206, 1214, 1231, 1232, 1234,
  1245, 1246, 1247, 1248, 1263, 1264, 1265`
- 105499: `1188, 1197, 1204, 1236, 1249, 1250, 1251`
- 121254: `1179, 1189, 1190, 1198, 1207, 1212, 1228, 1235, 1266,
  1267`

The origin sequence is not repeated in those lists. The preview corrects each
affected suffix by subtracting the origin delta from `balance_after`; it does
not change amount, type, reference, timestamp, or transaction meaning.

### Monthly summary before and after preview

| employee_id | opening | additions | deductions | current closing | corrected closing | amount-reconciled closing | current delta | corrected delta | after status |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 070214 | 587 | 2213 | 2000 | 0 | 800 | 800 | -800 | 0 | CONSISTENT |
| 105499 | 435 | 2015 | 1435 | 315 | 1330 | 1015 | -700 | +315 | SEQUENCE_DATE_BOUNDARY_MISMATCH |
| 121254 | 501 | 2019 | 1720 | 0 | 800 | 800 | -800 | 0 | CONSISTENT |

105499 retains a separate sequence/date issue after chain correction: sequence
1151 has `occurred_at=2026-08-18` but falls between September sequence rows,
while sequence 1135 is a September row before that sequence-based opening row.
The +315 corrected delta is therefore not silently attributed to stale mirror
corruption.

## 147398 policy options

147398 must not be included in data repair. The sequence chain itself is
continuous; the mismatch comes from defining monthly membership by UTC
`occurred_at` while selecting opening/closing by global sequence order.

Policy options for a future separately reviewed change:

1. Keep sequence-authoritative opening/closing and expose the current boundary
   diagnostic. This preserves historical ledger semantics and requires no
   data mutation.
2. Define the monthly report entirely by sequence cut points, then classify
   rows by those cut points rather than by `occurred_at`. This makes arithmetic
   reconciliation exact but changes the meaning of calendar-month reporting.
3. Keep calendar-month amounts but compute opening from the first in-month
   sequence predecessor, with explicit handling for late-arriving historical
   rows. This is more intuitive for reports but needs a formal late-arrival
   policy and new regression coverage.

No option was selected or implemented in this release.
