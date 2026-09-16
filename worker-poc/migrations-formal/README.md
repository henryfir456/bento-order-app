# Formal D1 migration chain

This directory contains the Strategy B formal schema and is the default
Wrangler migration directory for the formal Worker. It remains separate from
the retained POC migration directory, which is available only through the
explicit `wrangler-poc.jsonc` inspection configuration.

The schema includes the partial uniqueness and append-only reference indexes
used by formal order, refund, balance, and idempotency mutations. Migration
0001 adds the committed balance-ledger sequence and per-user opening-balance
snapshot state. Migration 0002 is the one-time complete relational rekey: it
rebuilds identity-dependent tables so `users.user_id` is the foreign-key
identity, adds textual `employee_id`, keeps nullable unique `line_user_id` as
an external identity, preserves event snapshots, and adds employee guest
sessions. The sequence is assigned by an insert trigger because occurred_at is
a business timestamp, not a commit-order key; the snapshot state keeps
opening-balance policy boundaries separate from post-cutover ledger
consistency. Migration 0001 backfills any existing formal ledger rows by
insertion order without changing their timestamps.

The formal chain is exactly:

```text
0000_formal_initial_schema.sql
0001_balance_integrity_primitives.sql
0002_canonical_identity_rekey.sql  # one-time rebuild of an existing formal DB
0003_provisional_employee_identity.sql
0004_employee_roster_verification_source.sql
0005_nullable_user_pickup_floor.sql # local policy-gate schema for incomplete profiles
0006_historical_order_semantics.sql # completed legacy Orders and signed historical order money
0007_signed_menu_prices.sql         # signed menu price values with preserved menu-item dependencies
0008_menu_item_changes.sql           # append-only authoritative menu change history
0009_topup_method.sql                # nullable structured payment method for new top-ups
0010_vendor_metadata.sql              # canonical vendor metadata and menu snapshot links
```

Migrations 0002, 0003, 0004, and 0005 are intentionally forward-only when executed as raw
SQL: D1 must record each file in `d1_migrations` once. The local test database initializer
detects an already-canonical `users.user_id` table and skips reapplying the
chain when reopening an existing local database. A fresh local database applies
all eleven files in order. Migration 0003 defaults existing users to
`VERIFIED`, adds the nullable provisional guest-session shape, and preserves
old Worker guest-session inserts that omit the new columns.
Migration 0004 creates an empty, provenance-bearing `employee_roster`
verification source. It deliberately has no unique employee-ID constraint so
duplicate source records remain representable and auto-verification fails
closed on ambiguity. Canonical `users.employee_id` uniqueness remains the
exact-text ownership guard, and `users_employee_id_normalized_unique`
enforces case-insensitive ownership after trim/case normalization. Any
pre-existing normalized collision must fail migration closed. Migration 0005
is the local policy-gate rebuild that makes `users.pickup_floor` nullable while
retaining the non-null valid-floor domain and canonical identity indexes. It is
not a remote approval or import authorization.
Migration 0006 adds the completed historical Order status and narrowly scoped
legacy-import negative order-item guards. Migration 0007 rebuilds
`menu_items` and its dependent `order_items` table so menu prices are signed
integer business values, while preserving the existing order-item guards,
indexes, defaults, keys, and foreign keys. It does not add a negative-price
provenance exception: signed menu prices are valid for every menu version.
Migration 0008 adds the append-only `menu_item_changes` source of truth and a
non-destructive `variant_key` column to compatibility `menu_items`. It does
not backfill source data, rewrite historical menu snapshots, or add cascade
relationships into menu, order, ledger, or calendar data. Source backfill is
performed separately from reviewed SQL/GAS facts.
Migration 0009 adds nullable `balance_ledger.topup_method` for structured
payment-method provenance on new Admin top-ups. It does not backfill existing
ledger rows; historical NULL values remain NULL and are not inferred.
Migration 0010 creates the canonical `vendors` metadata table and backfills
vendor names from current menu/calendar records. The historical alias `合十`
is stored as canonical `禾拾`; the migration does not rewrite menu snapshots,
orders, calendar rows, or item-level image fallback data.

## Recovery procedure

The reviewed recovery sequence for a future controlled cutover is:

```text
backup -> apply migration -> verify schema/counts/foreign keys -> restore backup if verification fails
```

The backup is an independently retained export of the exact target before any
remote write. Local verification uses a disposable SQLite database and does
not exercise the remote path. Migration 0002 is a one-time rebuild, so this
backup/restore procedure is the recovery boundary rather than an assumption
that a partially completed remote D1 migration can be rolled back by rerunning
SQL.

Apply the chain to an empty local SQLite/D1-compatible database for
verification. Applying a remote migration still requires the later authorized
clean-D1 checkpoint.
