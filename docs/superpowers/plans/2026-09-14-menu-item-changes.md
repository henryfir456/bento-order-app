# Menu Item Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement append-only menu-item change history, deterministic SQL/GAS backfill, compatibility projection, and the table-style Admin workflow.

**Architecture:** `menu_item_changes` is the authoritative full-state history. A shared resolver selects the latest eligible state per exact `(vendor, item_code, variant_key)` identity, while a deterministic materializer projects effective menus into the existing `menu_versions/menu_items` tables used by order foreign keys.

**Tech Stack:** Cloudflare Worker, D1/SQLite, Node test runner, React/Vite, existing identity/permission/audit helpers.

**Spec:** `docs/superpowers/specs/2026-09-14-menu-item-changes-design.md`

## Global Constraints

- `PREFLIGHT_MODE=FAST`; local implementation only; no remote D1 apply or deployment.
- Persisted `menu_item_changes` rows are immutable; POST only, with no PATCH/UPDATE or DELETE endpoint.
- SQL backfill is 34 source facts, not 88 cumulative snapshots.
- SQL authority applies through 2026-09-10; live authority applies from 2026-09-11.
- GAS AP rows require deterministic explicit variants before backfill.
- Existing menu snapshots, Orders, order_items, ledger, and calendar data remain untouched.
- Signed prices are valid and preserved.

---

### Task 1: Replace catalog schema with append-only change schema

**Files:**
- Create: `worker-poc/migrations-formal/0008_menu_item_changes.sql`
- Modify: `worker-poc/migrations-formal/README.md`
- Modify: `worker-poc/tests/formal-schema.test.js`
- Modify: `worker-poc/tests/runtime-config.test.js`

**Interfaces:**
- Produces `menu_item_changes` with full state, provenance, immutable identity/date uniqueness, and lookup indexes.
- Leaves `menu_versions`, `menu_items`, Orders, ledger, and calendar rows unchanged.

- [x] Write migration tests for columns, signed price, enabled constraint, exact unique key, indexes, and absence of historical-table rewrites.
- [x] Replace the uncommitted catalog migration with the 0008 change-history table and document the nine-file formal chain.
- [x] Add migration backfill tests asserting 34 SQL change rows and no duplicate identity/date keys.
- [x] Add deterministic GAS compatibility fixture rows only after variant mapping is explicit and collision-free.
- [x] Run the schema/backfill-focused tests.

### Task 2: Implement shared resolver and deterministic materializer

**Files:**
- Create: `worker-poc/src/domain/menuItemChanges.js`
- Modify: `worker-poc/src/domain/menu.js`
- Modify: `worker-poc/src/domain/orders.js`
- Test: `worker-poc/tests/menu-item-changes.test.js`

**Interfaces:**
- `resolveMenuItemChanges(database, { vendor, targetDate, authority })` returns a complete resolved state grouped by exact identity.
- `materializeMenuVersion(database, { vendor, effectiveDate, sourceKind })` idempotently projects one resolved state into `menu_versions/menu_items`.
- Customer menu preview and order validation consume the same resolver semantics.

- [x] Write failing tests for latest-effective-date resolution, disabled rows, signed prices, exact variants, cutoff authority, and idempotent materialization.
- [x] Implement source-aware authority selection: SQL through 2026-09-10, live/Admin from 2026-09-11, with GAS 2026-09-02 rows excluded from the SQL window.
- [x] Implement deterministic projection IDs and upsert/reconciliation without duplicate snapshots or historical rewrites.
- [x] Keep disabled change rows in history while excluding them from selectable `menu_items` projections.
- [x] Make customer preview and order validation call the same resolved-state function.
- [x] Run the focused resolver/materializer tests.

### Task 3: SQL/GAS backfill and provenance reconciliation

**Files:**
- Modify: `worker-poc/scripts/lib/historical-menu-reconstruction.mjs`
- Modify: `worker-poc/scripts/lib/legacy-sql-adapter.mjs`
- Create: `worker-poc/scripts/lib/menu-item-change-backfill.mjs`
- Test: `worker-poc/tests/menu-item-changes.test.js`

**Interfaces:**
- `buildMenuItemChangeBackfill({ sqlFacts, gasRows, sourceHash })` returns stable change rows, explicit AP mapping, collision report, and cumulative parity evidence.

- [x] Preserve raw SQL item codes and map each of the 34 facts to its month-start effective date and source row.
- [x] Extract GAS AP candidates with source record identity and produce stable variant keys before creating change rows.
- [x] Reject unresolved or colliding `(vendor,item_code,variant_key,effective_date)` rows before mutation.
- [x] Verify resolved SQL menus contain 15/15/17/20/21 items and `revert1 = -1`.
- [x] Verify existing 88 `menu_items` rows and GAS snapshots are not rewritten.
- [x] Run the backfill/reconciliation tests.

### Task 4: Admin API and permissions

**Files:**
- Modify: `worker-poc/src/auth/permissions.js`
- Modify: `worker-poc/src/routes/admin.js`
- Test: `worker-poc/tests/menu-item-changes.test.js`

**Interfaces:**
- `GET /api/admin/menu/changes` supports vendor/date/month/item-code/name/variant filters and per-item history.
- `POST /api/admin/menu/changes` persists one immutable change row and audits the authenticated actor.
- `GET /api/admin/menu/preview` resolves the selected effective date.
- There is no PATCH or DELETE route for persisted changes.

- [x] Add one centralized Admin-only action without authorizing ProxyAdmin/User/View As.
- [x] Validate complete state rows, HTTP(S) image URLs, signed integer prices, date-only effective dates, and explicit variants.
- [x] Return 409 for duplicate identity/effective-date rows and use authenticated actor identity for audit metadata.
- [x] Make imported SQL/GAS rows read-only through response metadata and reject update/delete attempts.
- [x] Run Admin authorization, append-only, duplicate, View As, audit, and preview tests.

### Task 5: Table-style Admin UI and frontend transport

**Files:**
- Create: `src/features/admin/MenuItemChangesManagement.jsx`
- Modify: `src/api/apiClientCore.js`
- Modify: `src/App.jsx`
- Modify: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- Worker client exposes list, POST, and resolved-preview operations only.
- `MenuItemChangesManagement` renders local drafts and immutable saved rows with the approved columns and filters.

- [x] Add `菜單品項維護` with spreadsheet-style columns and vendor/date/month/code/name filters.
- [x] Implement local draft editing, one-time POST, signed prices, enable/disable state, image thumbnail preview, notes, source badges, and variant keys.
- [x] Add per-item history and resolved-date preview using the same Worker resolver.
- [x] Mark imported rows read-only and omit update/delete controls entirely.
- [x] Keep GAS transport without menu-maintenance operations.
- [x] Run frontend contract tests, lint, and build.

### Task 6: Full verification and handoff

**Files:**
- No additional production files.

- [x] Run focused menu-item-change, historical, schema, and frontend tests.
- [x] Run `npm.cmd --prefix worker-poc run test:formal`.
- [x] Run `node --test tests/strict-identity-ledger.test.cjs`.
- [x] Run `npm.cmd run lint` and `npm.cmd run build`.
- [x] Review migration SQL, backfill collision evidence, projection idempotence, and changed-file scope.
- [x] Report A-H evidence and stop at `READY_FOR_REMOTE_MENU_ITEM_CHANGES_APPLY`.
