# Menu Item Changes Design

## Goal

Make append-only `menu_item_changes` the authoritative menu-maintenance
source for historical SQL data and future Admin changes, while keeping
`menu_versions` and `menu_items` as deterministic compatibility projections
for existing order foreign keys and order creation.

## Decisions

- The current uncommitted `menu_item_catalog` migration and image-only Admin
  workflow are superseded and must not be applied remotely.
- Each persisted change row is immutable. Admin edits are local drafts; POST
  persists once. There is no PATCH or DELETE in this phase.
- A change row is a complete state for one identity at one effective date.
  Corrections are later effective rows.
- Identity is `(vendor, item_code, variant_key)`. Runtime matching never uses
  display name alone.
- SQL history is imported as 34 source-fact rows, not 88 cumulative snapshot
  rows. Existing 88 SQL snapshots remain unchanged.
- GAS compatibility rows use deterministic variant keys before backfill and
  cannot override SQL authority for 2026-09-02 through 2026-09-10.
- Resolver authority remains SQL historical through 2026-09-10 and live from
  2026-09-11. Post-cutoff Admin changes supersede the live baseline by date.
- The materializer resolves a complete menu state, then idempotently writes a
  compatibility `menu_version` and its `menu_items` rows. Disabled history
  remains in `menu_item_changes` but is omitted from customer-selectable
  projections.
- Orders and `order_items` are never rewritten.

## Schema

`menu_item_changes` contains `menu_item_change_id`, `effective_date`, vendor,
item code, variant key, item name, signed integer price, enabled flag, image
URL, note, source kind, source batch/table/row/record provenance, updater
identity, and timestamps. A unique constraint on
`(vendor, item_code, variant_key, effective_date)` prevents conflicting
states, with lookup indexes for vendor/date and identity/date resolution.

## Backfill

The SQL source facts map to effective dates 2023-04-01, 2025-02-01,
2026-07-01, 2026-08-01, and 2026-09-01. Their 34 rows resolve to cumulative
menu sizes 15, 15, 17, 20, and 21, including `revert1 = -1`.

GAS AP rows are first reconciled to stable explicit variant keys using source
identity/provenance. The mapping is reported and collision-checked before
any insert. Unresolved or non-deterministic identities are not backfilled.

## Admin

The Admin page is `菜單品項維護`, a spreadsheet-style table with filters,
local drafts, signed prices, enabled state, image previews, notes, source
badges, per-item history, and resolved-date preview. Imported SQL/GAS rows are
read-only. The Worker API exposes list/filter, POST, and resolved-preview
operations; persisted changes have no update or delete endpoint.
