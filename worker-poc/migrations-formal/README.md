# Formal D1 migration chain

This directory contains the Strategy B formal schema. It is intentionally
separate from the existing POC migration directory while the formal backend is
being built. The active POC Wrangler binding is not changed by this wave.

The schema includes the partial uniqueness and append-only reference indexes
used by Wave 3 order, refund, and idempotency mutations. It is still a local
formal chain; it is not the active Wrangler migration directory.

Apply the SQL to an empty local SQLite/D1-compatible database for verification.
Changing the active Wrangler migration directory or applying a remote migration
requires the later authorized clean-D1 checkpoint.
