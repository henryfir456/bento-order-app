# Admin identity management 0.13.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Worker + D1 authoritative Admin identity projections, conflict-safe employee binding, bounded roster-based auto-verification, and responsive Admin review UI for release `0.13.0`.

**Architecture:** Keep authentication, employee binding, verification, and authorization in separate Worker domain boundaries. Add an empty, provenance-bearing `employee_roster` source table and a pure verification resolver; Admin binding updates only the target canonical user and an audit row in one D1 batch. The React app consumes the Worker projection and refreshes it after binding; the existing GAS adapter remains legacy-only and receives no new identity contract.

**Tech Stack:** React 19, Vite, Tailwind CSS, Cloudflare Worker, D1/SQLite migrations, Node built-in test runner, existing `SqliteD1` fixture.

**Spec:** `docs/superpowers/specs/2026-09-11-admin-identity-management-0.13.0-design.md`

## Global Constraints

- Target version is `0.13.0` in `package.json`, `package-lock.json`, `CHANGELOG.md`, and the UI changelog translation.
- `PENDING_VERIFICATION`, `EMPLOYEE_BIND_REQUIRED`, and `VERIFIED` are public authoritative identity states returned by the server.
- `VERIFIED` is never inferred or assigned by the frontend; stored `UNVERIFIED` projects to `PENDING_VERIFICATION`.
- Authentication, employee binding, verification, and authorization remain separate concepts.
- Auto-verification requires exactly one active trusted roster row and no canonical ownership conflict or ambiguity.
- Admin binding is separate from manual verification approval; this slice adds no manual approval mutation.
- Worker + D1 is the only production backend. Do not modify GAS source, GAS APIs, GAS Sheets, or add GAS identity parity.
- Do not seed or migrate remote D1, deploy, commit, push, or tag.
- Preserve `0.12.1` behavior for LINE, employee guest, View As, role, balance, order, and audit flows unless a requirement explicitly changes the public identity state name.

### Task 1: Record the retired-GAS governance boundary and release contract

**Files:**
- Modify: `AGENTS.md`
- Modify: `agent.yaml`
- Modify: `.env.example`
- Modify: `worker-poc/README.md`
- Modify: `docs/react-worker-cutover-matrix.md`
- Modify: `worker-poc/docs/canonical-identity-guest-access.md`
- Modify: `worker-poc/docs/identity-foundation-cutover.md`
- Modify: `worker-poc/docs/remote-import-readiness.md`
- Modify: `worker-poc/docs/remote-provisional-auth-rollout.md`
- Modify: `src/api/transportConfig.js`
- Modify: `src/auth/bootFlow.js`
- Test: `worker-poc/tests/runtime-config.test.js`
- Test: `tests/identity-foundation-ui.test.cjs`

**Interfaces:**
- Consumes: current Worker formal runtime and existing GAS legacy adapter.
- Produces: a documented Worker-only production boundary and Worker as the default omitted frontend transport; explicit `gas` remains accepted only for legacy compatibility tests.

- [ ] **Step 1: Add the governance statement**

  Add an `Active production architecture` section to `AGENTS.md` stating that Cloudflare Worker + D1 is the sole production backend, GAS is retired legacy evidence, and no new feature may add GAS behavior without explicit user authorization. Update current Worker/cutover docs so they no longer say GAS is the production default; leave historical design records unchanged.

- [ ] **Step 2: Make the default transport Worker**

  Change the omitted transport fallback in `src/api/transportConfig.js` from `API_TRANSPORTS.GAS` to `API_TRANSPORTS.WORKER`. Change the `resolveAuthBootPlan` default in `src/auth/bootFlow.js` to `worker`; keep explicit `VITE_API_TRANSPORT=gas` accepted so legacy tests and the adapter remain isolated.

- [ ] **Step 3: Update runtime assertions**

  Extend runtime/config tests to assert omitted transport selects Worker and requires `VITE_WORKER_API_URL`. Update the current cutover documentation assertions to describe GAS as `LEGACY_ONLY`, not an active production fallback.

- [ ] **Step 4: Verify the documentation/config-only change**

  Run `node --test worker-poc/tests/runtime-config.test.js tests/identity-foundation-ui.test.cjs`.

  Expected: existing runtime config and auth boot tests pass, with no `.gs` file changed.

### Task 2: Add the D1 trusted employee source and server state projection

**Files:**
- Create: `worker-poc/migrations-formal/0004_employee_roster_verification_source.sql`
- Modify: `worker-poc/src/auth/permissions.js`
- Modify: `worker-poc/src/db/users.js`
- Create: `worker-poc/src/domain/employeeVerification.js`
- Modify: `worker-poc/src/domain/adminSummary.js`
- Test: `worker-poc/tests/formal-schema.test.js`
- Test: `worker-poc/tests/employee-verification.test.js`
- Test: `worker-poc/tests/identity-foundation-contract.test.js`

**Interfaces:**
- Consumes: `users.employee_id`, `users.active`, `users.verification_status`, existing partial unique employee index, normalized ownership index, and D1 transaction helpers.
- Produces: `IDENTITY_STATES.PENDING_VERIFICATION`, `ACTIONS.ADMIN_EMPLOYEE_BIND`, `publicUser(user)`, `resolveEmployeeVerification(database, employeeId)`, and member rows containing `authSource`, `identityState`, and `verificationStatus`.

- [ ] **Step 1: Write migration/schema tests**

  Add `employee_roster` to the formal table inventory and both
  `idx_employee_roster_employee_id` and `users_employee_id_normalized_unique`
  to the index inventory. Assert the table has `roster_id`, `employee_id`,
  `active`, `provenance`, `source_ref`, `created_at`, and `updated_at`, and
  that duplicate employee IDs can be inserted so runtime ambiguity is
  representable.

- [ ] **Step 2: Add the empty forward migration**

  Create `0004_employee_roster_verification_source.sql` with:

  ```sql
  CREATE TABLE IF NOT EXISTS employee_roster (
    roster_id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    provenance TEXT NOT NULL
      CHECK (provenance IN ('TRUSTED_IMPORT', 'ADMIN_APPROVED')),
    source_ref TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_employee_roster_employee_id
    ON employee_roster(employee_id);
  ```

  Do not insert rows, add a unique constraint to the roster, or touch remote D1.
  The accepted employee ID remains the import contract's textual form
  (`[A-Za-z0-9][A-Za-z0-9._-]*`). Worker lookups normalize trim/case, and
  `users_employee_id_normalized_unique` makes case-variant ownership
  collisions fail closed.

- [ ] **Step 3: Define state/capability constants**

  Add `PENDING_VERIFICATION: 'PENDING_VERIFICATION'` to `IDENTITY_STATES`. Add `ADMIN_EMPLOYEE_BIND: 'ADMIN_EMPLOYEE_BIND'` to `ACTIONS`; include it in the Admin role action set and never in `GUEST_ACTIONS`. Keep the compatibility `EXISTING_UNVERIFIED_EMPLOYEE` constant for onboarding tests, but make new canonical projections use `PENDING_VERIFICATION`.

- [ ] **Step 4: Implement the pure roster decision**

  In `employeeVerification.js`, export:

  ```js
  export const VERIFICATION_DECISIONS = Object.freeze({
    AUTO_VERIFIED: 'AUTO_VERIFIED',
    PENDING_TRUST_REVIEW: 'PENDING_TRUST_REVIEW',
    NO_CHANGE: 'NO_CHANGE'
  });

  export const resolveEmployeeVerification = async (database, employeeId) => ({
    verificationStatus: 'VERIFIED' | 'UNVERIFIED',
    identityState: 'VERIFIED' | 'PENDING_VERIFICATION',
    decision: 'AUTO_VERIFIED' | 'PENDING_TRUST_REVIEW',
    reason: 'TRUSTED_UNIQUE_ACTIVE' | 'NO_TRUSTED_MATCH'
      | 'INACTIVE_OR_UNTRUSTED_MATCH' | 'AMBIGUOUS_MATCH'
  });
  ```

  Query every roster row for the normalized ID. Return auto-verified only when exactly one row exists and it is active with allowed provenance. Any zero, duplicate, inactive, or untrusted result returns pending. Keep employee ID parsing textual, preserve leading zeroes, and accept the existing import format rather than a frontend-defined fixed width.

- [ ] **Step 5: Project server-owned user state**

  Extend `publicUser` to include `authSource`, `identityState`, and `verificationStatus`. Use `LINE` only for a non-empty `line_user_id`; otherwise use `EMPLOYEE_GUEST`. Derive `identityState` through the Worker domain state function: missing employee ID is `EMPLOYEE_BIND_REQUIRED`, stored `UNVERIFIED` is `PENDING_VERIFICATION`, and active verified users are `VERIFIED`. Do not add frontend-only status fields to the API.

- [ ] **Step 6: Verify state and schema behavior**

  Run `node --test worker-poc/tests/formal-schema.test.js worker-poc/tests/employee-verification.test.js worker-poc/tests/identity-foundation-contract.test.js`.

  Expected: fresh in-memory formal D1 has the empty roster table; unique trusted, missing, inactive, untrusted, and duplicate roster fixtures produce the specified server decisions.

### Task 3: Apply bounded auto-verification to identity-establishing mutations

**Files:**
- Modify: `worker-poc/src/domain/guestAccess.js`
- Test: `worker-poc/tests/guest-access.test.js`
- Test: `worker-poc/tests/employee-verification.test.js`

**Interfaces:**
- Consumes: `resolveEmployeeVerification(database, employeeId)` and current guest/LINE binding mutation paths.
- Produces: guest onboarding and LINE binding responses with `PENDING_VERIFICATION` or `VERIFIED` only when the server trust rule allows it; no automatic promotion on guest login read.

- [ ] **Step 1: Add failing mutation tests**

  Add tests for `completeEmployeeGuestOnboarding` and the unknown-ID LINE binding path:

  ```js
  test('trusted unique employee auto-verifies provisional onboarding', async () => {
    // seed exactly one active TRUSTED_IMPORT roster row, complete onboarding
    // and assert verification_status = VERIFIED and identityState = VERIFIED.
  });

  test('missing or ambiguous employee source remains pending', async () => {
    // omit the roster row or insert two matching rows, complete onboarding
    // and assert verification_status = UNVERIFIED and identityState = PENDING_VERIFICATION.
  });
  ```

  Add regression assertions that a guest ID alone still creates no verified canonical user and that existing LINE binding conflict/idempotency behavior remains unchanged.

- [ ] **Step 2: Thread the resolver into creation/update batches**

  Resolve the submitted employee ID before building the insert/update statement. Bind `verification_status` from the decision, preserving role `User`, balance `0`, canonical ownership, and existing profile fields. Keep guest login read-only with respect to an already pending canonical row.

- [ ] **Step 3: Return the authoritative decision**

  Include `verificationDecision`, `verificationStatus`, `identityState`, and `publicUser(user)` in successful mutation responses. Never accept a client verification field or role/balance field.

- [ ] **Step 4: Verify identity regressions**

  Run `node --test worker-poc/tests/guest-access.test.js worker-poc/tests/line-binding-concurrency.test.js worker-poc/tests/employee-verification.test.js`.

  Expected: trusted unique records auto-verify, missing/inactive/untrusted/ambiguous records remain pending, and existing LINE/guest collision tests pass.

### Task 4: Implement the Admin-only binding route with atomic audit

**Files:**
- Modify: `worker-poc/src/routes/admin.js`
- Create: `worker-poc/src/domain/adminIdentity.js`
- Modify: `worker-poc/src/auth/permissions.js`
- Test: `worker-poc/tests/admin-identity.test.js`
- Test: `worker-poc/tests/permissions.test.js`

**Interfaces:**
- Consumes: `requireIdentity`, `assertCan`, `getUserById`, `getUserByEmployeeId`, `resolveEmployeeVerification`, `auditStatement`, and `runMutationBatch`.
- Produces: `POST /api/admin/users/:userId/employee-binding` with `BOUND`/`ALREADY_BOUND`, `EMPLOYEE_ID_ALREADY_BOUND`, `USER_EMPLOYEE_ALREADY_BOUND`, and audited atomic state transitions.

- [ ] **Step 1: Write route/domain security tests**

  Add tests covering:

  ```js
  test('Admin binds a null employee ID without changing role or balance', async () => {
    // POST as a verified LINE Admin; assert 200, target employee ID,
    // server decision/state, unchanged role/balance, and one audit row.
  });

  test('non-Admin and guest principals are denied', async () => {
    // call the route as User, ProxyAdmin, and employee_guest; assert 403.
  });

  test('employee ownership conflict fails closed', async () => {
    // another canonical user owns the submitted ID; assert 409 and unchanged target.
  });

  test('same user and same employee ID is idempotent', async () => {
    // submit the same request twice; assert success/ALREADY_BOUND and no duplicate ownership.
  });
  ```

  Also assert forged body role, balance, `lineUserId`, and verification fields have no effect, and View As query state cannot authorize the mutation.

- [ ] **Step 2: Implement target and input validation**

  Decode the route target as a canonical `user_id`; parse the body as an object containing only a textual `employeeId`. Reject malformed IDs, missing target, an already-different target employee ID, and inactive targets before mutation.

- [ ] **Step 3: Implement the atomic binding**

  Require `ADMIN_EMPLOYEE_BIND` on the authenticated `identity.authorizationActor`. Read the target and employee owner, resolve the roster decision, then batch:

  ```text
  UPDATE users
    SET employee_id = ?, verification_status = ?, updated_at = ?
    WHERE user_id = ? AND employee_id IS NULL
  INSERT admin_audit_log (... action = 'ADMIN_EMPLOYEE_BIND' ...)
  ```

  Treat unique-constraint failure as `EMPLOYEE_ID_ALREADY_BOUND` unless a readback proves same-user idempotency. Make the `BOUND` audit insert conditional on the preceding update changing one row so a rejected concurrent update cannot create a false `BOUND` event. Audit both `BOUND` and `ALREADY_BOUND` outcomes with actor/target snapshots, submitted ID digest, trust decision, and result; do not store tokens or raw credentials.

- [ ] **Step 4: Add route matching**

  Match only `POST /api/admin/users/:userId/employee-binding`, call `requireIdentity` with `allowViewAs: false`, and return the domain result through `jsonResponse`. Do not add a manual verification approval route in this slice.

- [ ] **Step 5: Verify Admin security**

  Run `node --test worker-poc/tests/admin-identity.test.js worker-poc/tests/permissions.test.js`.

  Expected: Admin success and idempotency pass; User, ProxyAdmin, guest, conflicts, malformed requests, and forged body authority fail closed; the audit and target snapshots are present.

### Task 5: Add the Worker frontend adapter and authoritative refresh flow

**Files:**
- Modify: `src/api/apiClientCore.js`
- Modify: `src/api/apiErrors.js`
- Modify: `src/App.jsx`
- Modify: `src/auth/bootFlow.js`
- Modify: `src/auth/permissions.js`
- Modify: `src/auth/mockData.js`
- Test: `tests/identity-foundation-ui.test.cjs`
- Test: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- Consumes: Worker binding route and server-returned `authSource`/`identityState`/`verificationStatus`.
- Produces: `apiClient.adminBindEmployee({ userId, employeeId })`, an Admin-only binding dialog, and a post-success authoritative member/identity reload with no local verification elevation.

- [ ] **Step 1: Write adapter and authority tests**

  Assert the Worker adapter sends:

  ```js
  {
    method: 'POST',
    path: '/api/admin/users/user-1/employee-binding',
    body: { employeeId: '001234' },
    headers: { Authorization: 'Bearer line-token' }
  }
  ```

  Assert no `adminUserId`, role, balance, `verificationStatus`, or raw LINE ID is sent in the body. An explicit legacy GAS client must expose no binding operation; the UI must guard the operation to Worker transport before any call.

- [ ] **Step 2: Implement the Worker adapter**

  Add `adminBindEmployee` beside the Worker admin operations. Encode the canonical path user ID and send only `{ employeeId }` with `credentialMode: 'line'`. Do not add a GAS operation.

- [ ] **Step 3: Add safe API error copy**

  Add presentation messages for `EMPLOYEE_ID_ALREADY_BOUND`, `USER_EMPLOYEE_ALREADY_BOUND`, `EMPLOYEE_BIND_REQUIRED`, `PENDING_TRUST_REVIEW`, and `TRUSTED_UNIQUE_ACTIVE` without exposing server credentials or identity secrets.

- [ ] **Step 4: Implement the binding dialog handler**

  In `App.jsx`, guard the handler with authenticated Admin capability, Worker transport, target `userId`, and `employeeId === null`. Call `apiClient.adminBindEmployee`; after success close the dialog and call `loadMemberBalances(true)`. If the target is the current authenticated user, call `apiClient.getIdentity()` and apply its server response. Do not call `setMemberBalances` with a locally modified employee ID or verification state.

- [ ] **Step 5: Extend mock fixtures without client authority**

  Add server-shaped status fields to mock member responses. The binding operation remains Worker-only; the UI does not expose a mock or GAS mutation shortcut, and no client-supplied verification flag is accepted.

- [ ] **Step 6: Verify adapter/refresh wiring**

  Run `node --test tests/identity-foundation-ui.test.cjs tests/strict-identity-ledger.test.cjs`.

  Expected: adapter request shape, no client authority, refresh behavior, existing LINE/guest/View As regression assertions pass. Existing baseline ledger failures must be compared with the captured `0.12.1` baseline and not hidden.

### Task 6: Build the compact identity badges, filters, member list, and View As status UI

**Files:**
- Create: `src/components/IdentityStatusBadges.jsx`
- Create: `src/features/balances/identityStatus.js`
- Modify: `src/features/balances/MemberBalanceManagement.jsx`
- Modify: `src/App.jsx`
- Modify: `src/auth/bootFlow.js`
- Test: `tests/identity-foundation-ui.test.cjs`

**Interfaces:**
- Consumes: server fields exactly named `authSource`, `identityState`, and `verificationStatus`.
- Produces: status labels `LINE`/`非 LINE`, `待綁員編`, `待審核`, `已驗證`; filters `全部`, `待綁員編`, `待審核`, `已驗證`; shared badge rendering in member rows and View As modal.

- [ ] **Step 1: Add pure server-state mapping tests**

  Test `getIdentityBadges(member)` with server fixtures:

  ```js
  assert.deepEqual(getIdentityBadges({ authSource: 'LINE', identityState: 'VERIFIED' }), [
    { kind: 'source', label: 'LINE' },
    { kind: 'state', label: '已驗證' }
  ]);
  assert.deepEqual(getIdentityBadges({ authSource: 'EMPLOYEE_GUEST', identityState: 'PENDING_VERIFICATION' }), [
    { kind: 'source', label: '非 LINE' },
    { kind: 'state', label: '待審核' }
  ]);
  ```

  Unknown server values return `待確認`; no function may derive a state from `employeeId`, `role`, or a local boolean.

- [ ] **Step 2: Implement the shared badge component**

  Render only the pure mapping result from `identityStatus.js` with compact, non-wrapping classes and accessible text. The state badge must use `identityState === 'EMPLOYEE_BIND_REQUIRED'`, `PENDING_VERIFICATION`, or `VERIFIED` from the response.

- [ ] **Step 3: Implement responsive member management**

  Keep a medium/desktop table with the required columns and add a small-screen card/two-line row layout. Both layouts show name, employee ID, source badge, state badge, floor, balance, role, and action. For a null ID show `未綁定` and an Admin-only `綁員編` button. Do not increase the table minimum width as the mobile solution.

- [ ] **Step 4: Add server-response filters**

  Filter `memberBalances` with a component-local selected filter. `全部` returns all rows; the other filters compare only exact server `identityState` values. Unknown states remain visible under `全部` and are excluded from named filters.

- [ ] **Step 5: Reuse the same status UI in View As**

  Replace the View As modal’s employee/floor/role-only summary with the shared badges and status fields. Keep `handleSelectViewAs` read-only and preserve authenticated/effective identity separation.

- [ ] **Step 6: Verify UI requirements**

  Run `node --test tests/identity-foundation-ui.test.cjs`.

  Expected: all required labels, filters, null fallback, responsive classes, shared View As status rendering, and no client-side state elevation assertions pass.

### Task 7: Complete versioning, architecture documentation, and release evidence

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `src/data/changelog.js`
- Modify: `docs/identity-verification-architecture.md`
- Modify: `worker-poc/docs/canonical-identity-guest-access.md`
- Modify: `worker-poc/migrations-formal/README.md`
- Modify: `worker-poc/tests/runtime-config.test.js`
- Modify: `tests/changelog-migration.test.cjs`

**Interfaces:**
- Consumes: implemented Worker/D1 identity contract and captured remote migration boundary.
- Produces: release `0.13.0`, English developer changelog, Traditional Chinese UI history, and architecture documentation that future agents can use without treating GAS as active.

- [ ] **Step 1: Write architecture documentation tests**

  Assert the architecture document contains the four-way separation, trusted roster rule, exception-based review, Admin binding policy, uniqueness, server authority, and `REMOTE MIGRATION: NOT EXECUTED` boundary. Assert no current document says GAS is the active production backend.

- [ ] **Step 2: Add the architecture document**

  Create `docs/identity-verification-architecture.md` with the final public state table, trust decision matrix, API request/response, security invariants, separate future manual approval boundary, and Worker-only production rule. Update the current Worker identity/migration docs with `0004` and the required backup/apply/verify/deploy order, without running it.

- [ ] **Step 3: Update release metadata**

  Set package and lock versions to `0.13.0`. Add an English `0.13.0` changelog entry for the Worker Admin identity management feature. Add a Traditional Chinese `0.13.0` UI translation describing badges, filters, binding, pending review, and bounded auto-verification.

- [ ] **Step 4: Verify migration/docs/version contract**

  Run `node --test tests/changelog-migration.test.cjs worker-poc/tests/runtime-config.test.js`.

  Expected: release sequence, UI translation, migration list, Worker-only governance, and remote-not-executed assertions pass.

### Task 8: Run the complete high-risk verification and independent review

**Files:**
- Modify: only files required by findings from Tasks 1–7
- Test: all declared and Worker formal test suites

**Interfaces:**
- Consumes: the complete uncommitted feature diff and the captured clean `0.12.1` baseline.
- Produces: evidence-backed PASS/FAIL/NOT RUN/NOT VERIFIED handoff with baseline attribution, security review, and no repository commit.

- [ ] **Step 1: Run Worker formal verification**

  From `worker-poc`, run `npm.cmd test` if the declared Worker dependencies are available. Record the exact exit status, test count, and any environment/dependency failure separately from root verification.

- [ ] **Step 2: Run repository-declared verification in order**

  From the isolated worktree, run:

  ```powershell
  node --test tests/strict-identity-ledger.test.cjs
  npm.cmd run lint
  npm.cmd run build
  ```

  Use `npm.cmd` on Windows. Compare root test failures to the pre-mutation `0.12.1` baseline; label any remaining failure `PRE_EXISTING_FAILURE` only when the exact failure is stable and not implicated by this diff.

- [ ] **Step 3: Run the capability probe**

  Run `& .\tools\get-toolchain-capabilities.ps1` and record its exit status/output. Do not use it as a replacement for test/lint/build.

- [ ] **Step 4: Review the diff for security and scope**

  Check `git diff --check`, `git status --short`, changed paths, and all Worker route/domain tests. Confirm no `.gs` file, GAS API action, remote migration, D1 seed, deployment, commit, push, or tag was introduced. Confirm no frontend code writes `employee_id` or `VERIFIED`.

- [ ] **Step 5: Request independent code review**

  Provide a reviewer the feature description, this plan/spec, the baseline commit `60fe511`, and the current uncommitted diff. Fix Critical/Important findings before handoff; report review findings separately from automated verification.

- [ ] **Step 6: Produce the final handoff**

  Report A–I requested by the user, plus changed files, verification statuses for every required command/manual entry, baseline attribution, independent review, pre-existing change preservation, commit/push/deploy/tag status, remote D1 impact, and remaining follow-up. Suggested commit title: `feat(admin): add authoritative identity review management`.
