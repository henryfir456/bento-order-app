# Formal D1 migration chain

This directory contains the Strategy B formal schema. It is intentionally
separate from the existing POC migration directory while the formal backend is
being built. The active POC Wrangler binding is not changed by this wave.

The schema includes the partial uniqueness and append-only reference indexes
used by Wave 3 order, refund, and idempotency mutations. Migration 0001 adds
the committed balance-ledger sequence and per-user opening-balance snapshot
state. The sequence is assigned by an insert trigger because occurred_at is a
business timestamp, not a commit-order key; the snapshot state keeps approved
Option 1 policy boundaries separate from post-cutover ledger consistency.
Migration 0001
backfills any existing formal ledger rows by their insertion order without
changing their timestamps. It is still a local formal chain; it is not the
active Wrangler migration directory.

Apply the SQL to an empty local SQLite/D1-compatible database for verification.
Changing the active Wrangler migration directory or applying a remote migration
requires the later authorized clean-D1 checkpoint.
