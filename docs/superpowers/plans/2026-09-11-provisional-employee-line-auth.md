# Provisional Employee and LINE Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit provisional employee onboarding and LINE binding to the formal Worker while preserving canonical identity and fail-closed authorization.

**Architecture:** Add a forward `0003` migration for user verification state and nullable provisional guest sessions. Build a canonical principal whose capabilities are derived from verification state before routes authorize. Reuse the existing opaque guest session and LINE profile verification, adding explicit confirmation/profile input only where a provisional identity must become a canonical unverified user.

**Tech Stack:** Cloudflare Worker, D1-compatible SQLite, JavaScript ES modules, Node `node:test`, React/Vite, existing LIFF client, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-11-provisional-employee-line-auth-design.md`

## Global Constraints

- Preserve `user_id` as the only relational owner key.
- Normalize employee IDs with trim, uppercase, and `/^[A-Z0-9]{6}$/`.
- Never infer employee identity from name or `line_user_id`.
- `UNVERIFIED` has only onboarding capabilities and cannot inherit role capabilities.
- A non-null `line_user_id` always blocks pure employee guest login with `LINE_LOGIN_REQUIRED`.
- Verify LINE credentials server-side and retain exact employee/LINE uniqueness.
- Do not modify CORS, `.env.development`, GAS baseline failures, secrets, or unrelated features.
- Do not commit, push, or deploy.
- Do not write remote D1 until local implementation, migration, tests, and compatibility checks pass and a fresh backup exists.

---

### Task 1: Add the forward provisional identity migration

**Files:**
- Create: `worker-poc/migrations-formal/0003_provisional_employee_identity.sql`
- Modify: `worker-poc/tests/formal-schema.test.js`
- Modify: `worker-poc/tests/runtime-config.test.js`
- Create: `worker-poc/tests/provisional-schema.test.js`

**Interfaces:**
- Consumes canonical schema from migrations `0000` through `0002`.
- Produces `users.verification_status` and a session table that can represent a verified user-backed session or a provisional employee-only session without a fake `user_id`.

- [ ] **Step 1: Add failing schema assertions.**

Assert that `users` contains `verification_status`, that its default is
`VERIFIED`, and that `employee_guest_sessions.user_id` is nullable while the
table contains `employee_id` and `status`. Assert indexes for employee/session
state and that invalid verification/session status values fail the database
constraints.

- [ ] **Step 2: Implement the additive/rebuild migration.**

Add the constrained user column with existing rows defaulting to `VERIFIED`.
Rename the old session table, create the new table with `user_id TEXT` nullable,
`employee_id TEXT` nullable for old Worker insert compatibility, and
`status TEXT NOT NULL DEFAULT 'VERIFIED'`, plus the existing token, expiry,
revocation, and auth-mode fields. Copy existing sessions by joining their
canonical user and populate the new employee/status fields. Preserve all
existing session rows and fail the migration if a legacy session cannot
resolve a non-empty employee ID for its copied user. Recreate the existing
indexes plus an exact employee/state lookup index. Keep the migration
forward-only and recorded by D1 migration bookkeeping.

- [ ] **Step 3: Run migration-specific local tests.**

Run `node --test tests/provisional-schema.test.js tests/formal-schema.test.js tests/runtime-config.test.js` from `worker-poc` and confirm the new schema is the only expected difference.

### Task 2: Centralize principal verification and capability derivation

**Files:**
- Modify: `worker-poc/src/db/users.js`
- Modify: `worker-poc/src/auth/permissions.js`
- Modify: `worker-poc/src/auth/identity.js`
- Modify: `worker-poc/src/http/authMiddleware.js`
- Modify: `worker-poc/src/domain/users.js`
- Modify: `worker-poc/src/routes/readOnly.js`
- Modify: `worker-poc/tests/permissions.test.js`
- Modify: `worker-poc/tests/auth.test.js`
- Modify: `worker-poc/tests/read-only.test.js`

**Interfaces:**
- `toUser(row)` exposes `verificationStatus`.
- `principalFromUser(user, context)` returns the canonical principal with a
  central `capabilities` array.
- `capabilitiesFor(role, authMode, verificationStatus, active)` returns the
  onboarding allowlist for unverified principals and role capabilities only
  for active verified principals.

- [ ] **Step 1: Add failing provisional capability tests.**

Construct an `UNVERIFIED` user with `role = 'User'` and `active = 1`; assert
that its capabilities do not include `READ_SELF`, `WRITE_SELF`, admin summary,
member balances, top-up, calendar administration, role assignment, or View As.
Assert that only the three onboarding capabilities are present and that
`assertCan` rejects every application-data and privileged action.

- [ ] **Step 2: Implement the central gate.**

Derive `verificationStatus` and `active` in the principal. Make capability
derivation return the onboarding set for `UNVERIFIED`, the existing guest
self-only set only for verified employee guest sessions, and the existing role
set only for active verified LINE principals. Make `assertCan` authorize from
the derived principal capabilities, not from a route-local role comparison.

- [ ] **Step 3: Remove role-only bypasses.**

Change View As checks and any direct role gate to use the verified principal
capability/verification predicate. Keep `getMe` as the only identity state
surface for provisional users and make protected read routes require verified
application capabilities. Add tests that invoke every privileged route with an
unverified User principal and expect denial.

- [ ] **Step 4: Run central authorization tests.**

Run `node --test tests/permissions.test.js tests/auth.test.js tests/read-only.test.js` from `worker-poc`.

### Task 3: Implement employee ID normalization and guest-login states

**Files:**
- Modify: `worker-poc/src/domain/guestAccess.js`
- Modify: `worker-poc/src/auth/guestSession.js`
- Modify: `worker-poc/src/routes/auth.js`
- Modify: `worker-poc/src/http/errors.js`
- Modify: `worker-poc/tests/guest-access.test.js`
- Modify: `worker-poc/tests/line-binding-concurrency.test.js`

**Interfaces:**
- `employeeIdText(value)` returns a canonical uppercase textual ID matching
  the import contract or
  throws `INVALID_EMPLOYEE_ID`.
- `employeeGuestLogin(database, employeeIdInput, clock)` returns
  `VERIFIED` with the existing user-backed session, or
  `UNVERIFIED_EMPLOYEE` with a provisional session and no user/capabilities.

- [ ] **Step 1: Replace the old regression expectation with contract tests.**

Test `139653` as a valid textual ID, `ab12cd` as `AB12CD`, unknown
`ABC123` as HTTP 200 with `UNVERIFIED_EMPLOYEE`, and malformed IDs such as
`-ABC12`,
`12-456`, full-width digits, and `ABC 12` as HTTP 400 `INVALID_EMPLOYEE_ID`.
Assert the unknown response has no user, role, balance, or ordinary capability.

- [ ] **Step 2: Implement normalization and provisional sessions.**

Update the shared employee parser, pass the canonical ID into the session
insert, use `status = 'VERIFIED'` for user-backed sessions, and create a
`user_id IS NULL` `UNVERIFIED_EMPLOYEE` session for an unknown ID. Do not
perform a user insert in this path.

- [ ] **Step 3: Enforce `LINE_LOGIN_REQUIRED`.**

After exact employee lookup, check `lineUserId` before active/verification
handling. Any non-null LINE binding returns HTTP 409 with
`{"error":"LINE_LOGIN_REQUIRED"}`. This check applies to both verified and
unverified canonical users.

- [ ] **Step 4: Make provisional sessions resolve only to onboarding state.**

Extend guest inspection and canonical identity resolution to return a
provisional principal without inventing a user ID. Normal guest application
requests must reject it through the central capability gate. `/api/me` must
return `status: 'UNVERIFIED_EMPLOYEE'` and the session employee ID.

### Task 4: Add explicit provisional LINE onboarding and collision-safe binding

**Files:**
- Modify: `worker-poc/src/routes/auth.js`
- Modify: `worker-poc/src/domain/guestAccess.js`
- Modify: `worker-poc/src/auth/guestSession.js`
- Modify: `worker-poc/src/db/users.js`
- Modify: `worker-poc/tests/guest-access.test.js`
- Modify: `worker-poc/tests/line-binding-concurrency.test.js`
- Modify: `worker-poc/tests/permissions.test.js`
- Modify: `worker-poc/tests/read-only.test.js`

**Interfaces:**
- Existing verified bind remains `POST /api/auth/line-bind` with LINE Bearer
  token and `X-Employee-Guest-Session`.
- Provisional bind accepts the same credentials plus server-validated
  `displayName` and `pickupFloor` fields, and creates a canonical unverified
  user atomically.

- [ ] **Step 1: Add failing bind/onboarding tests.**

Cover existing employee confirmation then bind, unknown employee profile
completion then bind, existing LINE binding direct login, LINE collision,
employee collision, same-session replay, and ordinary rebind rejection.
Assert the newly created row has a generated `user_id`, exact employee ID,
verified LINE ID from the profile adapter, `role = User`, `active = 1`,
`verification_status = UNVERIFIED`, and balance zero.

- [ ] **Step 2: Implement provisional bind atomically.**

Require the guest session, verify the LINE Bearer token with the existing LINE
Profile adapter, re-read session employee state, reject an already-bound LINE,
validate display name and floor, insert the unverified canonical row, attach the
session to that user, and revoke it in one D1 batch. Map unique constraint
failures to stable collision errors and preserve same-user/same-LINE replay.

- [ ] **Step 3: Audit all authorization consumers.**

Run the provisional principal through `/api/me`, read-only bootstrap/order
routes, order mutations, balance/history, calendar, announcements, roles,
member balances, and View As. Ensure every path reaches central capability
authorization before reading another user or mutating data. Add a source scan
test for direct role-only authorization that is not guarded by the principal
capability helper.

### Task 5: Add React employee and LINE onboarding states

**Files:**
- Modify: `src/components/EmployeeGuestLogin.jsx`
- Create: `src/components/EmployeeIdentityConfirmation.jsx`
- Create: `src/components/ProvisionalEmployeeOnboarding.jsx`
- Modify: `src/api/apiClientCore.js`
- Modify: `src/api/apiErrors.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Worker API client accepts all 2xx guest-login states and preserves typed
  `LINE_LOGIN_REQUIRED`, `UNVERIFIED_EMPLOYEE`, and invalid-format errors.
- The app state distinguishes `VERIFIED`, `UNVERIFIED_EMPLOYEE`, and
  `LINE_LOGIN_REQUIRED` without treating provisional users as registered.

- [ ] **Step 1: Add UI contract tests or static assertions alongside existing test style.**

Assert the employee form uses the six-character input contract, renders the
neutral unknown-employee message, renders canonical confirmation data for an
existing employee, and never renders controls for role, balance, active state,
or `userId` selection. Assert a bound employee shows LINE-login guidance.

- [ ] **Step 2: Implement verified confirmation state.**

After an unbound LINE user submits an existing employee ID, retain the guest
session and show `EmployeeIdentityConfirmation`. Only the explicit confirm
action calls `bindLine`; returning cancels the pending state without rebinding.

- [ ] **Step 3: Implement provisional onboarding state.**

After an unknown valid ID, show the normalized employee ID, LINE display name
from the authenticated response state, editable display name, floor choices,
and a continuation action. Send only profile fields to the bind endpoint; do
not send role, balance, active, verification status, user ID, or LINE ID as
trust material. On success, clear the guest session and re-bootstrap into the
provisional identity state.

- [ ] **Step 4: Handle bound-employee errors.**

Map `LINE_LOGIN_REQUIRED` to “此員工編號已綁定 LINE，請使用 LINE 登入。” and
keep the local Vite app pointed at the existing remote Worker URL.

### Task 6: Preserve mapping readiness and document rollout evidence

**Files:**
- Modify: `worker-poc/docs/remote-import-readiness.md`
- Modify: `worker-poc/README.md`
- Create: `worker-poc/docs/remote-provisional-auth-rollout.md`

**Interfaces:**
- Existing import tooling continues to reject the current workbook without an
  approved employee map.
- Rollout documentation separates schema migration evidence, mapping evidence,
  and authentication behavior evidence.

- [ ] **Step 1: Run the existing workbook dry-run with a new output path.**

Use the existing local-only production dry-run command and do not overwrite
any artifact in `.local-imports`. Record `legacyImportReadiness = BLOCKED`,
the missing employee column, unresolved mapping counts, and no remote write.

- [ ] **Step 2: Document the remote gate sequence.**

Document fresh export, read-only baseline, remote `0002`, read-only `0002`
verification, remote `0003`, read-only `0003` verification, and remote smoke.
State that no employee mapping is created for `139653` without approved
source evidence.

### Task 7: Local verification and compatibility gate

**Files:**
- Modify only files from Tasks 1–6.

- [ ] **Step 1: Run focused Worker tests.**

Run `node --test tests/provisional-schema.test.js tests/guest-access.test.js tests/line-binding-concurrency.test.js tests/permissions.test.js tests/auth.test.js tests/read-only.test.js` from `worker-poc`.

- [ ] **Step 2: Apply the full formal chain locally.**

Use a disposable local D1 or the in-memory formal initializer to apply
`0000`, `0001`, `0002`, and `0003`; run the migration twice where Wrangler
bookkeeping is available and confirm the second run is a no-op.

- [ ] **Step 3: Run Worker full tests.**

Run `npm.cmd test` from `worker-poc`; expect all existing tests plus the new
provisional and collision tests to pass.

- [ ] **Step 4: Run declared root verification.**

Run, in manifest order:

```powershell
node --test tests/strict-identity-ledger.test.cjs
npm.cmd run lint
npm.cmd run build
```

Classify the known three GAS order/ledger failures as pre-existing only if the
failure count and messages remain identical.

- [ ] **Step 5: Run diff and source-scope checks.**

Run `git diff --check`; confirm no CORS, `.env.development`, GAS, secret, or
unrelated feature changes.

### Task 8: Controlled remote migration and smoke verification

**Files:**
- No repository file changes are required unless a named local evidence
  artifact is created without colliding with an existing artifact.

- [ ] **Step 1: Create a fresh backup.**

Export `bento-formal` to a new timestamped `.local-imports` artifact using the
existing Wrangler export contract. Record the SHA-256, timestamp, target UUID,
schema/data inclusion, and row counts. Stop if export fails.

- [ ] **Step 2: Capture remote pre-migration evidence.**

Read `d1_migrations`, table schemas, indexes, row counts, and
`PRAGMA foreign_key_check` using the exact formal config. Confirm the target is
`bento-formal` and the binding is `DB`.

- [ ] **Step 3: Apply and verify `0002`.**

Run only the existing formal migration command against the remote formal D1.
Then verify `0000`, `0001`, `0002`, canonical user columns, guest-session table,
row-count transformations, indexes, and zero foreign-key violations.

- [ ] **Step 4: Apply and verify `0003`.**

Apply only `0003` after `0002` verification. Verify `verification_status`,
nullable provisional session `user_id`, employee/session status constraints,
indexes, preserved canonical users, row counts, and foreign-key cleanliness.

- [ ] **Step 5: Run remote smoke only after source deployment authorization.**

Because this task does not deploy source changes, report Worker smoke as
`NOT VERIFIED` until the new Worker version is deployed. After authorized
deployment, test `139653` as `UNVERIFIED_EMPLOYEE` unless approved mapping is
present, `ABC123` as an unknown valid provisional identity, `123` as
`INVALID_EMPLOYEE_ID`, existing bound employee as `LINE_LOGIN_REQUIRED`, and
LINE collision/replay behavior.
