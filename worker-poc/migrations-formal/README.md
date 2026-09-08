# Formal D1 migration chain

This directory contains the Strategy B formal schema and is the default
Wrangler migration directory for the formal Worker. It remains separate from
the retained POC migration directory, which is available only through the
explicit `wrangler-poc.jsonc` inspection configuration.

The schema includes the partial uniqueness and append-only reference indexes
used by Wave 3 order, refund, and idempotency mutations. Migration 0001 adds
the committed balance-ledger sequence and per-user opening-balance snapshot
state. The sequence is assigned by an insert trigger because occurred_at is a
business timestamp, not a commit-order key; the snapshot state keeps approved
Option 1 policy boundaries separate from post-cutover ledger consistency.
Migration 0001 backfills any existing formal ledger rows by their insertion
order without changing their timestamps. The formal chain remains exactly
`0000_formal_initial_schema.sql` followed by
`0001_balance_integrity_primitives.sql`.

Apply the chain to an empty local SQLite/D1-compatible database for
verification. Applying a remote migration still requires the later authorized
clean-D1 checkpoint.
