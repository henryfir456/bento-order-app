# Formal Worker + D1 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GAS backend with a formally specified Cloudflare Worker + D1 backend through a clean Strategy B schema, deterministic local importer, authenticated domain APIs, transaction-safe orders and balances, and a direct React cutover after every backend gate passes.
**Architecture:** Worker owns authentication, authorization, domain rules, and D1 persistence. D1 is the formal source of truth. GAS and the workbook are legacy references; the workbook is read locally by a one-time importer. Authenticated actor, View As subject, and effective read subject remain separate.
**Tech Stack:** Cloudflare Workers, D1/SQLite, prepared SQL statements and transactional batches, JavaScript modules, Node test runner, React/Vite/LIFF during the final direct cutover.
**Spec:** docs/superpowers/specs/2026-09-08-formal-worker-d1-backend-design.md

## Global Constraints

- Do not run another GAS live benchmark.
- Do not build a dual-backend migration, adapter, feature flag, or VITE_BACKEND_MODE.
- Keep React on GAS until all backend gates and required manual evidence are PASS.
- Do not deploy, push, commit, or perform a remote D1 destructive reset during this execution session.
- Preserve the existing GAS behavior that an order may make a balance negative; do not add an insufficient-balance business rule in this replacement.
- The real workbook is a local-only importer input and must never be committed.
- Duplicate menu rows remain separate; generate stable internal menu_item_id values and never make legacy item_id unique.
- Orphan orders go to importer quarantine without being dropped or assigned to an inferred user.
- Apply the approved Option 1 migration policy: preserve signed Users.balance snapshots operationally, quarantine incomplete ledger evidence, and defer any opening adjustment.
- Store money as INTEGER, business dates as YYYY-MM-DD, and event timestamps as UTC.
- Preserve authenticated identity, View As identity, and effective identity as separate fields.
- Do not trust client-provided userId, role, name, balance, or View As values for authorization.
- Preserve all staged, unstaged, and untracked user work before each implementation task.
- Do not delete GAS source in this implementation sequence; perform removal assessment only after cutover evidence.
- Use the repository-declared commands and manual verification requirements from agent.yaml.

---

## Plan overview

The work is executed in eight waves:

1. Formal schema and importer validation/quarantine skeleton.
2. Authentication, registration, identity context, and read-only APIs.
3. Transaction-safe orders, replacement, cancellation, deadlines, and idempotency.
4. Ledger-backed balances, history, and top-up.
5. Admin, permissions, View As, calendar, menu, announcements, and audit.
6. Local workbook import and reconciliation.
7. Backend verification and required manual/external evidence.
8. Direct React-to-Worker cutover and post-cutover removal assessment.

Execution tracking is maintained below. Completed Wave 0 through Wave 6
implementation tasks are marked [x]. Option 1 snapshot-only migration policy
is approved; Wave 6 real-workbook review remains pending because the local
workbook is not present in this workspace.

## Wave 0 — execution boundary and formal baseline

### Task 0.1: Re-run governance preflight before implementation

**Files:** repository root, agent.yaml, .agents/skills/ap-safe-preflight, Git state.

- [x] Run the repository-declared safe preflight from .agents/skills/ap-safe-preflight.
- [x] Record the Git root, current branch, staged diff, unstaged diff, and untracked files before touching implementation files.
- [x] Confirm agent.yaml schema, declared skill paths, required versions, and verification commands.
- [x] Stop if the manifest, required skill path, or repository instructions are invalid.
- [x] Create a task ledger entry listing every pre-existing change that must remain intact.

**Verification:** preflight report PASS; no user-owned change is overwritten.

### Task 0.2: Establish the formal migration boundary without touching remote D1

**Files:** worker-poc/migrations-formal/0000_formal_initial_schema.sql,
worker-poc/migrations-formal/README.md,
worker-poc/wrangler.jsonc, worker-poc/migrations/0000_initial_schema.sql,
worker-poc/migrations/0001_bootstrap_parity.sql.

- [x] Keep the existing POC migration files identifiable as POC reference material.
- [x] Add a new formal migration directory and place the complete formal schema in 0000_formal_initial_schema.sql.
- [x] Do not make the formal migration depend on POC tables, POC overlay columns, or POC seed rows.
- [x] Keep the inventory negative finding explicit: no MenuOverrides sheet, GAS function, or React action exists in the inspected baseline, so no override table is invented.
- [x] Add a documented local verification path for the formal migration without changing the active POC binding yet.
- [x] Defer changing the active database name, database ID, or migration directory until a separately authorized clean-D1 checkpoint.

**Verification:** a local formal migration can be applied to an empty test database; existing POC migration tests remain attributable to the POC baseline.

## Wave 1 — schema, importer contract, and quarantine skeleton

### Task 1.1: Implement the formal D1 schema

**Files:** worker-poc/migrations-formal/0000_formal_initial_schema.sql,
worker-poc/tests/formal-schema.test.js.

- [x] Create users with line_user_id primary key, integer balance, constrained role, floor, display name, and UTC timestamps.
- [x] Create calendar_settings, likes, menu_versions, menu_items, announcements, orders, order_items, order_status_history, balance_ledger, idempotency_keys, admin_audit_log, import_batches, and import_quarantine.
- [x] Add foreign keys, CHECK constraints, composite keys, and indexes from the spec.
- [x] Ensure menu_items has no unique constraint on legacy_item_id or on the legacy date/vendor/item_id tuple.
- [x] Ensure orders are never physically deleted by the formal data model.
- [x] Add indexes for active orders by actor/date, menu lookup by version and legacy ID, announcements by date window, ledger by actor/month, and quarantine review state.
- [x] Add a schema test that introspects sqlite_master and PRAGMA table_info/index_list/foreign_key_list.

**Verification:** formal-schema.test.js proves integer monetary columns, key constraints, duplicate-menu acceptance, foreign-key relationships, and required indexes on an empty local D1 database.

### Task 1.2: Add deterministic workbook reader and normalized contract

**Files:** worker-poc/scripts/import-legacy-workbook.mjs,
worker-poc/scripts/lib/workbook-reader.mjs,
worker-poc/scripts/lib/import-contract.mjs,
worker-poc/scripts/lib/import-normalizer.mjs,
worker-poc/tests/importer.test.js.

- [x] Define readLegacyWorkbook(inputPath, { adapter }) with an injected reader adapter so validation/quarantine can be tested without network-installed packages or real workbook data.
- [x] Implement the reader contract to read only the required sheets and preserve source sheet/row numbers; keep the concrete XLSX package adapter for the local-import execution task in Wave 6.
- [x] Implement normalizeLegacyWorkbook(workbook, { sourceHash, importerVersion }) returning typed Settings, Likes, Users, Menu, Announcements, Orders, and TopupHistory records.
- [x] Normalize business dates to YYYY-MM-DD, timestamps to UTC where unambiguous, integer prices/amounts, boolean enabled values, and blank cells to explicit nulls.
- [x] Generate menu_item_id deterministically from source hash, sheet, and row; never derive uniqueness from legacy item_id.
- [x] Preserve raw source row references in every normalized record without embedding raw workbook content in source code.

**Verification:** importer unit fixtures inject a deterministic reader adapter, prove repeated reads of the same synthetic workbook produce byte-equivalent normalized IDs, and preserve duplicate menu rows.

### Task 1.3: Implement validation and quarantine report generation

**Files:** worker-poc/scripts/import-legacy-workbook.mjs,
worker-poc/scripts/lib/import-validator.mjs,
worker-poc/scripts/lib/quarantine-report.mjs,
worker-poc/tests/importer.test.js,
worker-poc/.gitignore.

- [x] Implement validateImport(normalized) returning accepted rows, warnings, and quarantined rows with reason codes.
- [x] Validate required headers and emit a shape quarantine record before any future staging when a required sheet or column is missing.
- [x] Emit a duplicate-menu warning while accepting each duplicate row with its own stable internal key.
- [x] Quarantine blank or unresolved order LINE user IDs with ORPHAN_ORDER_USER.
- [x] Quarantine incomplete balance/ledger reconciliation with INCOMPLETE_LEDGER_POLICY without creating synthetic ledger rows.
- [x] Quarantine invalid dates, invalid roles, malformed money, invalid quantities, unknown references, and impossible status transitions with specific reason codes.
- [x] Write reports only under an ignored local importer output directory; reject report paths inside tracked fixture directories.
- [x] Expose a deterministic CLI: node scripts/import-legacy-workbook.mjs --input <local-workbook> --mode validate --output <ignored-report-dir>.

**Verification:** importer.test.js covers all reason codes above, proves orphan rows are retained in quarantine, proves no guessed user is emitted, and proves no real workbook path is embedded in fixtures.

### Task 1.4: Add synthetic fixtures and importer reconciliation summaries

**Files:** worker-poc/tests/fixtures/formal-workbook/, worker-poc/tests/fixtures/formal-import-expected.json, worker-poc/scripts/lib/reconciliation.mjs, worker-poc/tests/reconciliation.test.js, worker-poc/package.json.

- [x] Create synthetic workbook fixtures containing one duplicate menu key group, one resolvable order, one orphan order, an incomplete ledger, disabled menu rows, and an announcement window.
- [x] Keep fixture identities synthetic and deterministic.
- [x] Implement reconciliation output for source counts, accepted counts, warnings, quarantines, unresolved references, and balance gaps.
- [x] Assert that duplicate menu rows are counted separately and orphan rows are not counted as imported orders.
- [x] Assert that balance snapshots are retained as evidence but do not become fabricated TOPUP, ORDER, REFUND, or ADJUSTMENT rows.

**Verification:** reconciliation.test.js matches the expected report and remains independent of the real workbook.

## Wave 2 — authentication, identity, and read-only APIs

### Task 2.1: Implement LINE token verification and request identity context

**Files:** worker-poc/src/auth/lineProfile.js, worker-poc/src/auth/identity.js, worker-poc/src/http/authMiddleware.js, worker-poc/src/db/users.js, worker-poc/tests/auth.test.js.

- [x] Implement fetchLineProfile(accessToken, fetchImpl) using the LINE profile endpoint and Bearer authorization.
- [x] Reject missing, malformed, expired, or failed profile responses with stable authentication errors.
- [x] Implement resolveCanonicalIdentity(request, env, fetchImpl) returning actor, registered user, effectiveSubject, and optional viewAs metadata.
- [x] Derive actor line_user_id and display name only from the verified profile response and D1 user row.
- [x] Ignore query/body userId values for actor selection.
- [x] Allow View As only for an authorized read request; keep actor and effective subject in separate context fields.

**Verification:** auth and identity tests prove a client cannot impersonate another user by changing query/body identity fields and that View As never changes the authorization actor.

### Task 2.2: Implement registration and permission primitives

**Files:** worker-poc/src/auth/permissions.js, worker-poc/src/domain/users.js, worker-poc/src/db/transactions.js, worker-poc/src/routes/me.js, worker-poc/tests/permissions.test.js, worker-poc/tests/registration.test.js.

- [x] Implement registerUser(db, actor, input) with allowed-floor validation and an atomic insert-if-absent operation.
- [x] Implement getMe(identityContext) and updatePickupFloor(db, identityContext, floor).
- [x] Implement can(role, action) from the fixed User/ProxyAdmin/Admin matrix.
- [x] Reject role strings outside the formal constraint and reject client role/balance/name overrides.
- [x] Write an audit event for registration and floor changes with actor equal to target.

**Verification:** registration and permission tests cover registered/unregistered flows, allowed floors, role matrix, actor-target equality, and rejection of client-supplied authority fields.

### Task 2.3: Implement read-only menu, calendar, announcement, and order projections

**Files:** worker-poc/src/domain/deadlines.js, worker-poc/src/domain/calendar.js, worker-poc/src/domain/menu.js, worker-poc/src/domain/announcements.js, worker-poc/src/domain/ordersRead.js, worker-poc/src/routes/readOnly.js, worker-poc/src/formalWorker.js, worker-poc/tests/read-only.test.js.

- [x] Implement deadline calculation for modes A and B using Asia/Taipei business dates and UTC comparison.
- [x] Implement latest menu version selection by vendor and target date.
- [x] Filter disabled menu items from customer order-page responses while retaining them for admin/import inspection.
- [x] Implement inclusive announcement windows and legacy ordering by start date then source order.
- [x] Implement actor-scoped active order map and order-page projection.
- [x] Implement calendar likes and vendor/mode projection without trusting a client user ID.
- [x] Expose GET /api/me, GET /api/calendar, GET /api/bootstrap, GET /api/bootstrap/deferred, GET /api/orders/map, and GET /api/order-page.

**Verification:** read-only.test.js proves response shape compatibility for current React consumers, deadline boundaries, enabled filtering, announcement ordering, and actor scoping.

## Wave 3 — transactional orders

### Task 3.1: Add D1 transaction and idempotency helpers

**Files:** worker-poc/src/db/transactions.js, worker-poc/src/db/idempotency.js, worker-poc/src/http/errors.js, worker-poc/tests/transaction.test.js, worker-poc/tests/idempotency.test.js.

- [x] Implement prepared-statement helpers that reject interpolated user input.
- [x] Implement runMutationBatch(db, statements) using D1 batch semantics for atomic mutation sequences.
- [x] Implement beginIdempotentOperation and completeIdempotentOperation with actor, operation, key, and request hash.
- [x] Return the stored response for a repeated completed request with the same request hash.
- [x] Reject a reused idempotency key with a different request hash.
- [x] Map transaction failures to stable public error codes without exposing SQL details.

**Verification:** transaction and idempotency tests prove rollback on injected statement failure and one-result behavior for repeated mutation requests.

### Task 3.2: Implement order creation and replacement

**Files:** worker-poc/src/domain/orders.js, worker-poc/src/routes/orders.js, worker-poc/tests/orders-create.test.js.

- [x] Implement createOrReplaceOrder(db, identityContext, input, clock).
- [x] Load menu price, enabled state, vendor, deadline, and actor balance from D1; never trust client price or subtotal.
- [x] Normalize positive integer quantities, omit zero quantities, merge repeated internal menu keys only when the formal request contract permits it, and reject invalid values.
- [x] In one transaction, resolve idempotency, cancel/refund a prior active order when replacement is requested, read the current integer balance, apply the exact debit while preserving GAS negative-balance behavior, insert parent and line snapshots, append status history and ledger rows, and complete idempotency.
- [x] Preserve menu_item_id when resolved and always preserve legacy_item_id/item snapshot fields.
- [x] Reject an order for a quarantined/unregistered actor and do not create a guessed account.

**Verification:** orders-create.test.js covers server-side pricing, deadline closure, negative-balance compatibility, replacement refund/deduction, duplicate menu internal keys, status history, and balance conservation.

### Task 3.3: Implement cancellation

**Files:** worker-poc/src/domain/orders.js, worker-poc/src/routes/orders.js, worker-poc/tests/orders-cancel.test.js.

- [x] Implement cancelOrder(db, identityContext, orderId, idempotencyKey, clock).
- [x] Require the order to be ACTIVE, owned by the actor, and within the deadline rule.
- [x] In one transaction, refund the exact stored total, mark the parent CANCELLED, append status history, append REFUND ledger row, and complete idempotency.
- [x] Make repeated cancellation return the stored result or a stable already-cancelled error without a second refund.

**Verification:** orders-cancel.test.js proves ownership, deadline, one-refund, cancellation state, and idempotent retry behavior.

### Task 3.4: Add concurrency and deadline race coverage

**Files:** worker-poc/tests/orders-concurrency.test.js, worker-poc/tests/deadline.test.js, worker-poc/src/domain/deadlines.js.

- [x] Freeze time around mode A and mode B boundary instants and assert open/closed behavior.
- [x] Run competing replacement/cancel/top-up-shaped balance mutation test operations against the same synthetic user.
- [x] Assert that competing order/cancel/top-up-shaped mutations do not lose a balance update, issue a duplicate refund, or commit an order state that disagrees with its ledger state.
- [x] Assert that competing replacement requests cannot create two active replacement orders for the same actor/date and that competing retries with the same idempotency key produce one result.
- [x] Record the D1 serialization limitation as a test-enforced retry/conflict policy rather than silently ignoring a conflict.

**Verification:** deadline and concurrency tests pass locally with deterministic clocks and prove no lost update, duplicate refund, or inconsistent ledger/order state.

## Wave 4 — balance ledger

### Task 4.1: Implement ledger repository and balance invariants

**Files:** worker-poc/src/domain/ledger.js, worker-poc/src/db/ledgerQueries.js, worker-poc/tests/ledger.test.js.

- [x] Implement appendLedgerEntry(db, entry) with integer amount, balance_after, type, reference, operator, and UTC timestamp validation.
- [x] Require every ORDER and REFUND ledger row to reference an order mutation.
- [x] Require every TOPUP row to reference an audited admin operation.
- [x] Keep ledger rows append-only and update users.balance in the same transaction.
- [x] Provide month filtering by UTC timestamp while presenting the existing business-date context to the UI.

**Verification:** ledger.test.js proves amount/balance conservation for order, refund, and top-up sequences and rejects floating-point or orphan ledger rows.

### Task 4.2: Implement history and admin top-up

**Files:** worker-poc/src/routes/balance.js, worker-poc/src/routes/admin.js, worker-poc/tests/balance-history.test.js, worker-poc/tests/admin-topup.test.js.

- [x] Expose GET /api/me/balance/history?month=YYYY-MM from ledger rows rather than reconstructing missing history.
- [x] Expose POST /api/admin/balances/top-up with explicit target, integer amount, idempotency key, note, and audit attribution.
- [x] Reject non-admin actors, non-positive amounts, unknown targets, and idempotency conflicts.
- [x] Return a policy-boundary response for legacy users whose opening balance has not yet been promoted by an approved policy.

**Verification:** history and top-up tests prove actor scope, admin scope, integer amounts, audit rows, idempotency, and no fabricated opening transaction.

### Task 4.3: Encode opening-balance and adjustment policy as a gate

**Files:** worker-poc/docs/opening-balance-policy.md, worker-poc/tests/opening-balance-policy.test.js, worker-poc/scripts/reconcile-balances.mjs.

- [x] Produce a local reconciliation report comparing Users.balance, TopupHistory, order effects, and imported quarantine rows.
- [x] Record the approved Option 1 policy: import signed Users.balance values as operational snapshots, including zero and negative balances.
- [x] Keep incomplete or unverifiable TopupHistory rows quarantined as legacy evidence; do not promote them into the formal ledger.
- [x] Expose OPENING_BALANCE_POLICY_REQUIRED where balance history is not fully explained by formal ledger entries.
- [x] Defer any opening ADJUSTMENT; a later promotion requires a separate reviewed policy and rollback/compensation rules.
- [x] Do not add a synthetic ledger row merely to make totals appear reconciled.

**Verification:** opening-balance-policy.test.js proves the approved snapshot-only behavior does not fabricate a legacy ledger row; any future explicit adjustment path still fails closed without separately reviewed policy metadata.

## Wave 5 — admin, calendar, and audit

### Task 5.1: Implement calendar settings, likes, and announcements

**Files:** worker-poc/src/routes/calendar.js, worker-poc/src/domain/calendar.js, worker-poc/src/domain/announcements.js, worker-poc/tests/calendar-admin.test.js, worker-poc/tests/likes.test.js, worker-poc/tests/announcements.test.js.

- [x] Implement admin vendor/mode upsert with explicit A/B mode and audit event.
- [x] Implement like toggle with composite-key idempotency and the legacy vendor side effect only when the formal rule allows it.
- [x] Implement active announcement selection with inclusive date range and deterministic ordering.
- [x] Preserve blank vendor settings and distinguish configured vendor from a like-created default.

**Verification:** calendar, likes, and announcements tests cover date boundaries, role checks, duplicate toggles, vendor side effects, and response ordering.

### Task 5.2: Implement admin summary and member views

**Files:** worker-poc/src/domain/adminSummary.js, worker-poc/src/routes/admin.js, worker-poc/tests/admin-summary.test.js.

- [x] Aggregate only ACTIVE orders for the requested business date.
- [x] Preserve vendor, pickup floor, item, quantity, and total projections used by the existing admin UI.
- [x] Enforce ProxyAdmin read capabilities without granting member balances, top-up, menu, calendar, role, or View As mutation capabilities.
- [x] Enforce Admin-only member balance and role views.
- [x] Record admin read events when policy requires an audit trail for View As or member-sensitive views.

**Verification:** admin-summary.test.js proves role matrix, active-only aggregation, actor/target audit fields, and absence of unauthorized balance data.

### Task 5.3: Implement role assignment and View As read context

**Files:** worker-poc/src/routes/roles.js, worker-poc/src/auth/permissions.js, worker-poc/tests/view-as.test.js, worker-poc/tests/roles.test.js.

- [x] Restrict role assignment to the formal User, ProxyAdmin, and Admin values.
- [x] Require Admin actor and write an admin audit event for every role change.
- [x] Implement explicit View As query handling for permitted read routes.
- [x] Keep mutation routes bound to authenticated actor even when a View As parameter is present.
- [x] Reject View As for User and ProxyAdmin actors.

**Verification:** View As and role tests prove read-only subject switching, actor-preserving authorization, and role validation.

## Wave 6 — local workbook import and reconciliation

### Task 6.1: Stage master data into a clean local formal database

**Files:** worker-poc/scripts/import-legacy-workbook.mjs, worker-poc/scripts/lib/import-writer.js, worker-poc/scripts/reconcile-balances.mjs, worker-poc/tests/import-writer.test.js.

- [x] Add a stage mode that writes only validated master data and accepted transactions to a local formal D1 database.
- [x] Insert users, calendar settings, menu versions/items, announcements, and likes using deterministic IDs.
- [x] Insert only orders with resolved registered users; route orphan orders to import_quarantine.
- [x] Preserve duplicate menu rows as independent menu_items.
- [x] Import signed Users.balance values as operational snapshots; keep incomplete or unverifiable TopupHistory rows in quarantine/evidence.
- [x] Do not create historical TOPUP, ORDER, REFUND, or ADJUSTMENT rows for legacy balances.
- [x] Produce a reconciliation report with source hash, importer version, row counts, and all issue classes.

**Verification:** import-writer.test.js proves rerunning the same source is deterministic and that no quarantined row enters an operational table.

### Task 6.2: Review the real workbook locally without committing it

**Files:** local path gas/便當系統設定.xlsx, ignored importer output directory, worker-poc/.gitignore, worker-poc/package.json, worker-poc/package-lock.json.

- [ ] Run validate mode against the real workbook only from the local filesystem.
- [x] Add and lock the concrete XLSX reader dependency (`xlsx@0.18.5`) for local execution; keep it out of Wave 1 validation tests.
- [ ] Store reports under an ignored path and inspect counts/issues without copying source rows into repository fixtures.
- [ ] Compare the real report to the synthetic importer contract.
- [ ] Confirm duplicate menu, orphan order, and incomplete-ledger classifications are visible in the report.
- [ ] Remove or retain local output only according to the local workspace policy; do not modify workbook cells.

**Verification:** manual local review records the report path outside tracked files; Git status proves the workbook and reports are ignored.

## Wave 6.5 — approved migration policy and real-workbook checkpoint

- [x] Record Option 1 as the approved formal migration policy in the spec,
  plan, and opening-balance policy documentation.
- [x] Discover the expected workbook path by direct filesystem access without
  using Git visibility as an existence check.
- [x] Pin the local XLSX reader dependency without modifying the workbook or
  any remote database.
- [ ] Run validate-only mode against `gas/便當系統設定.xlsx` when the local
  workbook is supplied.
- [ ] Produce a counts-only reconciliation summary and verify ignored local
  artifacts contain no committed raw workbook rows or secrets.

Current checkpoint: `C:\Users\SER\Desktop\AI\80_bento-order-app\gas\便當系統設定.xlsx`
was not found, and no matching filename was found under `C:\Users\SER`.

## Wave 7 — backend gates and external evidence

### Task 7.1: Run Worker-specific automated verification

**Files:** worker-poc/package.json, worker-poc/tests/, worker-poc/migrations-formal/.

- [ ] Run the formal Worker test command from worker-poc/package.json.
- [ ] Run local formal migration application against an empty D1 database.
- [ ] Run schema, importer, auth, identity, permission, order, deadline, concurrency, ledger, admin, and reconciliation tests.
- [ ] Run git diff --check and inspect the complete diff for accidental workbook, secret, or environment-file inclusion.

**Verification:** all Worker-specific automated tests exit zero and the diff contains only intended source, test, and documentation files.

### Task 7.2: Run repository-declared verification in order

**Files:** agent.yaml and repository source.

- [ ] Run node --test tests/strict-identity-ledger.test.cjs.
- [ ] Run npm run lint.
- [ ] Run npm run build.
- [ ] Attribute any pre-existing failure to the baseline before changing unrelated code.
- [ ] Report automated verification separately from manual and external verification.

**Verification:** all required commands exit zero before a backend gate can be marked PASS.

### Task 7.3: Collect required manual and external evidence

**Files:** verification report under docs or an ignored local evidence directory.

- [ ] Verify real LIFF authentication against the Worker token path.
- [ ] Verify View As read behavior and actor/effective identity separation.
- [ ] Verify GAS deployment contract remains intact while React is still on GAS.
- [ ] If and only if separately authorized, perform non-production D1 migration/deployment checks.
- [ ] Do not call a local static test proof of real LIFF, View As, or deployment behavior.

**Verification:** each manual item is labeled PASS, FAIL, NOT RUN, or NOT VERIFIED with date, environment, and evidence reference.

### Task 7.4: Make the cutover decision

**Files:** docs/superpowers/specs/2026-09-08-formal-worker-d1-backend-design.md, docs/superpowers/plans/2026-09-08-formal-worker-d1-backend.md.

- [ ] Confirm every backend gate is PASS, including importer review and required manual evidence.
- [ ] Confirm no unresolved orphan order is silently accepted and opening-balance policy is explicit.
- [ ] Confirm the formal D1 state is clean and the authorized migration procedure is recorded.
- [ ] Obtain a separate cutover approval before editing React or switching its API URL.

**Verification:** a signed-off gate matrix exists; without it, Wave 8 remains blocked.

## Wave 8 — direct React-to-Worker cutover

### Task 8.1: Add the Worker API client while preserving the current UI contract

**Files:** src/api/workerApi.js, src/api/gasApi.js, src/App.jsx, .env.example, README.md.

- [ ] Implement Worker client functions with the same UI-facing function names or a single direct replacement mapping for every caller listed in the spec.
- [ ] Send the LIFF access token as Authorization Bearer on every authenticated request.
- [ ] Map current action payloads to formal routes without passing client identity as authority.
- [ ] Keep mock behavior as a test seam only; do not add a runtime backend mode switch.
- [ ] Replace VITE_GAS_API_URL with the approved Worker API configuration only at this cutover task.
- [ ] Update documentation without writing any real token, database ID, workbook content, or machine-specific path.

**Verification:** React unit/integration tests prove all existing action callers use the Worker client and no VITE_BACKEND_MODE or dual adapter exists.

### Task 8.2: Run frontend smoke and identity checks

**Files:** src/App.jsx, src/api/workerApi.js, frontend tests and build output.

- [ ] Exercise bootstrap, deferred data, registration, order page, submit, cancel, floor update, calendar like, balance history, admin summary, member balances, top-up, vendor setting, and role assignment.
- [ ] Verify View As changes only permitted read presentation.
- [ ] Verify authenticated user, effective read subject, and mutation actor remain distinct.
- [ ] Run the repository-declared test, lint, and build commands after the cutover.

**Verification:** frontend smoke evidence and automated commands are PASS; real LIFF/deployment evidence remains separately labeled.

### Task 8.3: Assess GAS removal after cutover

**Files:** gas/, src/api/gasApi.js, documentation.

- [ ] Compare all legacy actions against Worker routes and frontend callers.
- [ ] Confirm no production frontend call still targets GAS.
- [ ] Record which GAS files are retained for rollback/reference and which are eligible for a later cleanup change.
- [ ] Do not delete GAS source in this task sequence.

**Verification:** removal assessment is a report, not a destructive deletion.

## Final verification checklist for the implementation session

- [ ] Re-read the formal specification and confirm every approved decision is represented in code/tests.
- [ ] Run the repository safe preflight and preserve the pre-existing change ledger.
- [ ] Run all automated verification commands and capture exit codes/output.
- [ ] Run the ap-verification-core workflow and report baseline attribution separately.
- [ ] Run a defect-first review for authorization, orphan handling, ledger fabrication, duplicate menu identity, idempotency, and secret/workbook exposure.
- [ ] Mark each required manual item PASS, FAIL, NOT RUN, or NOT VERIFIED.
- [ ] Do not commit, push, deploy, or remotely reset D1 without explicit authorization from the current user.

## Execution handoff

Wave 0–6 implementation tasks are implemented and locally verified in the
current execution session. The formal handler remains isolated from the active
POC and React/GAS client. Wave 6 real-workbook validation remains pending until
the local-only workbook is supplied; remote operations still require separate
authorization. This environment executed the work inline with task-level
verification checkpoints.
