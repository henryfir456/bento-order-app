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
```

Migration 0002 is intentionally not idempotent when executed as raw SQL: D1
must record it in `d1_migrations` once. The local test database initializer
detects an already-canonical `users.user_id` table and skips reapplying the
chain when reopening an existing local database. A fresh local database still
applies all three files in order.

Apply the chain to an empty local SQLite/D1-compatible database for
verification. Applying a remote migration still requires the later authorized
clean-D1 checkpoint.
