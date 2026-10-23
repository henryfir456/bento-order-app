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

The migration files in this checkout are listed in execution order:

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
0011_menu_item_change_revisions.sql   # legacy/raw boundary and normalized revision ordering
0012_vendor_daily_flavors.sql        # vendor daily flavor source
0013_announcement_images.sql         # announcement image metadata
0014_taiwan_government_holidays.sql  # public holiday source
0015_invalid_employee_marker.sql     # explicit invalid employee marker for disabled canonical users
0016_announcement_user_preferences.sql # per-user read/dismissal state and new-announcement popup eligibility
0017_protected_account_auth_audit.sql # controlled protected-account mapping and deidentified append-only denials
0018_vendor_principals_and_memberships.sql # separate Vendor login principals and canonical vendor scopes
0019_vendor_order_settlements.sql # canonical order vendor ID column and append-only daily settlement records
0020_safe_vendor_order_identity_resolution.sql # reviewed historical menu-version mapping and non-destructive vendor scoping
0021_verified_vendor_settlement_sources.sql # keep historical snapshots/allocations untrusted until verified
0022_vendor_legacy_name_attribution.sql # reviewed shop-name attribution of whole legacy orders
0023_order_line_canonical_identities.sql # reviewed canonical vendor/item identity per old order line (append-only overlay)
0024_user_notifications.sql # bell notifications per user (group cancel refunds, vendor order close)
```

Migrations 0002, 0003, 0004, and 0005 are intentionally forward-only when executed as raw
SQL: D1 must record each file in `d1_migrations` once. The local test database initializer
detects an already-canonical `users.user_id` table and skips reapplying the
chain when reopening an existing local database. A fresh local database applies
all twenty-four files in order. Migration 0003 defaults existing users to
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
Migration 0011 rebuilds only the append-only `menu_item_changes` table to add
the explicit `identity_schema_version` boundary. Existing rows are copied as
legacy v1 without changing any stored field, legacy identity uniqueness is
retained by a partial unique index, and normalized v2 rows receive a persisted
insert sequence in `menu_item_change_sequence`. The one-time backfill may use
the pre-rebuild table's `rowid`; runtime resolution uses only the persisted
sequence. No menu history, snapshots, orders, or order items are rewritten.
Migration 0015 adds a nullable, constrained `users.invalid_reason` marker and
an audit lookup index. Existing user rows retain their values; the migration
does not disable, rename, rebind, or otherwise modify any individual account.
Migration 0016 leaves existing announcements ineligible for automatic popups,
adds an eligibility timestamp for newly created announcements, and stores
read and popup-dismissal timestamps independently per canonical user and
announcement. It does not seed user preference rows.
Migration 0017 adds `protected_account_user_mappings`, keyed by a non-sensitive
account key and the canonical `users.user_id`, plus a separate append-only
audit for denied access. `RESERVED_VENDOR_OWNER` protects the legacy LINE
owner from Issue #122; it is not a generic Vendor-principal mapping. The
canonical mapping preserves identity if an employee identifier changes. The
audit stores only a random event ID, authentication mode, constrained reason
code, and timestamp; it has no user, employee, or LINE identity columns. The
mapping table remains empty after migration; controlled setup populates it
only after owner authorization is established. No mapping, user, account,
order, or ledger row is seeded or changed by migration 0017. A missing mapping
does not globally return 503 or block unrelated business APIs. The formal
Worker cutover must not proceed until the controlled conversion has populated
the owner mapping; the runbook enforces that ordering before the new Worker is
deployed. After setup, `users.user_id` is the canonical protected identity.
`UNVERIFIED` alone does not reject the confirmed existing LINE owner, and no
migration or conversion changes verification status. It follows the
announcement-preference schema in migration 0016.

Migration 0018 adds a separate nullable `vendor_principals.vendor_login_id`,
case-normalized uniqueness and employee-ID collision guards, plus canonical
Vendor memberships. Vendor login aliases are distinct from
`users.employee_id`, `users.role`, and `vendors.vendor_id`; existing users
remain `User` in storage. Worker role projection derives `Vendor` only from a
Vendor principal, and API scope requires that same canonical user to have an
active membership and the corresponding enabled `vendors` row. The Worker
rejects Vendor principals and Vendor login aliases on employee_guest sessions,
employee order targets, and employee balance mutations. Migration 0018 does
not assign any identity or populate memberships. 禾拾's login alias is
set only by the controlled, rerunnable conversion procedure in
[`docs/VENDOR_OWNER_IDENTITY_RUNBOOK.md`](../../docs/VENDOR_OWNER_IDENTITY_RUNBOOK.md);
that procedure preserves the canonical user ID, existing LINE binding,
the existing employee ID, `role = User`, verification status, historical orders,
ledger and payment records.
Migration 0019 adds a nullable `orders.vendor_id` reference and the append-only
vendor settlement records. It deliberately does not backfill historical orders
or infer identity from `orders.vendor` text or aliases. Migration 0020 adds an
append-only reviewed mapping from exact `menu_version_id` plus its effective
date to a canonical `vendor_id`; vendor order and settlement reads include a
historical order only when every line has a matching menu item/version, the
mapping is current for that date, and all lines resolve to one vendor. Missing,
ambiguous, mixed-vendor, mismatched-code, or future-effective rows remain
unresolved. New Worker-created orders write `vendor_id` directly and are
recorded in an immutable assignment table. Migration 0020 also removes the
name/alias-driven triggers from the earlier 0019 revision without rewriting
existing order rows. Migration 0021 preserves pre-existing daily snapshots and
allocations with a NULL attribution basis so they cannot be used by Vendor
reads or authorize new allocations; new Worker-generated snapshots and
allocations carry a canonical attribution marker. A verified snapshot only
caps the receivable while current active orders still support it: both
allocation insertion and positive allocation adjustments are limited by the
lower of the latest verified snapshot and current canonical-attributed
active-order total. Without a verified snapshot, triggers use the current total
alone. Negative adjustments may reduce an allocation only to zero or above,
even when other existing allocations temporarily keep the day's total above
the current receivable; this allows safe incremental correction and reversal.
These rules prevent an append-only snapshot from authorizing new allocations
after an order is cancelled, while remaining conservative if orders are added
after the snapshot. New snapshots append at a revision above all historical
rows; old settlement data is never edited or deleted. Transfer registrations,
date allocations, allocation corrections, and vendor acknowledgement/dispute/resolution/reversal
history remain append-only and separate from the employee ledger. Allocations
are constrained to integer TWD, the registered transfer amount, and the day's
current resolved receivable; later order changes create a new snapshot revision
and require an explicit allocation correction or whole-transfer reversal to
reconcile an over-allocation. Reversal appends allocation offsets and a
terminal payment event; it does not delete or rewrite the original transfer.
Formal D1 application requires the later reviewed migration and backup gates;
this repository migration is not evidence that any remote schema changed.

## Recovery procedure

The reviewed recovery sequence for a future controlled cutover is:

```text
independent backup -> verify recovery in an isolated target -> apply migration -> verify schema/counts/foreign keys -> if verification fails, restore only after data reconciliation and explicit authorization
```

The backup is an independently retained export of the exact target before any
remote write. Local verification uses a disposable SQLite database and does
not exercise the remote path. Migration 0002 is a one-time rebuild, so this
backup/restore procedure is the recovery boundary rather than an assumption
that a partially completed remote D1 migration can be rolled back by rerunning
SQL. Follow `../../docs/D1_BACKUP_AND_MIGRATION_RUNBOOK.md` for the storage, retention,
readback, restore-drill, and migration gates. A failed production migration
must stop the release; restoring production is not automatic because it may
overwrite valid writes created after the backup. Evaluate that data difference
and obtain explicit authorization before a production restore.

Apply the chain to an empty local SQLite/D1-compatible database for
verification. Applying a remote migration still requires the later authorized
clean-D1 checkpoint.
