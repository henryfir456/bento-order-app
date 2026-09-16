# Vendor Hub on Main Implementation Plan

> **For agentic workers:** This plan is executed inline in the isolated worktree. The user explicitly requires no commit, push, merge, deploy, or production D1 mutation.

**Goal:** Integrate the Vendor Hub slice onto the current `main` architecture without importing the vendor worktree's obsolete auth, schema, CORS, GAS, or `App.jsx` behavior.

**Architecture:** Add an append-only `vendors` metadata table as formal migration `0010_vendor_metadata.sql`, backfilled from canonicalized `menu_versions` and `calendar_settings` vendor names. Add Worker/domain routes using current identity middleware and global CORS, then connect the existing React app through typed Worker/mock API operations and a focused Vendor Hub component.

**Tech Stack:** React/Vite, formal Cloudflare Worker + D1/SQLite, existing canonical vendor helpers, Node `node:test`, ESLint.

**Spec:** User-provided Vendor Hub integration requirements in the current task; the vendor worktree's spec/plan are reference-only and are not copied.

## Global Constraints

- Keep the current `main` formal migration chain `0000` through `0009`; Vendor Hub is `0010_vendor_metadata.sql`.
- Preserve current employee identity, LINE binding, `registered`, effective identity, View As, Worker authorization, menu history, `menu_item_changes`, `variant_key`, `image_url`, and fallback behavior.
- Use `normalizeMenuVendor` and its canonical/compatibility alias logic; `合十` and `禾拾` map to one vendor entity.
- `menu_image_url` is the vendor snapshot image only; `menu_source_url` is an external link only.
- Vendor GET requires current registered identity; Vendor PATCH requires Admin/ProxyAdmin and rejects View As.
- Use global `applyCorsPolicy`; do not add route-local legacy CORS wrappers or GAS business logic.
- Preserve original worktrees and their pre-existing changes; no reset, checkout, deletion, stash, merge, commit, push, deploy, or remote D1 mutation.

### Task 1: Add canonical vendor schema and domain

**Files:** Create `worker-poc/migrations-formal/0010_vendor_metadata.sql`; modify `worker-poc/migrations-formal/README.md`, `worker-poc/src/domain/vendors.js`, `worker-poc/tests/formal-schema.test.js`, `worker-poc/tests/runtime-config.test.js`, `worker-poc/tests/helpers/formal-fixtures.js`, and create `worker-poc/tests/vendors.test.js`.

- Create the metadata table and enabled/name index.
- Backfill trimmed vendor names from both current menu and calendar sources, mapping `合十` to `禾拾` before deriving deterministic ids.
- Normalize vendor response fields and calculate recent groups/open state from canonical vendor names plus compatibility aliases.
- Keep menu item images out of Vendor Hub domain reads.
- Test table/index shape, migration ordering, canonical alias deduplication, metadata separation, date/deadline state, and recent calendar alias matching.

### Task 2: Reuse current auth and Worker route chain

**Files:** Modify `worker-poc/src/auth/permissions.js`, `worker-poc/src/formalWorker.js`, `worker-poc/tests/permissions.test.js`; create `worker-poc/src/routes/vendors.js`; extend `worker-poc/tests/vendors.test.js`.

- Add `ACTIONS.ADMIN_VENDORS` to current role action sets while leaving guest capabilities and existing actions unchanged.
- Implement only `GET /api/vendors`, `GET /api/vendors/:vendorId`, and `PATCH /api/admin/vendors/:vendorId`.
- Call `requireIdentity` with current `fetchImpl`, `now`, and `allowViewAs` semantics; GET allows View As reads, PATCH rejects it.
- Validate JSON, ids, fields, HTTP(S) URLs, dates, booleans, and empty/unknown patches; audit successful updates with actor snapshots.
- Insert the route into current `formalWorker.js` before generic read-only fallback and rely on its single global CORS decorator.

### Task 3: Add Worker/mock transport operations

**Files:** Modify `src/api/apiClientCore.js`, `src/api/mockGasApi.js`, `src/auth/mockData.js`, `worker-poc/package.json`; create `tests/vendor-hub.test.cjs`.

- Add typed GAS unsupported operations while keeping local mock operations in memory.
- Add Worker GET/GET/PATCH methods using current credential, query, URL encoding, and error semantics.
- Add mock vendor fixtures and cloned per-session metadata, with permission-gated updates.
- Extend the Worker test script only by appending `tests/vendors.test.js`.
- Test API contracts, mock updates, typed GAS gaps, and model/UI source boundaries.

### Task 4: Attach the UI to current App/calendar behavior

**Files:** Create `src/features/vendors/vendorModel.js` and `src/features/vendors/VendorHub.jsx`; modify `src/App.jsx` and `src/features/calendar/CalendarManagement.jsx`.

- Add isolated vendor list/detail/editor states with request invalidation and identity cleanup.
- Add a registered-user entry, Worker/mock reads, explicit GAS unsupported state, and Admin/ProxyAdmin metadata editing guarded by `canAuth('manageVendors')` and View As state.
- Keep the existing `openAdminCalendar`/`setCalendarVendor` flow for opening group management.
- Build calendar select options from canonical loaded vendor/menu/calendar data, dedupe `合十` to `禾拾`, and keep only the `不開團` empty option as a literal fallback.
- Render `menu_image_url` as the only image source and `menu_source_url` as link-only.

### Task 5: Verify and hand off without commit

- Run the user-requested focused Node tests, formal schema/permissions/runtime tests, root strict identity test from `agent.yaml`, `git diff --check`, and `npm.cmd run lint`.
- Do not run build per the user's no-build instruction; report it as NOT RUN.
- Record automated results separately from manual/external evidence; real LIFF, View As, production Worker/D1, and Cloudflare asset rendering remain NOT VERIFIED unless independently evidenced.
- Inspect final branch/worktree state and list added, modified, untouched, and any unresolved conflicts.
