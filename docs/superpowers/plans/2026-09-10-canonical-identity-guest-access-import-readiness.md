# Canonical Identity, Employee Guest Access, and Remote Import Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rekey the formal Worker + D1 runtime around internal `user_id` ownership and text `employee_id` business identity, add bounded employee guest access with atomic LINE binding, and make local import readiness truthful and reusable by a future remote importer.

**Architecture:** Add one forward migration that rebuilds every identity-dependent formal table and preserves legacy LINE IDs only as user attributes or event snapshots. Resolve every request into an actor, authorization actor, and effective subject with an explicit `line` or `employee_guest` auth mode; guest mode is always the low-risk self-service intersection of the stored role. Route importer dry-run, local stage, and future replacement through one parse → normalize → map → validate → plan → reconcile path, with an explicit `BLOCKED` result when employee ownership is not proven.

**Tech Stack:** Cloudflare Worker, D1-compatible SQLite, JavaScript ES modules, Node `node:test`, Wrangler local tooling, XLSX workbook adapter, React/Vite contract documentation only.

**Spec:** `docs/superpowers/specs/2026-09-10-canonical-identity-guest-access-import-readiness-design.md`

## Global Constraints

- Keep `users.user_id` as the only relational owner key for users, orders, ledger, audit, likes, calendar updates, idempotency, order history, and quarantine review ownership.
- Keep `users.employee_id` as a text business identity; preserve leading zeroes and never derive it from a name, display label, or raw `line_user_id`.
- Keep `users.line_user_id` nullable and unique as an external identity attribute; it is never a relational foreign-key authority.
- Keep `employee_guest` as an authentication mode, never as a persistent role; guest access is self-only even for stored `Admin` or `ProxyAdmin` users.
- Revoke every guest session immediately on successful LINE binding; permit only same-user/same-LINE idempotent replay at the bind endpoint for a session revoked with `revoked_reason = 'line_bound'`.
- Do not auto-create an employee for an unknown LINE profile; return `EMPLOYEE_BIND_REQUIRED` until an existing canonical employee is bound.
- Use one exact mapping/validation/reconciliation business path for dry-run, local stage, and future remote replacement.
- Do not fabricate `employee_id`, balancing offsets, synthetic ledger events, or unexplained financial adjustments.
- Current workbook readiness must be `BLOCKED` because the `Users` sheet has no `employee_id` column; no executable replacement SQL may be emitted for that input.
- Do not modify any GAS production `.gs` file or change the React app’s default GAS transport in this task.
- Do not deploy, commit, push, write remote D1, execute remote migrations, or execute remote import.
- Preserve every pre-existing staged, unstaged, and untracked change; edit the existing Worker cancellation route/test only around its current bodyless-cancel behavior if the identity rekey requires it.

---

### Task 1: Establish the legacy rekey migration contract

**Files:**
- Create: `worker-poc/migrations-formal/0002_canonical_identity_rekey.sql`
- Modify: `worker-poc/migrations-formal/README.md`
- Modify: `worker-poc/tests/formal-schema.test.js`
- Create: `worker-poc/tests/canonical-rekey.test.js`

**Interfaces:**
- Consumes the tables produced by `0000_formal_initial_schema.sql` and `0001_balance_integrity_primitives.sql`.
- Produces a schema where `users.user_id` is the primary key, `employee_id` and `line_user_id` are nullable unique attributes, all identity-bearing foreign keys use `user_id`, and `employee_guest_sessions` exists.

- [ ] **Step 1: Add failing schema assertions for the new relational contract.**

Add tests that open the full formal migration chain and assert the following columns and tables:

```js
assert.deepEqual(
  tableColumns(database, 'users'),
  new Set([
    'user_id', 'employee_id', 'line_user_id', 'display_name',
    'pickup_floor', 'balance', 'role', 'active', 'created_at', 'updated_at'
  ])
);
assert.equal(tableNames(database).has('employee_guest_sessions'), true);
assert.equal(tableColumns(database, 'orders').has('user_id'), true);
assert.equal(tableColumns(database, 'orders').has('created_by_user_id'), true);
assert.equal(tableColumns(database, 'orders').has('created_auth_mode'), true);
assert.equal(tableColumns(database, 'balance_ledger').has('operator_user_id'), true);
```

Also assert that the listed old relational columns no longer exist: `orders.line_user_id`, `likes.line_user_id`, `balance_ledger.line_user_id`, `idempotency_keys.actor_line_user_id`, `admin_audit_log.actor_line_user_id`, `admin_audit_log.target_line_user_id`, `calendar_settings.updated_by_line_user_id`, `order_status_history.actor_line_user_id`, `opening_balance_snapshots.line_user_id`, and `import_quarantine.reviewed_by_line_user_id`.

- [ ] **Step 2: Add a migration-preservation fixture that starts from the old schema.**

In `canonical-rekey.test.js`, execute only migrations `0000` and `0001`, seed one user, one order with one item, one status transition, one ledger row, one ledger sequence row, one opening snapshot, one like, one idempotency row, one audit row, and one quarantine review, then execute `0002`. Assert that every row remains present, all dependent rows point to the same new `user_id`, the original `line_user_id` is retained on the user and event snapshots, and the migrated user has `employee_id IS NULL` rather than an invented value.

Use this fixture shape so the test proves negative balances and timestamps survive:

```js
database.prepare(`
  INSERT INTO users (line_user_id, display_name, pickup_floor, balance, role)
  VALUES (?, ?, ?, ?, ?)
`).run('legacy-line-001', 'Legacy User', '1樓', -125, 'Admin');
database.prepare(`
  INSERT INTO orders (order_id, line_user_id, order_date, vendor, pickup_floor, total_amount)
  VALUES (?, ?, ?, ?, ?, ?)
`).run('legacy-order-001', 'legacy-line-001', '2026-09-08', 'Vendor A', '1樓', 80);
```

- [ ] **Step 3: Implement `0002_canonical_identity_rekey.sql` as a data-preserving rebuild.**

Disable foreign keys only while rebuilding, drop the old ledger sequence trigger, create a temporary `legacy_user_map` using `user_id = 'legacy_' || lower(hex(line_user_id))`, and copy all old users into the new table with `employee_id = NULL` and `active = 1`. This deterministic legacy ID is an internal migration key only; it is not an employee ID.

Create new tables with these exact ownership and audit fields:

```sql
CREATE TABLE users_new (
  user_id TEXT PRIMARY KEY,
  employee_id TEXT,
  line_user_id TEXT,
  display_name TEXT NOT NULL,
  pickup_floor TEXT NOT NULL CHECK (pickup_floor IN ('1樓', '9樓')),
  balance INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'User' CHECK (role IN ('User', 'ProxyAdmin', 'Admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX users_employee_id_unique
  ON users_new(employee_id) WHERE employee_id IS NOT NULL AND length(trim(employee_id)) > 0;
CREATE UNIQUE INDEX users_line_user_id_unique
  ON users_new(line_user_id) WHERE line_user_id IS NOT NULL AND length(trim(line_user_id)) > 0;
```

Rebuild `calendar_settings` with `updated_by_user_id`, `likes` with `user_id`, `orders` with `user_id`, owner and actor snapshots, `created_by_user_id`, `created_auth_mode`, nullable cancellation actor fields, and `source_batch_id`, `order_items` unchanged except for its new order parent, `order_status_history` with `actor_user_id`, `actor_auth_mode`, and identity snapshots, `balance_ledger` with `user_id`, `operator_user_id`, and identity snapshots, `idempotency_keys` with `actor_user_id`, `admin_audit_log` with `actor_user_id` and `target_user_id`, `import_quarantine` with `reviewed_by_user_id`, and `opening_balance_snapshots` with `user_id`.

Use `legacy_import` for migrated event auth modes. Copy old order owner identity into `employee_id_snapshot`, `line_user_id_snapshot`, and `display_name_snapshot`; copy old ledger and audit external IDs into snapshot columns; never claim that a migrated row was created by a verified LINE or guest session.

Create `employee_guest_sessions` with a unique `token_hash`, `user_id` foreign key, fixed `auth_mode = 'employee_guest'`, timestamps, `revoked_at`, and `revoked_reason IN ('line_bound', 'admin_revoke')`. Drop the temporary map, rename all `_new` tables, recreate the formal indexes, recreate `balance_ledger_sequence`, backfill its rows in old insertion order, recreate the insert trigger, enable foreign keys, and leave `d1_migrations` untouched.

- [ ] **Step 4: Record the migration chain and run schema tests.**

Update the formal migration README to describe `0002`, the legacy internal ID rule, null employee IDs for unmapped historical users, guest sessions, and the fact that remote application remains a later checkpoint. Run:

```powershell
npm.cmd --prefix worker-poc test -- tests/formal-schema.test.js tests/canonical-rekey.test.js
```

Expected: PASS for fresh creation, old-schema preservation, foreign-key integrity, partial uniqueness, negative balances, sequence backfill, trigger assignment, and idempotent migration application.

### Task 2: Introduce canonical user and guest-session data access

**Files:**
- Create: `worker-poc/src/auth/guestSession.js`
- Modify: `worker-poc/src/db/users.js`
- Modify: `worker-poc/src/http/errors.js`
- Modify: `worker-poc/src/auth/identity.js`
- Modify: `worker-poc/tests/helpers/formal-fixtures.js`
- Modify: `worker-poc/tests/helpers/formal-db.js`
- Create: `worker-poc/tests/guest-session.test.js`

**Interfaces:**
- `getUserById(database, userId)` returns the canonical user record or `null`.
- `getUserByEmployeeId(database, employeeId)` returns the canonical user record or `null`.
- `getUserByLineId(database, lineUserId)` remains the external-profile lookup only.
- `publicUser(user)` returns `{ userId, employeeId, name, floor, defaultFloor, balance, role, active, lineUserId, displayName }` with a nullable `lineUserId`.
- `createGuestSession(database, { userId, clock, lifetimeMs })` returns `{ sessionId, token }` and stores only the SHA-256 token hash.
- `findGuestSession(database, token, { now, allowRevokedLineBindReplay })` returns the session plus canonical user or `null`, and never returns a normal request session when the user is inactive or LINE-bound.
- `revokeGuestSessions(database, userId, reason, occurredAt)` creates the `line_bound` revocation state atomically with binding.
- `resolveCanonicalIdentity(request, env, fetchImpl, { allowViewAs, now })` returns separate `actor`, `authorizationActor`, `effectiveSubject`, and `viewAs` objects, each carrying `userId`, `employeeId`, `lineUserId`, `registered`, `role`, and `authMode`.

- [ ] **Step 1: Update fixture helpers to seed internal identity explicitly.**

Change `seedUser` to accept `userId`, `employeeId`, `lineUserId`, `active`, and the existing display/floor/balance/role fields. Default synthetic users to explicit values such as `userId: 'user-1'` and `employeeId: '000001'`; do not infer either field from display name. Keep `profileFetch` as the only token-derived LINE profile test helper.

- [ ] **Step 2: Implement canonical user queries and public serialization.**

Select `user_id`, `employee_id`, `line_user_id`, `display_name`, `pickup_floor`, `balance`, `role`, `active`, `created_at`, and `updated_at` in every user query. Make `publicUser` expose internal `userId` and business `employeeId`, keep `lineUserId` nullable for UI compatibility, and do not use `lineUserId` as the public `userId` fallback.

- [ ] **Step 3: Implement opaque guest-session creation and lookup.**

Generate the clear token with Web Crypto randomness, hash it with SHA-256 using `crypto.subtle`, insert the hash and canonical `user_id`, and return the clear token exactly once. Enforce an eight-hour expiry by default. Normal lookup must require `revoked_at IS NULL`, `expires_at > now`, `users.active = 1`, and `users.line_user_id IS NULL`; a revoked session is only eligible for the binding replay rule described in Task 3.

- [ ] **Step 4: Add stable error constructors and identity tests.**

Add stable public errors for `EMPLOYEE_BIND_REQUIRED`, `GUEST_SESSION_INVALID`, `EMPLOYEE_NOT_FOUND`, `EMPLOYEE_INACTIVE`, `EMPLOYEE_ALREADY_LINE_BOUND`, `LINE_ALREADY_BOUND`, and `LINE_BIND_CONFLICT`. Test token non-persistence, expiry, inactivity, post-binding invalidation, nullable LINE identity, and forged query/body identity fields.

Run:

```powershell
npm.cmd --prefix worker-poc test -- tests/guest-session.test.js tests/auth.test.js
```

Expected: the new guest-session tests pass; old tests that assert automatic unknown-LINE registration are intentionally updated in Task 3.

### Task 3: Add guest login, atomic LINE binding, and mode-aware authorization

**Files:**
- Create: `worker-poc/src/domain/guestAccess.js`
- Create: `worker-poc/src/routes/auth.js`
- Modify: `worker-poc/src/auth/permissions.js`
- Modify: `worker-poc/src/auth/identity.js`
- Modify: `worker-poc/src/http/authMiddleware.js`
- Modify: `worker-poc/src/http/errors.js`
- Modify: `worker-poc/src/formalWorker.js`
- Modify: `worker-poc/src/routes/me.js`
- Modify: `worker-poc/tests/permissions.test.js`
- Modify: `worker-poc/tests/registration.test.js`
- Create: `worker-poc/tests/guest-auth.test.js`
- Create: `worker-poc/tests/line-binding-concurrency.test.js`

**Interfaces:**
- `POST /api/auth/employee-guest` accepts `{ "employeeId": "001234" }` and returns an opaque bearer token plus `authMode: "employee_guest"` and the canonical public user.
- `POST /api/auth/line-bind` accepts `Authorization: Bearer LINE_ACCESS_TOKEN` and `X-Employee-Guest-Session: GUEST_SESSION_TOKEN`; it never accepts an employee ID in the body.
- `employeeGuestLogin(database, employeeId, clock)` returns `{ token, authMode, expiresAt, user }`.
- `bindLineIdentity(database, { guestToken, lineUserId, lineDisplayName, clock })` returns `{ status: 'BOUND' | 'ALREADY_BOUND', user }` or a stable conflict error.
- `assertCan(identity, action)` intersects stored role actions with `identity.actor.authMode`; `employee_guest` can only use `READ_SELF`, `REGISTER_SELF`, and `WRITE_SELF` actions that are already self-targeted.
- `assertSelfTarget(identity, targetUserId)` compares internal `userId` values only.

- [ ] **Step 1: Add failing route and permission tests.**

Cover these exact outcomes:

```text
active unbound employee 001234       → 200 guest session
missing employee                      → 404 EMPLOYEE_NOT_FOUND
inactive employee                     → 403 EMPLOYEE_INACTIVE
LINE-bound employee                   → 409 EMPLOYEE_ALREADY_LINE_BOUND
guest Admin/ProxyAdmin                → no admin summary/top-up/role/View As
guest own order/cancel/balance/history→ allowed when self-targeted
unknown LINE profile                  → 401 EMPLOYEE_BIND_REQUIRED
```

- [ ] **Step 2: Implement employee ID parsing and guest login.**

Trim only surrounding whitespace, require a non-empty string representation, preserve all leading zeroes, reject numeric values that have already lost formatting, load by exact `employee_id`, and require `active = 1` and `line_user_id IS NULL`. Store no role or balance in the token.

- [ ] **Step 3: Implement the binding transaction.**

Verify the LINE bearer with `fetchLineProfile`, load the guest session by hash, and perform the conditional update and session revocation in one D1 batch:

```sql
UPDATE users
SET line_user_id = ?, updated_at = ?
WHERE user_id = ? AND active = 1 AND line_user_id IS NULL;

UPDATE employee_guest_sessions
SET revoked_at = ?, revoked_reason = 'line_bound'
WHERE user_id = ? AND revoked_at IS NULL;
```

After the batch, read the same `user_id`. If it contains the verified requested LINE ID, return `BOUND` for the first successful update or `ALREADY_BOUND` for a same-user replay. If it contains another LINE ID, return `409 EMPLOYEE_ALREADY_LINE_BOUND`; if the unique LINE index rejects the update, return `409 LINE_ALREADY_BOUND`. Never insert a second user.

- [ ] **Step 4: Implement the revoked-session replay rule.**

The normal identity resolver rejects every revoked guest session. The bind endpoint may accept a session with `revoked_reason = 'line_bound'` only when the canonical user is already bound to the same verified LINE ID; it must reject a different LINE ID, an expired session, an inactive user, or a session revoked for another reason. Test that the old token cannot call `/api/me`, create an order, cancel an order, read balance/history, or use any admin route after binding.

- [ ] **Step 5: Remove automatic unknown-LINE employee creation.**

Change `registerUser` to return `EMPLOYEE_BIND_REQUIRED` for an unregistered LINE profile and retain the existing already-registered readback path. Do not accept client role, balance, employee ID, display name, or user ID as registration authority. Keep floor validation for any existing registration compatibility path.

- [ ] **Step 6: Register the new routes before protected route dispatch.**

Dispatch `handleAuthRoute` from `formalWorker.js` before `handleMeRoute`. Leave existing bodyless `POST /api/orders/:id/cancel` handling intact. Use CORS/error serialization already provided by `formalWorker.js`.

Run:

```powershell
npm.cmd --prefix worker-poc test -- tests/guest-auth.test.js tests/line-binding-concurrency.test.js tests/permissions.test.js tests/registration.test.js
```

Expected: both concurrent different claims yield at most one binding, repeated same claims are idempotent, and every old guest session fails normal access immediately after binding.

### Task 4: Rekey database helpers and every formal runtime consumer

**Files:**
- Modify: `worker-poc/src/db/audit.js`
- Modify: `worker-poc/src/db/idempotency.js`
- Modify: `worker-poc/src/db/ledgerQueries.js`
- Modify: `worker-poc/src/db/users.js`
- Modify: `worker-poc/src/domain/users.js`
- Modify: `worker-poc/src/domain/adminSummary.js`
- Modify: `worker-poc/src/domain/announcements.js`
- Modify: `worker-poc/src/domain/calendar.js`
- Modify: `worker-poc/src/domain/ledger.js`
- Modify: `worker-poc/src/domain/orders.js`
- Modify: `worker-poc/src/domain/ordersRead.js`
- Modify: `worker-poc/src/routes/admin.js`
- Modify: `worker-poc/src/routes/balance.js`
- Modify: `worker-poc/src/routes/calendar.js`
- Modify: `worker-poc/src/routes/orders.js`
- Modify: `worker-poc/src/routes/readOnly.js`
- Modify: `worker-poc/src/routes/roles.js`
- Modify: `worker-poc/src/contract.js`
- Modify: `worker-poc/tests/helpers/order-fixtures.js`
- Modify: `worker-poc/tests/admin-summary.test.js`
- Modify: `worker-poc/tests/admin-topup.test.js`
- Modify: `worker-poc/tests/balance-history.test.js`
- Modify: `worker-poc/tests/calendar-admin.test.js`
- Modify: `worker-poc/tests/likes.test.js`
- Modify: `worker-poc/tests/ledger.test.js`
- Modify: `worker-poc/tests/idempotency.test.js`
- Modify: `worker-poc/tests/orders-create.test.js`
- Modify: `worker-poc/tests/orders-cancel.test.js`
- Modify: `worker-poc/tests/orders-concurrency.test.js`
- Modify: `worker-poc/tests/read-only.test.js`
- Modify: `worker-poc/tests/roles.test.js`
- Modify: `worker-poc/tests/view-as.test.js`

**Interfaces:**
- `auditStatement(database, { actorUserId, targetUserId, action, metadata, occurredAt })` writes only internal user references.
- `runIdempotentMutation(database, { actorUserId, operation, idempotencyKey, requestHash, occurredAt, responseSpec, buildStatements })` scopes idempotency by internal actor.
- `ledgerMutationStatements(database, { userId, operatorUserId, amount, balanceAfter, type, referenceId, note, occurredAt, sourceBatchId }, options)` validates references and mutates only `users.user_id` and `balance_ledger.user_id`.
- `getLedgerRows(database, userId, range)` and `getLatestLedgerRow(database, userId, before)` query internal ownership.
- `getActiveOrder(database, userId, targetDate)` and `getActiveOrdersMap(database, userId)` query internal ownership.
- Admin target resolution accepts an exact internal `userId` or exact `employeeId`; it never treats a display name or raw LINE ID as a relational target.

- [ ] **Step 1: Replace helper SQL ownership columns.**

Update audit, idempotency, ledger, balance response subqueries, and reference predicates from `line_user_id` variants to `user_id` variants. Keep external LINE IDs only in explicit snapshot columns and profile lookup code. Ensure `mutationResponseSpec` reads `users.balance WHERE user_id = ?`.

- [ ] **Step 2: Rekey self-service and read-only domains.**

Pass `identity.effectiveSubject.userId` to calendar likes, order reads, order creation/cancellation, balance history, and bootstrap/deferred responses. Update `View As` to select a canonical `user_id` target while keeping `authorizationActor` as the LINE-authenticated Admin. A guest identity must reject any `viewAs` query before a target lookup.

- [ ] **Step 3: Rekey orders while preserving event context.**

Change every order mutation and replacement/refund query to use `orders.user_id`. Insert `created_by_user_id` and `created_auth_mode` from the actor context, set cancellation actor fields from the authenticated actor, preserve `employee_id_snapshot`, `line_user_id_snapshot`, and `display_name_snapshot`, and write order status history with `actor_user_id` and `actor_auth_mode`. Keep server-side pricing, deadline, one-active-order uniqueness, negative-balance behavior, D1 batch atomicity, and the existing bodyless cancellation request path.

- [ ] **Step 4: Rekey balance and privileged domains.**

Use internal user IDs for top-up target, operator, audit, ledger, summary, role assignment, announcements, and calendar-setting updates. Guest mode must fail before any privileged statement is built. Preserve the existing idempotency request hash and operation names while changing their actor scope to `user_id`.

- [ ] **Step 5: Re-key contract responses without breaking the GAS default.**

Return nullable `lineUserId`, text `employeeId`, internal `userId`, `authMode`, and role in formal Worker responses. Do not edit `src/App.jsx`, `src/api/apiClientCore.js`, `src/api/apiErrors.js`, or any GAS `.gs` file. Keep the formal Worker’s existing API error envelope and document that the React app remains GAS-bound until an explicit cutover.

- [ ] **Step 6: Update focused runtime tests and run them.**

Replace raw fixture SQL that inserts `line_user_id` ownership with `user_id` ownership, add explicit employee IDs to synthetic users, and assert that orders, ledger, likes, audits, idempotency records, status history, and View As all retain the same canonical user ID. Run:

```powershell
npm.cmd --prefix worker-poc test -- tests/idempotency.test.js tests/orders-create.test.js tests/orders-cancel.test.js tests/orders-concurrency.test.js tests/ledger.test.js tests/balance-history.test.js tests/calendar-admin.test.js tests/likes.test.js tests/admin-topup.test.js tests/admin-summary.test.js tests/roles.test.js tests/view-as.test.js tests/read-only.test.js
```

Expected: PASS with no SQL reference to an old relational `line_user_id` column in formal runtime source or focused tests.

### Task 5: Build exact identity mapping and employee-aware workbook normalization

**Files:**
- Create: `worker-poc/scripts/lib/identity-mapping.mjs`
- Modify: `worker-poc/scripts/lib/import-contract.mjs`
- Modify: `worker-poc/scripts/lib/workbook-reader.mjs`
- Modify: `worker-poc/scripts/lib/import-normalizer.mjs`
- Modify: `worker-poc/scripts/import-legacy-workbook.mjs`
- Modify: `worker-poc/tests/fixtures/formal-workbook.js`
- Create: `worker-poc/tests/identity-mapping.test.js`
- Modify: `worker-poc/tests/importer.test.js`

**Interfaces:**
- `parseEmployeeId(value)` returns a validated string employee ID or a named parse issue; numeric XLSX values are rejected when leading-zero information cannot be proven.
- `loadIdentityMap(path)` validates `{ bySource, byLegacyLineUserId }` and rejects duplicate/conflicting mappings.
- `resolveSourceIdentity(record, indexes, identityMap)` returns `{ status, userId, employeeId, lineUserId, evidence }` and never returns an employee ID derived from a name or an unmapped LINE ID.
- `prepareImportModel({ inputPath, identityMapPath, adapter, importerVersion, ledgerPolicyApproved, orderExclusions })` is the single shared parse/normalize/map/validate entry used by validate, stage, dry-run, and future replacement.

- [ ] **Step 1: Add failing mapping tests.**

Test exact preservation of `'001234'`, rejection of numeric `1234` with an explicit leading-zero risk, source-row mapping, exact reviewed LINE-to-employee mapping, mapping conflicts, missing mappings, and the rule that these inputs never produce an employee ID:

```js
assert.equal(parseEmployeeId('001234').value, '001234');
assert.equal(parseEmployeeId(1234).code, 'EMPLOYEE_ID_NUMERIC_UNSAFE');
assert.equal(resolveSourceIdentity(
  { source: { sheet: 'Users', row: 2 }, lineUserId: 'line-unreviewed', displayName: 'Same Name' },
  { byEmployeeId: new Map(), byLineUserId: new Map() },
  { bySource: {}, byLegacyLineUserId: {} }
).status, 'EXPLICIT_MAPPING_REQUIRED');
```

- [ ] **Step 2: Add header aliases and canonical row mapping.**

Map headers by normalized alias rather than fixed position. Recognize `employee_id`, `EmployeeID`, `員工編號`, and `工號`; `line_user_id`, `LINE_UserID`, and `UserID (LINE ID)`; and the existing English/Chinese display, floor, balance, operator, and order fields. Keep source sheet/row and raw payload in every row. A missing employee header must be a reported shape/readiness issue, not a positional shift that assigns another column as employee ID.

- [ ] **Step 3: Extend normalized records with identity fields.**

Normalize Users, Orders, Likes, TopupHistory, and operator fields to include text `employeeId` where present, external `lineUserId` where present, and a stable `sourceKey = sheet + ':' + row`. Keep date-only parsing and money integer parsing unchanged; keep the source SHA-256 and deterministic batch ID.

- [ ] **Step 4: Implement deterministic source identity resolution.**

Resolve only in this order: exact source `employee_id`; exact reviewed LINE-to-employee mapping; exact reviewed source-row mapping; unresolved. Index accepted Users by employee ID and exact reviewed LINE ID, reject duplicate employee IDs, reject one LINE ID mapped to multiple employees, and propagate a resolved User mapping to Orders, Likes, and TopupHistory. Display name is evidence text only and never an identity key.

- [ ] **Step 5: Wire mapping input through every importer mode.**

Parse `--identity-map` in the CLI, load it once in `prepareImportModel`, and pass the same resolved model to `runImport`, `runProductionReplace`, `stageImport`, `buildDryRunArtifact`, `buildReplacementSql`, and `replaceImport`. Do not provide a mode-specific fallback that can accept an unresolved row.

- [ ] **Step 6: Update synthetic fixtures and run mapping/import tests.**

Add explicit `employee_id` values to the tracked synthetic workbook fixture while leaving the real ignored workbook unchanged. Run:

```powershell
npm.cmd --prefix worker-poc test -- tests/identity-mapping.test.js tests/importer.test.js
```

Expected: PASS for text identity preservation and explicit `BLOCKED` resolution for the current legacy shape without a mapping file.

### Task 6: Enforce readiness validation, no-offset reconciliation, and one persistence planner

**Files:**
- Modify: `worker-poc/scripts/lib/import-validator.mjs`
- Modify: `worker-poc/scripts/lib/import-writer.js`
- Modify: `worker-poc/scripts/lib/reconciliation.mjs`
- Modify: `worker-poc/scripts/reconcile-balances.mjs`
- Modify: `worker-poc/scripts/lib/quarantine-report.mjs`
- Modify: `worker-poc/scripts/lib/replacement-import.mjs`
- Modify: `worker-poc/scripts/lib/formal-cleanup.mjs`
- Modify: `worker-poc/tests/reconciliation.test.js`
- Modify: `worker-poc/tests/import-writer.test.js`
- Modify: `worker-poc/tests/replacement-import.test.js`
- Create: `worker-poc/tests/import-readiness.test.js`

**Interfaces:**
- `validateImport(normalized, options)` returns `accepted`, `quarantine`, `warnings`, `exclusions`, and `readiness: { status: 'PASS' | 'BLOCKED', blockers, identitySummary, financialSummary }`.
- `buildImportStatements(database, validation, options)` consumes only a readiness-validated model and writes `user_id` ownership plus employee/LINE snapshots.
- `reconcileBalances(database)` returns per-user and aggregate evidence with `difference`, `status`, `unexplainedOffsets`, and no balancing-row mutation.
- `buildReconciliation(validation, options)` returns the complete machine-readable readiness report.
- `buildDryRunArtifact({ validation, target, databaseId, inputPath, destructiveCommand })` sets `readyForReplacement` only when `validation.readiness.status === 'PASS'` and emits no SQL file otherwise.

- [ ] **Step 1: Add readiness-gate tests before changing acceptance behavior.**

Assert that a Users sheet with no employee IDs yields `BLOCKED` with `EMPLOYEE_ID_FIELD_MISSING` or `EMPLOYEE_ID_REQUIRED`, that an order with no proven owner yields `ORPHAN` or `EXPLICIT_MAPPING_REQUIRED`, that a non-zero balance without approved opening-balance evidence yields `OPENING_BALANCE_POLICY_REQUIRED`, and that any identity conflict blocks replacement. Assert that a blocked dry-run deletes no prior local artifact by changing no database state and emits no executable SQL.

- [ ] **Step 2: Implement employee and ownership validation.**

Require resolved employee IDs for active imported users, exact uniqueness for employee and LINE mappings, valid floors/roles/dates/money/statuses, and resolved owners for every order, like, and ledger row that could affect state. Preserve raw and normalized payloads in quarantine with stable `sheet:row` identifiers and safe external-ID digests.

- [ ] **Step 3: Make balance reconciliation evidence-based.**

Join `users.user_id` to `opening_balance_snapshots.user_id` and ledger rows by `user_id`, calculate per-user `usersBalance - latestLedgerBalance` when ledger evidence exists, and classify non-zero balances without policy evidence as blocked. Report aggregate source balance, ledger amount totals, snapshot totals, differences, and `unexplainedOffsets`; never insert an offset row or rewrite a balance merely to make `allConsistent` true.

- [ ] **Step 4: Rebuild the writer around canonical IDs.**

Insert Users with deterministic `user_id` derived only from canonical `employee_id`, insert opening snapshots with `user_id`, insert likes/orders/status history/ledger with resolved `user_id`, use `legacy_import` auth mode for imported events, and enforce `INSERT OR IGNORE`/unique source keys for repeat staging. Reject accepted TopupHistory until the explicit ledger policy is approved.

- [ ] **Step 5: Make replacement SQL and local replacement use the same plan.**

Keep the exact formal target guard (`bento-formal`, database UUID `e75bc185-afb5-4a5d-abc9-81bd79525cff`), preserve `d1_migrations`, use the rekeyed clear order, and call the same `buildImportStatements`/persistence plan used by local stage. `buildReplacementSql` must throw for blocked validation and must not contain a synthetic balancing statement.

- [ ] **Step 6: Update cleanup and reconciliation contracts.**

Change cleanup digests and post-clean queries to use `user_id`, `employee_id`, nullable `line_user_id`, and `reviewed_by_user_id`; include `employee_guest_sessions` in reset/clear inventory where applicable; retain the approved protected-table and backup guards. Do not run cleanup against any remote database.

- [ ] **Step 7: Run importer and readiness tests.**

```powershell
npm.cmd --prefix worker-poc test -- tests/reconciliation.test.js tests/import-writer.test.js tests/replacement-import.test.js tests/import-readiness.test.js
```

Expected: PASS for deterministic reports, exact accepted/quarantine counts, no offsets, rekeyed SQL planning, repeat-idempotency, local replacement guards, and blocked current-workbook readiness.

### Task 7: Prepare the exact local dry-run and remote checkpoint without executing remote work

**Files:**
- Modify: `worker-poc/scripts/import-legacy-workbook.mjs`
- Modify: `worker-poc/scripts/lib/replacement-import.mjs`
- Modify: `worker-poc/scripts/lib/quarantine-report.mjs`
- Modify: `worker-poc/package.json`
- Create: `worker-poc/docs/canonical-identity-guest-access.md`
- Create: `worker-poc/docs/remote-import-readiness.md`
- Modify: `worker-poc/README.md`

**Interfaces:**
- The dry-run command accepts `--identity-map`, `--input`, `--output`, `--sql-output`, `--target`, `--database-id`, and `--config` without writing D1.
- The generated artifact includes source hash, importer version, identity status counts, financial reconciliation, blockers, clear order, exact target, and `REMOTE IMPORT: NOT EXECUTED`.
- The future command is documented exactly but is never invoked in this task.

- [ ] **Step 1: Add CLI argument and artifact tests.**

Assert that `--identity-map` reaches `prepareImportModel`, that the destructive command string includes the reviewed artifact, `--confirm-production-replace`, `--remote`, and the identity map, and that a blocked artifact has `readyForReplacement: false` and no SQL file output.

- [ ] **Step 2: Generate the current workbook readiness report locally.**

Run only this local dry-run after implementation:

```powershell
npm.cmd --prefix worker-poc run import:production:dry-run -- `
  --input "..\gas\便當系統設定.xlsx" `
  --output ".local-imports\bento-formal-identity-review.json" `
  --sql-output ".local-imports\bento-formal-identity.sql" `
  --target bento-formal `
  --database-id e75bc185-afb5-4a5d-abc9-81bd79525cff `
  --config wrangler.jsonc
```

The command must report `BLOCKED` because the current Users header lacks `employee_id`; preserve any existing `.local-imports` artifacts and write only the explicitly named local review output if it does not collide with a user-owned artifact.

- [ ] **Step 3: Write the remote checkpoint document.**

Document this prepared command without executing it:

```powershell
npm.cmd --prefix worker-poc run import:production:replace -- `
  --input "..\gas\便當系統設定.xlsx" `
  --identity-map ".local-imports\employee-identity-map.json" `
  --output ".local-imports\bento-formal-identity-review.json" `
  --reviewed-artifact ".local-imports\bento-formal-identity-review.json" `
  --target bento-formal `
  --database-id e75bc185-afb5-4a5d-abc9-81bd79525cff `
  --confirm-production-replace `
  --remote `
  --config wrangler.jsonc
```

Place explicit gates before this command: reviewed employee mapping, remote backup, read-only remote schema/count preflight, approved readiness artifact, and separately approved recovery plan. State that the current artifact is blocked and the command is not executable until those gates pass.

- [ ] **Step 4: Run only local importer tests and inspect artifacts.**

```powershell
npm.cmd --prefix worker-poc test -- tests/importer.test.js tests/import-readiness.test.js tests/replacement-import.test.js
```

Expected: PASS with no remote Wrangler invocation, no remote D1 write, no remote migration, and no deployment.

### Task 8: Complete repository verification and independent defect review

**Files:**
- Modify only the implementation/test/docs files listed in Tasks 1–7.
- Do not modify `gas/*.gs`, root React cancellation files, `.env.development`, ignored workbook files, or existing local import artifacts unless an explicitly named local output is absent and safe to create.

**Interfaces:**
- Required repository verification remains the exact `agent.yaml` commands: `node --test tests/strict-identity-ledger.test.cjs`, `npm run lint`, and `npm run build`.
- Formal backend regression is `npm.cmd --prefix worker-poc run test:formal` and the full Worker suite is `npm.cmd --prefix worker-poc test`.
- Final handoff reports automated and manual verification separately, with `PASS`, `FAIL`, `NOT RUN`, or `NOT VERIFIED`, and attributes every failure as `NEW_FAILURE`, `PRE_EXISTING_FAILURE`, or `UNKNOWN_ATTRIBUTION`.

- [ ] **Step 1: Run targeted high-risk tests.**

```powershell
npm.cmd --prefix worker-poc run test:formal
```

Record the exact exit status and material output. This is the required high-risk identity/auth/migration/financial regression gate.

- [ ] **Step 2: Run the repository-declared verification commands in order.**

```powershell
node --test tests/strict-identity-ledger.test.cjs
npm.cmd run lint
npm.cmd run build
```

Run these from the repository root, use `npm.cmd` on Windows, and record one result for each declared command. Do not use a failing command as authorization to change unrelated baseline code.

- [ ] **Step 3: Run static identity and scope scans.**

```powershell
rg -n "(orders|likes|balance_ledger|idempotency_keys|admin_audit_log|calendar_settings|order_status_history|opening_balance_snapshots|import_quarantine).*line_user_id|line_user_id.*(REFERENCES|FOREIGN KEY|WHERE .*line_user_id)" worker-poc/src worker-poc/scripts worker-poc/migrations-formal
rg -n "employee_id.*(display_name|line_user_id)|display_name.*employee_id|line_user_id.*employee_id" worker-poc/src worker-poc/scripts
git diff --check
```

The first scan may report snapshot/profile lookup names only; inspect every hit and reject any remaining relational ownership predicate. The second scan must show no fallback that fabricates employee IDs from names or raw LINE IDs.

- [ ] **Step 4: Run the read-only toolchain capability probe.**

```powershell
.\tools\get-toolchain-capabilities.ps1
```

If the repository does not contain this declared verification helper, record `NOT RUN` with the concrete missing-path reason; do not substitute a global or parent-workspace script.

- [ ] **Step 5: Perform independent defect-first review.**

Review the final diff separately from test output for: guest escalation through stored Admin/ProxyAdmin roles; stale-session access after binding; same-user binding replay; second-user creation; line-keyed relational SQL; leading-zero loss; importer mode divergence; blocked readiness incorrectly emitting SQL; synthetic ledger/offset creation; accidental GAS/React changes; remote command execution; and loss of the existing bodyless cancellation behavior. Record findings separately from automated verification.

- [ ] **Step 6: Produce the final handoff without lifecycle mutation.**

Report changed files, exact verification evidence, independent review, pre-existing changes/collisions, suggested Conventional Commit title without creating a commit, tag/release status as not applicable, push status, deploy status, and remaining follow-up. Explicitly state that no commit, push, deploy, remote D1 write, migration, or import was executed.

