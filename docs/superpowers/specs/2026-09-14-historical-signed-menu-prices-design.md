# Historical Signed Menu Prices Design

## Approved semantics

Menu prices are signed safe integers for every menu provenance. A negative
price is a legitimate discount item and must survive storage, validation, API
serialization, arithmetic, and display unchanged. `revert1 = -1` is included
in the cumulative SQL-derived 202608 and 202609 menu snapshots.

Historical menu reads use the SQL-derived effective-month snapshot for
`targetDate <= 2026-09-10`; dates after the cutoff retain the existing
canonical/live effective-date resolver. The existing GAS-derived 2026-09-02
row remains untouched. No new total, quantity, or discount-type rule is
introduced.

## Persistence and runtime boundary

Migration 0007 rebuilds `menu_items` without the global non-negative price
check and preserves every other column, default, key, foreign key, index, and
trigger definition. Runtime validators accept signed safe integers for menu
prices while unrelated monetary validation remains unchanged. Both Worker and
frontend calculations use ordinary signed arithmetic.

## Reconciliation boundary

The SQL source is treated as a change log whose latest value per `(tp,
yymm_bento)` is accumulated into five deterministic month-start snapshots:
202304, 202502, 202607, 202608, and 202609. The target contains 5 versions and
88 item rows, with `revert1=-1` present in 202608 and 202609. Remote
reconciliation and mutation are explicitly deferred until after local
verification and separate approval.
