# Historical Signed Menu Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add globally valid signed menu prices and deterministic SQL-derived historical menu snapshots without applying remote D1 changes.

**Architecture:** Rebuild only `menu_items` in migration 0007; use one signed-safe-integer menu validator; add a provenance-aware historical menu resolver and pure snapshot/reconciliation helpers; preserve the existing post-cutoff resolver and signed arithmetic in all read/write projections.

**Tech Stack:** SQLite/D1 SQL migrations, Cloudflare Worker JavaScript, React/Vite, Node test runner.

**Spec:** [2026-09-14-historical-signed-menu-prices-design.md](../specs/2026-09-14-historical-signed-menu-prices-design.md)

## Global Constraints

- Do not apply migration 0007 remotely.
- Do not modify historical Orders, ledger, Users, Likes, or GAS files.
- Preserve all existing user changes and unrelated constraints/behavior.
- Do not add minimum-total, quantity, discount-type, or other new business rules.
- Do not run GAS-only suites.

## Tasks

- [ ] Inspect current menu schema, dependent foreign keys/indexes/triggers, validators, resolvers, arithmetic, and test helpers.
- [ ] Add migration 0007 with a safe `menu_items` rebuild that removes only `price >= 0`.
- [ ] Add deterministic SQL historical snapshot and reconciliation helpers for 5 versions / 88 items, preserving `revert1=-1`.
- [ ] Update Worker/frontend menu-price validation and arithmetic only where needed; keep post-cutoff resolver and live-order behavior unchanged.
- [ ] Add regression coverage for signed storage, snapshots, API/display/arithmetic, cutoff resolver behavior, read-only historical orders, migration rollback, and FK integrity.
- [ ] Run the declared local verification commands plus focused tests, then report remote mutation plan without executing it.
