# 0.13.0 Identity / Verification Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax to track completion.

**Goal:** Simplify the 0.13.0 identity flow so an active LINE canonical user
with an employee ID is immediately registered and receives canonical role
capabilities, while preserving the safe atomic employee_guest provisional
claim contract.

**Architecture:** The formal Cloudflare Worker remains the only production
identity and authorization authority. Worker identity projection will use
auth mode, active state, employee ownership, and canonical role; the existing
verification fields and roster table remain compatibility data only. The
existing authenticated LINE employee-binding endpoint will retain normal
binding, same-survivor idempotence, and the D1 batch claim/retire/revoke/audit
operation, with all ownership guards rechecked inside the batch.

**Tech Stack:** Cloudflare Worker, D1 SQLite, prepared statements,
D1Database.batch(), Node test runner, React, Vite, LIFF, and the existing
formal migration/test harness.

**Spec:** docs/superpowers/specs/2026-09-12-identity-verification-simplification-design.md

## Global Constraints

- Production backend is the formal Cloudflare Worker + D1. Do not add GAS
  identity, authorization, or business logic.
- The request contract remains POST /api/auth/line-employee-bind. The
  frontend must not send claim=true, lineUserId, verificationStatus, or a
  provisional user id.
- The authoritative registered predicate is active=1 + authMode=LINE +
  employee_id exists. verification_status and employee_roster must not
  participate in registered, authorization, binding, claim, View As, or
  normal application access.
- A bound LINE canonical user keeps its stored role, including Admin or
  ProxyAdmin. An active LINE Admin with an employee ID receives Admin
  capabilities even when historical verification_status=UNVERIFIED.
- An active employee_guest principal is guest-only regardless of stored role.
  A guest stored role=Admin or ProxyAdmin must not receive privileged
  capabilities.
- Binding decisions are: no owner -> normal binding; owner is survivor ->
  idempotent success; another owner explicitly matching the claimable
  employee_guest predicate -> atomic claim; every other existing owner ->
  409 EMPLOYEE_ID_ALREADY_BOUND.
- Claimable provisional evidence requires historical matching
  employee_guest_sessions provenance, unique/non-ambiguous normalized
  ownership, no unsafe business ownership, and the existing privileged
  provisional-owner safety guard. It must not require revoked_at IS NULL or
  expires_at > now for provenance.
- True business ownership blockers are orders.user_id,
  balance_ledger.user_id, opening_balance_snapshots.user_id, likes.user_id,
  and idempotency_keys.actor_user_id. Audit/history references and guest
  session evidence are not blockers.
- Claim mutation uses prepared statements in one D1Database.batch(). Every
  required one-row DML is immediately followed by the SQL-level
  employee_guest_sessions.token_hash NOT NULL assertion. JavaScript after
  batch() must never decide whether to rollback.
- Session revoke and its postcondition use exactly this predicate, with the
  employee-id/user-id OR group parenthesized:

  ~~~sql
  auth_mode = 'employee_guest'
  AND revoked_at IS NULL
  AND expires_at > batch_clock
  AND (
    (
      employee_id IS NOT NULL
      AND length(trim(employee_id)) > 0
      AND UPPER(trim(employee_id)) = normalized_employee_id
    )
    OR user_id = retired_provisional_user_id
  )
  ~~~

- The test-only in-transaction race trigger/hook must live entirely in the
  test database or test harness. Do not add a production flag, callback,
  trigger, or injection branch to employeeClaim.
- Do not modify or remove migrations 0003/0004, verification_status,
  employee_roster, or the token_hash NOT NULL constraint.
- Do not add provisioning_source, merged_into_user_id, an assertion table,
  or another permanent lineage schema.
- Do not hard-delete provisional rows, re-parent business data, modify remote
  D1, deploy frontend, merge main, or perform manual remote cleanup.
- Preserve the existing CORS fix as its own commit. Do not amend it or mix
  this identity simplification into it.
- Do not commit, push, or deploy implementation changes until the current
  user explicitly authorizes that operation.

---

### Task 0: Establish the protected baseline and ownership inventory

Files:

- Read only: agent.yaml
- Read only: AGENTS.md
- Read only: worker-poc/migrations-formal/0002_canonical_identity_rekey.sql
- Read only: worker-poc/migrations-formal/0003_provisional_employee_identity.sql
- Read only: worker-poc/migrations-formal/0004_employee_roster_verification_source.sql
- Read only: the four historical spec/plan files named in the superseding spec

Interfaces:

- Consumes: the repository start state and the approved simplification spec.
- Produces: a start-state ledger, baseline verification results, and a
  current-schema ownership map used by Tasks 1–3.

- [ ] Step 1: Record the protected Git start state

  Run from the repository root:

  ~~~powershell
  git status --short --branch
  git diff --
  git diff --cached
  git ls-files --others --exclude-standard
  ~~~

  Expected: existing untracked historical claim spec/plan and the current
  simplification spec remain listed and are not edited, staged, or deleted.
  Any additional pre-existing path is added to the protected ledger before
  implementation begins.

- [ ] Step 2: Validate the repository manifest and declared skills

  Read agent.yaml and verify schema_version=2, shared source ref
  agent-platform v0.7.0, and the declared local paths
  .agents/skills/ap-safe-preflight and .agents/skills/ap-verification-core.
  Read both declared SKILL.md files completely before mutation. Reject a
  mutation if a declared path is missing or has an unsupported manifest
  entry.

- [ ] Step 3: Capture the deterministic baseline

  Run the current commands before touching runtime files:

  ~~~powershell
  npm --prefix worker-poc run test:formal
  node --test tests/strict-identity-ledger.test.cjs
  npm run lint
  npm run build
  ~~~

  Record each command, exit status, output summary, and baseline attribution.
  A later failure may be called PRE_EXISTING_FAILURE only when the same
  baseline failure and current failure are both recorded.

- [ ] Step 4: Build the direct ownership map from the formal schema

  Inspect all current formal tables and references with:

  ~~~powershell
  rg -n "CREATE TABLE|INSERT INTO|UPDATE |DELETE FROM|user_id|actor_user_id|operator_user_id|target_user_id" worker-poc/migrations-formal
  rg -n "orders\\.user_id|balance_ledger\\.user_id|opening_balance_snapshots\\.user_id|likes\\.user_id|idempotency_keys\\.actor_user_id|admin_audit_log|order_status_history" worker-poc/src worker-poc/migrations-formal
  ~~~

  Record the five business ownership blockers, the order-history/audit
  references that are retained, and any additional current direct ownership
  relation that requires an explicit guard. Do not create a catch-all
  audit/history dependency query.

- [ ] Step 5: Confirm historical documents and CORS boundary

  Verify the four historical spec/plan files are unchanged and identify the
  existing CORS commit with:

  ~~~powershell
  git log --oneline --decorate -8
  git show --stat --oneline e2bfa6208c49c48613fc0eeea8de960d5f859271
  ~~~

  Do not stage or edit either historical claim document or the CORS commit.

---

### Task 1: Replace verification-gated Worker identity and capabilities

Files:

- Modify: worker-poc/src/auth/permissions.js
- Modify: worker-poc/src/auth/identity.js
- Modify: worker-poc/src/db/users.js
- Modify: worker-poc/src/domain/users.js
- Test: worker-poc/tests/permissions.test.js
- Test: worker-poc/tests/identity-foundation-contract.test.js
- Test: worker-poc/tests/read-only.test.js

Interfaces:

- Consumes: the formal users row and the existing auth mode boundary.
- Produces:
  - isRegisteredLinePrincipal(principal)
  - capabilitiesFor(role, authMode, active, employeeId,
    employeeBindingRequired)
  - can(role, action, authMode, active, employeeId,
    employeeBindingRequired)
  - identityStateFor(principal)
  - actorFromUser with verificationStatus retained only as a serialized
    historical field.

- [ ] Step 1: Write the new central permission assertions

  Replace the old UNVERIFIED Admin expectations with these concrete
  assertions in worker-poc/tests/permissions.test.js:

  ~~~js
  const admin = {
    actor: {
      userId: 'line-admin',
      lineUserId: 'line-admin-id',
      employeeId: '139653',
      role: 'Admin',
      active: true,
      registered: true,
      authMode: 'line',
      verificationStatus: 'UNVERIFIED'
    }
  };

  assert.equal(
    can('Admin', ACTIONS.ADMIN_ROLE, 'line', true, '139653', false),
    true
  );
  assert.equal(
    can('Admin', ACTIONS.ADMIN_TOP_UP, 'line', true, '139653', false),
    true
  );
  assert.doesNotThrow(() => assertCan(admin, ACTIONS.ADMIN_ROLE));
  assert.doesNotThrow(() => assertCan(admin, ACTIONS.ADMIN_TOP_UP));

  const guestAdmin = {
    actor: {
      userId: 'guest-admin-row',
      employeeId: '139653',
      role: 'Admin',
      active: true,
      registered: false,
      authMode: 'employee_guest',
      verificationStatus: 'UNVERIFIED'
    }
  };
  assert.throws(
    () => assertCan(guestAdmin, ACTIONS.ADMIN_ROLE),
    (error) => error.code === 'FORBIDDEN'
  );
  ~~~

- [ ] Step 2: Implement the registered-line predicate

  In permissions.js define one internal employee-id check and one exported
  predicate with this behavior:

  ~~~js
  const hasEmployeeId = (value) => String(value ?? '').trim().length > 0;

  export const isRegisteredLinePrincipal = (principal) => Boolean(
    principal?.authMode === 'line'
      && principal?.active === true
      && hasEmployeeId(principal?.employeeId)
  );
  ~~~

  verificationStatus must not be read by this predicate. Keep the canonical
  User, ProxyAdmin, Admin, and employee_guest action sets unchanged except
  for the auth-mode and registration boundary.

- [ ] Step 3: Refactor capabilitiesFor, can, and assertCan

  Use this parameter contract throughout Worker source and tests:

  ~~~js
  capabilitiesFor(
    role,
    authMode = 'line',
    active = true,
    employeeId = null,
    employeeBindingRequired = false
  )

  can(
    role,
    action,
    authMode = 'line',
    active = true,
    employeeId = null,
    employeeBindingRequired = false
  )
  ~~~

  The implementation order is:

  1. inactive -> [];
  2. employee_guest -> GUEST_ACTIONS, regardless of stored role;
  3. active LINE without an employee ID or with
     employeeBindingRequired=true -> only
     CAN_BIND_EMPLOYEE and CAN_VIEW_SELF_ONBOARDING_STATE;
  4. active LINE with an employee ID -> ROLE_ACTIONS[role];
  5. unknown role -> [].

  assertCan must accept only a registered active LINE principal, an active
  employee_guest principal for guest actions, or an active unbound LINE
  principal for its self binding actions. Remove verification_status from all
  capability decisions. Update every Worker call site found by:

  ~~~powershell
  rg -n "capabilitiesFor\\(|can\\(|isVerifiedPrincipal|isProvisionalPrincipal" worker-poc/src worker-poc/tests
  ~~~

- [ ] Step 4: Refactor actor and public identity projections

  In identity.js make actor.registered true only for active LINE users with a
  non-empty employee ID. Set actor.provisional only for the
  employee_guest path; a LINE user with verificationStatus=UNVERIFIED is not
  provisional. Keep actor.verificationStatus as an informational value.

  identityStateFor must return EMPLOYEE_BIND_REQUIRED for an unbound active
  LINE canonical user and the existing compatibility registered state for a
  bound active LINE canonical user. It may return legacy provisional states
  only for employee_guest or historical/non-active projections.

  View As must require active registered LINE identity plus VIEW_AS. Remove
  isVerifiedPrincipal as its gate and update imports. publicUser must retain
  verificationStatus output but derive bound LINE identityState from
  registered LINE shape, not from verificationStatus.

- [ ] Step 5: Simplify /api/me and self profile behavior

  In domain/users.js make the provisional branch depend on
  authMode=employee_guest or the explicit guest provisional marker only.
  For a bound LINE user with historical UNVERIFIED:

  - return registered=true;
  - return authMode=LINE;
  - return status=VERIFIED if the compatibility response requires it;
  - preserve verificationStatus=UNVERIFIED as informational;
  - return the normal application capabilities and public user.

  A LINE user with employee_id=NULL must still receive
  EMPLOYEE_BIND_REQUIRED and no role-based capabilities. A guest user retains
  the existing guest self/profile path.

- [ ] Step 6: Run the focused identity test set

  Run:

  ~~~powershell
  Push-Location worker-poc
  node --test tests/permissions.test.js tests/identity-foundation-contract.test.js tests/read-only.test.js
  Pop-Location
  ~~~

  Expected: registered LINE UNVERIFIED fixtures use role capabilities,
  unbound LINE Admin fixtures remain bind-only, and guest Admin fixtures
  remain forbidden. Do not proceed with stale PENDING expectations.

---

### Task 2: Remove roster decisions from normal binding and implement the simplified atomic claim

Files:

- Modify: worker-poc/src/domain/guestAccess.js
- Modify: worker-poc/src/domain/employeeClaim.js
- Modify: worker-poc/src/domain/employeeVerification.js
- Test: worker-poc/tests/employee-claim.test.js
- Test: worker-poc/tests/guest-access.test.js
- Test: worker-poc/tests/line-binding-concurrency.test.js
- Test: worker-poc/tests/formal-schema.test.js
- Test: worker-poc/tests/provisional-schema.test.js
- Test helper: worker-poc/tests/helpers/formal-fixtures.js
- Test helper: worker-poc/tests/helpers/formal-db.js

Interfaces:

- Consumes: registered-line identity from Task 1 and runMutationBatch from
  worker-poc/src/db/transactions.js.
- Produces:

  ~~~js
  claimProvisionalEmployee(
    database,
    {
      survivorUserId,
      lineUserId,
      employeeId,
      clock = new Date()
    }
  )
  ~~~

  The helper returns the existing binding/readback response shape and accepts
  no claim flag, verification value, or client-supplied provisional ID.

- [ ] Step 1: Rewrite the claim fixtures to represent the simplified state

  In formal-fixtures.js add fixture options that can create:

  - an active LINE survivor with role Admin, employee_id=NULL, and either
    verification_status value;
  - an active employee_guest owner with line_user_id=NULL, role User,
    employee_id=139653, and historical guest provenance;
  - owner sessions that are future/unrevoked, expired, revoked, or both;
  - loose sessions with user_id=NULL and matching employee_id;
  - unrelated non-guest or non-matching sessions;
  - a true row in each of the five business dependency tables;
  - duplicate normalized ownership in an isolated invalid test database.

  employee_roster is not seeded by any active binding/claim fixture.

- [ ] Step 2: Add the historical provenance regression before implementation

  Add a test named for the case where every matching provenance session is
  expired or revoked. It must call the existing authenticated LINE binding
  endpoint and assert that a claim succeeds. The test must also assert that
  no currently invalidated session is rewritten.

  The evidence query must use:

  ~~~sql
  SELECT session_id
  FROM employee_guest_sessions
  WHERE user_id = ?
    AND auth_mode = 'employee_guest'
    AND status = 'UNVERIFIED_EMPLOYEE'
    AND employee_id IS NOT NULL
    AND length(trim(employee_id)) > 0
    AND UPPER(trim(employee_id)) = ?
  LIMIT 1
  ~~~

  It must not add revoked_at or expires_at predicates.

- [ ] Step 3: Implement the exact read-only decision tree

  Normalize employeeId with employeeIdText. Read all canonical users whose
  normalized employee_id matches; do not authorize from getUserByEmployeeId's
  LIMIT 1 result. Resolve the authenticated LINE survivor from the server
  LINE user id.

  Classify in this order:

  1. no owner -> normal binding;
  2. owner is survivor -> idempotent readback;
  3. one other owner satisfying the full provisional predicate ->
     claimProvisionalEmployee;
  4. every other owner shape -> conflict EMPLOYEE_ID_ALREADY_BOUND;
  5. a qualifying provisional owner with any business dependency ->
     PROVISIONAL_IDENTITY_HAS_DEPENDENCIES.

  Keep the first read diagnostic only. The claim batch must independently
  re-check every condition.

- [ ] Step 4: Remove verification and roster from normal LINE binding

  In guestAccess.js remove resolveEmployeeVerification calls from:

  - no-owner LINE binding;
  - existing LINE survivor binding;
  - existing unbound-owner LINE attachment;
  - LINE canonical creation;
  - claim integration.

  Existing users keep their verification_status value. New rows use the
  existing schema compatibility default. Normal binding must return
  registered/BOUND compatibility output without PENDING_VERIFICATION. The
  existing guest onboarding status encoding may remain for employee_guest
  sessions.

- [ ] Step 5: Implement the simplified claimable owner predicate

  In employeeClaim.js require all of the following inside the mutation
  statement as well as in diagnostic classification:

  - active authenticated survivor;
  - exact survivor user_id and LINE user id;
  - survivor employee_id=NULL;
  - exactly one normalized canonical owner, different from survivor;
  - owner active=1;
  - owner line_user_id IS NULL;
  - owner normalized employee_id matches;
  - historical matching employee_guest session with
    auth_mode=employee_guest, status=UNVERIFIED_EMPLOYEE, owner user_id,
    and matching normalized employee_id;
  - no row in any of the five business dependency tables;
  - no competing or ambiguous canonical owner;
  - owner role is not Admin or ProxyAdmin, retaining the explicit
    privileged provisional-owner safety guard.

  Do not inspect owner.verification_status or employee_roster for
  claimability.

- [ ] Step 6: Use the SQL-level assertion for every required one-row mutation

  Use the existing assertion statement immediately after the survivor guard,
  owner release, owner retirement, survivor assignment, and audit insert:

  ~~~sql
  INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
  SELECT ?, NULL, ?
  WHERE changes() <> 1;
  ~~~

  Build the batch with runMutationBatch and no JavaScript between each guarded
  DML and its assertion. Do not inspect successful batch meta.changes to
  decide rollback.

- [ ] Step 7: Implement the ownership transfer without verification mutation

  Use this statement order in one D1 batch:

  1. guard the exact active unbound LINE survivor;
  2. assert one survivor row;
  3. release employee_id from the exact claimable owner;
  4. assert one release row;
  5. retire that exact owner with active=0 and employee_id=NULL;
  6. assert one retirement row;
  7. assign normalized employee_id to the unchanged survivor while preserving
     role, active, line_user_id, and verification_status;
  8. assert one assignment row;
  9. revoke sessions using the shared predicate in Step 8;
  10. run the identical shared predicate as a revoke postcondition; a
      remaining match causes token_hash=NULL NOT NULL failure, while zero
      matches is valid;
  11. insert exactly one PROVISIONAL_EMPLOYEE_CLAIMED audit event;
  12. assert one audit row.

  The audit metadata must contain survivor/actor user id, retired provisional
  user id, employeeIdDigest, outcome=CLAIMED, and no raw token. It may include
  the survivor's historical verificationStatus snapshot, but it must not
  contain a new roster decision.

- [ ] Step 8: Centralize and reuse the session predicate

  Define one trusted SQL fragment or builder in employeeClaim.js and use it
  for both the UPDATE and the postcondition EXISTS. Its generated SQL must
  contain exactly:

  ~~~sql
  auth_mode = 'employee_guest'
  AND revoked_at IS NULL
  AND expires_at > ?
  AND (
    (
      employee_id IS NOT NULL
      AND length(trim(employee_id)) > 0
      AND UPPER(trim(employee_id)) = ?
    )
    OR user_id = ?
  )
  ~~~

  Bind batch clock, normalized employee id, and retired owner id in the same
  order for both statements. The outer auth_mode/validity conditions must
  precede and constrain the parenthesized OR group.

- [ ] Step 9: Keep rollback classification fail closed

  After a TransactionError, read authoritative state only to classify an
  already-rolled-back result:

  - survivor owns the employee id -> idempotent success/readback;
  - another unsafe owner remains -> EMPLOYEE_ID_ALREADY_BOUND;
  - a claimable-shaped owner has a true dependency ->
    PROVISIONAL_IDENTITY_HAS_DEPENDENCIES;
  - all other cases -> retain transaction failure and do not report success.

  On success, read the survivor by user id and verify active=1, exact LINE
  binding, normalized employee id, preserved role, and unchanged
  verification_status. Never return a preflight object.

- [ ] Step 10: Add the test-database-only in-transaction race

  In the test database layer, create a temporary trigger that fires after the
  provisional owner release and changes the survivor to a competing employee
  value before the assignment statement. The trigger must be created and
  dropped inside the test fixture database; production employeeClaim must
  not receive a callback or test flag.

  The test must observe the thrown SQL/TransactionError and then assert:

  - provisional owner employee_id is restored to 139653;
  - provisional owner active is restored to 1;
  - survivor employee_id is restored to NULL;
  - all matching sessions remain unrevokeed;
  - no PROVISIONAL_EMPLOYEE_CLAIMED row exists.

  Also test the pre-batch ownership-change race and an invalid duplicate
  normalized owner fixture. Both must fail closed without partial state.

- [ ] Step 11: Verify the schema contract used by rollback

  Extend formal-schema.test.js and provisional-schema.test.js to assert:

  ~~~sql
  PRAGMA table_info(employee_guest_sessions);
  ~~~

  The token_hash row must report notnull=1. Keep the existing
  employee_guest_sessions status/auth_mode constraints and normalized
  employee ownership index. Do not alter a formal migration to make the
  test pass.

- [ ] Step 12: Run the focused claim and binding tests

  Run:

  ~~~powershell
  Push-Location worker-poc
  node --test tests/employee-claim.test.js tests/guest-access.test.js tests/line-binding-concurrency.test.js tests/formal-schema.test.js tests/provisional-schema.test.js
  Pop-Location
  ~~~

  Expected: normal no-owner binding, same-survivor idempotence, historical
  expired/revoked provenance, full claim postconditions, all rejection
  predicates, and the rollback race pass.

---

### Task 3: Align Admin employee-binding, View As, and guest authorization paths

Files:

- Modify: worker-poc/src/domain/adminIdentity.js
- Modify: worker-poc/src/auth/identity.js if Task 1 leaves a route-specific
  guard to remove
- Modify: worker-poc/src/routes/admin.js only if route wiring needs the
  central registered check
- Test: worker-poc/tests/admin-identity.test.js
- Test: worker-poc/tests/view-as.test.js
- Test: worker-poc/tests/roles.test.js
- Test: worker-poc/tests/admin-summary.test.js
- Test: worker-poc/tests/admin-topup.test.js
- Test: worker-poc/tests/calendar-admin.test.js
- Test: worker-poc/tests/announcements.test.js
- Test: worker-poc/tests/admin-announcements.test.js

Interfaces:

- Consumes: Task 1 central assertCan and isRegisteredLinePrincipal; Task 2
  unchanged canonical binding state.
- Produces: one authorization rule for Admin employee-binding and View As,
  with no roster or verification gate.

- [ ] Step 1: Add the registered Admin employee-binding regression

  In admin-identity.test.js create an active LINE canonical Admin with
  employee_id=139653 and verification_status=UNVERIFIED. Invoke the existing
  Admin employee-binding route and assert it reaches the normal Admin
  capability path rather than ADMIN_LINE_AUTH_REQUIRED.

  Create a second active LINE Admin with employee_id=NULL and assert the same
  route returns 403. This test proves stored role=Admin does not grant Admin
  employee-binding while the LINE identity is unbound.

- [ ] Step 2: Implement the exact Admin employee-binding guard

  In adminIdentity.js retain assertCan(identity, ACTIONS.ADMIN_EMPLOYEE_BIND)
  and add the explicit route precondition:

  ~~~js
  const actor = identity?.actor;
  const registeredAdmin = Boolean(
    actor
      && actor.active === true
      && actor.authMode === 'line'
      && actor.registered === true
      && String(actor.employeeId || '').trim()
      && actor.role === 'Admin'
  );
  if (!registeredAdmin) throw forbidden('ADMIN_LINE_AUTH_REQUIRED');
  ~~~

  Do not test verificationStatus. Remove resolveEmployeeVerification from
  this route and update only the employee_id field required by the Admin
  operation; do not change role or create approval metadata.

- [ ] Step 3: Exercise every Worker privileged capability with an unverified LINE Admin

  Add one active registered LINE Admin fixture with historical
  verification_status=UNVERIFIED and call the existing routes for:

  - GET /api/admin/summary;
  - GET /api/admin/members/balances;
  - POST /api/admin/balances/top-up;
  - PUT /api/admin/calendar/:date;
  - PUT /api/admin/users/:id/role;
  - POST, PATCH, and DELETE /api/admin/announcements;
  - POST /api/admin/users/:id/employee-binding;
  - an allowed View As read path.

  Assert that each route passes central authorization. Use isolated local
  fixtures and idempotency keys for mutating calls. Assert an Admin role
  mutation keeps the actor's role Admin and writes only its normal audit.

- [ ] Step 4: Prove guest and unbound boundaries remain closed

  Run the same privileged route matrix with:

  - employee_guest auth mode and stored role=Admin;
  - active LINE auth mode, stored role=Admin, employee_id=NULL;
  - inactive LINE Admin with an employee ID.

  Assert each protected mutation/read returns the existing 403/401 boundary,
  with no business or audit side effect. Assert guest tokens cannot invoke
  POST /api/auth/line-employee-bind.

- [ ] Step 5: Remove all remaining verification-specific route gates

  Search and eliminate active authorization uses:

  ~~~powershell
  rg -n "isVerifiedPrincipal|verification_status.*VERIFIED|verificationStatus.*VERIFIED|PENDING_VERIFICATION|resolveEmployeeVerification" worker-poc/src
  ~~~

  Remaining matches must be limited to legacy serialization, guest session
  compatibility, employeeVerification legacy code, or comments/docs that
  explicitly say they are not runtime authorization.

- [ ] Step 6: Run the focused authorization suite

  Run:

  ~~~powershell
  Push-Location worker-poc
  node --test tests/admin-identity.test.js tests/view-as.test.js tests/roles.test.js tests/admin-summary.test.js tests/admin-topup.test.js tests/calendar-admin.test.js tests/announcements.test.js tests/admin-announcements.test.js tests/permissions.test.js
  Pop-Location
  ~~~

  Expected: registered LINE Admin with either verification value is
  authorized by role; unbound LINE and employee_guest Admin remain denied.

---

### Task 4: Remove active LINE pending-verification UI and preserve guest compatibility

Files:

- Modify: src/App.jsx
- Modify: src/auth/bootFlow.js
- Modify: src/auth/permissions.js
- Modify: src/components/LineEmployeeLookup.jsx
- Modify: src/components/ProvisionalEmployeeOnboarding.jsx
- Modify: src/features/balances/identityStatus.js
- Modify: src/components/IdentityStatusBadges.jsx
- Modify: src/features/balances/MemberBalanceManagement.jsx
- Modify: src/api/apiErrors.js
- Modify: src/auth/mockData.js
- Test: tests/identity-foundation-ui.test.cjs
- Test: tests/admin-identity-ui.test.cjs

Interfaces:

- Consumes: /api/me registered/authMode/role projection from Task 1 and
  binding response from Task 2.
- Produces: normal application UI for active bound LINE users regardless of
  verificationStatus; guest-only legacy onboarding for employee_guest.

- [ ] Step 1: Add frontend fixtures for the two important Admin states

  In mockData.js add:

  1. active LINE Admin, employee_id=139653,
     verificationStatus=UNVERIFIED, registered=true;
  2. active LINE Admin, employee_id=NULL, registered=false,
     identityState=EMPLOYEE_BIND_REQUIRED;
  3. employee_guest stored role=Admin, registered=false.

  Assert that only the first fixture renders Admin navigation and that the
  second fixture renders the employee binding prompt.

- [ ] Step 2: Make boot and App state use registered first

  In App.jsx and bootFlow.js apply this order to /api/me:

  1. auth failure -> login;
  2. registered=true + authMode=LINE -> REGISTERED/application flow;
  3. authMode=LINE + employee_id=NULL -> binding-required flow;
  4. employee_guest provisional -> legacy guest onboarding;
  5. all other compatibility data -> safe non-registered state.

  Do not route a registered LINE user to UNVERIFIED, PENDING_VERIFICATION,
  EXISTING_UNVERIFIED_EMPLOYEE, or ProvisionalEmployeeOnboarding solely because
  verificationStatus is UNVERIFIED.

- [ ] Step 3: Remove review UI and update the binding copy

  Remove active LINE pending-review cards, filters, badges, and review actions
  from identityStatus.js, IdentityStatusBadges.jsx, and
  MemberBalanceManagement.jsx. Keep rendering verificationStatus only when
  an existing consumer needs an informational legacy field.

  Use this minimal bound LINE copy for the preserved role:

  > 員工編號已綁定；Admin 角色已保留，登入後依目前角色直接生效。

  Use neutral informational wording for any remaining legacy field:

  > 歷史核驗狀態僅供參考，不影響目前 LINE 登入權限。

  Do not use wording that promises pending review or future approval.

- [ ] Step 4: Keep the employee_guest onboarding component bounded

  ProvisionalEmployeeOnboarding.jsx may remain for employee_guest only. Its
  conditions must include authMode=employee_guest or the existing explicit
  guest provisional marker. It must never be selected for a bound LINE
  canonical user.

- [ ] Step 5: Align UI permissions with Worker semantics

  In src/auth/permissions.js keep role maps and the guest permission map, but
  make the UI permission function depend only on role, auth mode, and
  registered state. Do not pass verificationStatus as a visibility gate.
  The UI must continue to hide controls for guests and unbound LINE users,
  while Worker authorization remains authoritative.

- [ ] Step 6: Run the focused UI contract tests

  Run:

  ~~~powershell
  node --test tests/identity-foundation-ui.test.cjs tests/admin-identity-ui.test.cjs
  ~~~

  Expected: no active LINE pending-review UI/filter/copy remains; the
  unverified registered Admin receives normal Admin navigation and the
  unbound/guest fixtures do not.

---

### Task 5: Complete Worker regression coverage for state, dependency, provenance, and authorization

Files:

- Modify: worker-poc/tests/employee-verification.test.js
- Modify: worker-poc/tests/employee-claim.test.js
- Modify: worker-poc/tests/guest-access.test.js
- Modify: worker-poc/tests/permissions.test.js
- Modify: worker-poc/tests/admin-identity.test.js
- Modify: worker-poc/tests/view-as.test.js
- Modify: worker-poc/tests/admin-summary.test.js
- Modify: worker-poc/tests/admin-topup.test.js
- Modify: worker-poc/tests/calendar-admin.test.js
- Modify: worker-poc/tests/roles.test.js
- Modify: worker-poc/tests/announcements.test.js
- Modify: worker-poc/tests/admin-announcements.test.js
- Modify: worker-poc/tests/identity-foundation-contract.test.js
- Modify: worker-poc/tests/formal-schema.test.js
- Modify: worker-poc/tests/provisional-schema.test.js
- Modify: worker-poc/tests/line-binding-concurrency.test.js

Interfaces:

- Consumes: Tasks 1–4 runtime behavior and formal test fixtures.
- Produces: complete local regression evidence for the simplified 0.13.0
  contract.

- [ ] Step 1: Convert employee verification tests to legacy-only coverage

  Keep pure employee-id normalization, same-id comparison, digest, and
  legacy resolver unit tests. Mark roster decision tests as legacy helper
  tests. Add a source/spy assertion that active guestAccess,
  employeeClaim, and adminIdentity paths do not call employee_roster or
  resolveEmployeeVerification.

- [ ] Step 2: Assert the full claim success projection

  For the current 139653-equivalent fixture assert:

  - survivor line_user_id unchanged;
  - survivor employee_id=139653;
  - survivor active=1;
  - survivor role=Admin;
  - survivor verification_status unchanged, including UNVERIFIED;
  - response authSource=LINE and registered=true;
  - response identityState is not active PENDING_VERIFICATION;
  - provisional row remains, active=0, employee_id=NULL, line_user_id=NULL;
  - six currently valid matching sessions are revoked;
  - expired/revoked matching sessions remain historically unchanged;
  - exactly one PROVISIONAL_EMPLOYEE_CLAIMED audit exists;
  - audit contains digest, retired owner, outcome, and no raw token.

- [ ] Step 3: Assert every binding and claim rejection

  Cover:

  - no owner normal binding;
  - same survivor idempotent success with no second claim audit;
  - other LINE-bound owner -> EMPLOYEE_ID_ALREADY_BOUND;
  - owner with verification_status=VERIFIED -> only the other-owner
    decision applies; status alone is neither a bypass nor a special
    verification gate;
  - owner with no LINE but no historical employee_guest evidence ->
    EMPLOYEE_ID_ALREADY_BOUND;
  - privileged provisional owner -> EMPLOYEE_ID_ALREADY_BOUND;
  - duplicate normalized owner -> EMPLOYEE_ID_ALREADY_BOUND;
  - any true business dependency -> PROVISIONAL_IDENTITY_HAS_DEPENDENCIES;
  - audit/history reference alone -> successful claim;
  - guest token -> existing LINE authentication rejection.

- [ ] Step 4: Assert the shared revoke predicate

  Seed matching sessions for every class:

  - valid, unrevoked, employee id match, user_id=NULL;
  - valid, unrevoked, owner user_id match;
  - expired, unrevoked, owner user_id match;
  - valid, already revoked, owner user_id match;
  - valid, unrevoked, non-employee_guest with the owner user id;
  - valid, unrevoked, unrelated employee id.

  After claim, only the first two classes are revoked. Assert the exact
  predicate is present in both the UPDATE and postcondition source text, and
  assert the latter fails the transaction if a test-only obstruction leaves
  a valid match.

- [ ] Step 5: Assert active LINE authorization independent of verification

  For active registered LINE User, ProxyAdmin, and Admin fixtures, test the
  existing role action set twice: once with verification_status=VERIFIED and
  once with UNVERIFIED. Results must be identical.

  For employee_guest fixtures with each stored role, assert only guest actions.
  For active unbound LINE fixtures, assert only binding/onboarding actions.
  Include actual Admin mutation endpoints, not only direct permissions.js
  calls.

- [ ] Step 6: Run the complete formal Worker suite

  Run:

  ~~~powershell
  npm --prefix worker-poc run test:formal
  ~~~

  Record the exact exit status and failing test names if any. Do not suppress
  failures by deleting old tests; update expectations to the superseding
  contract and retain legacy schema tests.

---

### Task 6: Update active documentation and root contract tests without rewriting history

Files:

- Modify: docs/identity-verification-architecture.md
- Modify: worker-poc/docs/canonical-identity-guest-access.md
- Modify: worker-poc/README.md
- Modify: docs/react-worker-cutover-matrix.md when its active contract text
  mentions pending verification
- Modify: CHANGELOG.md
- Modify: src/data/changelog.js
- Modify: tests/strict-identity-ledger.test.cjs
- Modify: tests/changelog-migration.test.cjs
- Modify: tests/identity-foundation-ui.test.cjs if Task 4 leaves a root
  assertion to update
- Modify: tests/admin-identity-ui.test.cjs if Task 4 leaves a root
  assertion to update

Interfaces:

- Consumes: the final Worker/frontend contracts from Tasks 1–5.
- Produces: active documentation that no longer says roster verification is
  an access prerequisite, while all historical claim/rollout records remain
  immutable.

- [ ] Step 1: Rewrite active architecture statements

  In the active architecture docs explicitly state:

  - active LINE canonical + employee_id -> registered=true;
  - canonical role is authoritative after binding;
  - employee_guest remains guest-only;
  - verificationStatus is informational legacy data;
  - employee_roster is not runtime access trust;
  - PENDING_VERIFICATION is not an active LINE state;
  - claim uses historical guest provenance and the atomic D1 transfer;
  - business ownership dependencies fail closed;
  - audit/history references do not block safe claim.

- [ ] Step 2: Mark old runtime semantics as superseded without rewriting evidence

  Do not edit:

  - docs/superpowers/specs/2026-09-11-admin-identity-management-0.13.0-design.md;
  - docs/superpowers/plans/2026-09-11-admin-identity-management-0.13.0.md;
  - docs/superpowers/specs/2026-09-12-provisional-employee-claim-design.md;
  - docs/superpowers/plans/2026-09-12-provisional-employee-claim.md.

  Add a cross-reference from active docs to
  docs/superpowers/specs/2026-09-12-identity-verification-simplification-design.md
  instead of changing the historical records.

- [ ] Step 3: Update root contract tests

  Replace root assertions that treat UNVERIFIED Admin or PENDING_VERIFICATION
  as active LINE denial. Add assertions that frontend copy contains the
  preserved-role/immediate-capability wording and does not contain pending
  approval UI for bound LINE users.

- [ ] Step 4: Run root contract tests

  Run:

  ~~~powershell
  node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/identity-foundation-ui.test.cjs tests/admin-identity-ui.test.cjs
  ~~~

  Expected: migration files remain unchanged, historical schema contracts
  remain present, and active UI/identity text matches the simplified spec.

---

### Task 7: Perform local verification and defect-first review

Files:

- Read/verify: all changed files from Tasks 1–6
- Read/verify: .agents/skills/ap-verification-core/SKILL.md

Interfaces:

- Consumes: completed local implementation and the Task 0 baseline.
- Produces: separate automated verification, manual verification status,
  changed-file ledger, and independent defect-first review handoff.

- [ ] Step 1: Run the repository-declared checks in manifest order

  Run and record each command separately:

  ~~~powershell
  node --test tests/strict-identity-ledger.test.cjs
  npm run lint
  npm run build
  ~~~

  Also run the formal Worker suite:

  ~~~powershell
  npm --prefix worker-poc run test:formal
  ~~~

  Report PASS, FAIL, NOT RUN, or NOT VERIFIED for each. Attach
  NEW_FAILURE, PRE_EXISTING_FAILURE, or UNKNOWN_ATTRIBUTION to every failed
  command using the baseline evidence from Task 0.

- [ ] Step 2: Run scoped static and security checks

  Run:

  ~~~powershell
  git diff --check
  rg -n "claim=true|lineUserId|provisional user id|raw token|console\\.(log|error).*token|resolveEmployeeVerification|isVerifiedPrincipal|PENDING_VERIFICATION" worker-poc/src src
  rg -n "DROP TABLE|DELETE FROM users|DELETE FROM employee_guest_sessions|wrangler d1.*--remote|production-replace" worker-poc/src src
  git diff --name-only --diff-filter=ACMRTUXB
  ~~~

  Review every match manually. Allowed matches are compatibility field
  serialization, legacy-only helpers, tests/docs describing forbidden
  client fields, and the existing test/deployment scripts outside runtime.
  No production migration or remote cleanup command may appear in the
  implementation diff.

- [ ] Step 3: Run the capability probe and record limitations

  Use the declared read-only capability probe:

  ~~~powershell
  .\tools\get-toolchain-capabilities.ps1
  ~~~

  If the script is unavailable, record it as NOT RUN with the concrete
  missing-path reason; do not substitute an undeclared dependency probe.

- [ ] Step 4: Complete the independent defect-first review

  Review the diff against the spec for:

  - verification or roster use hidden behind a helper;
  - Admin capability leakage through stored role or unbound LINE state;
  - guest role escalation;
  - session revoke predicate drift or missing parentheses;
  - any post-batch JavaScript rollback assumption;
  - a release/retire/assignment partial state;
  - accidental business re-parenting;
  - raw token or employee identifier logging;
  - migration, CORS, frontend transport, or GAS scope drift.

  Record reviewer findings separately from automated test output. Do not call
  the implementation complete solely because tests pass.

- [ ] Step 5: Stop before release mutation

  At the end of Task 7, do not commit, push, deploy, merge main, modify
  remote D1, modify employee_roster, or perform cleanup unless the current
  user separately authorizes that exact operation.

---

### Task 8: Execute the remote transition only after explicit deployment authorization

Files:

- Deploy only: formal Worker artifact after a separate authorization
- Read only: remote Worker response, /api/me, D1 state, sessions, and audit

Interfaces:

- Consumes: Task 7 PASS results and a separate explicit deployment
  authorization.
- Produces: manual/external remote smoke evidence, or a STOP report with no
  manual repair.

- [ ] Step 1: Confirm the deployment gate

  Do not start this task from plan approval alone. Confirm the user has
  explicitly authorized formal Worker deployment and the real LINE smoke.
  Verify the deploy command preserves all runtime vars/secrets, including
  the existing remote-test CORS configuration when that environment is used.

- [ ] Step 2: Deploy only the formal Worker

  Use the existing worker-poc deployment mechanism. Do not deploy frontend,
  merge main, push an unrequested branch, run remote migrations, or change
  employee_roster.

- [ ] Step 3: Use the real LINE binding flow

  Call the existing authenticated POST /api/auth/line-employee-bind with only
  the existing employeeId input. Do not send claim=true, lineUserId,
  verificationStatus, or a provisional user id.

  If 139653 is already claimed, the request must be same-survivor
  idempotent success and must not append a second
  PROVISIONAL_EMPLOYEE_CLAIMED event.

- [ ] Step 4: Verify the simplified 139653 state read-only

  Expect:

  - LINE survivor active=1, employee_id=139653, line_user_id retained,
    role=Admin retained;
  - /api/me authSource=LINE, registered=true, employeeId=139653;
  - verificationStatus may remain UNVERIFIED but is informational only;
  - identityState/status does not route the survivor to active pending review;
  - provisional row retained, active=0, employee_id=NULL;
  - only currently valid/unrevoked matching employee_guest sessions revoked;
  - exactly one claim audit for the original transfer, with digest/outcome
    and no raw token;
  - Admin mutation capability works for the registered LINE Admin;
  - employee_roster is unchanged.

- [ ] Step 5: Apply the STOP rule

  If HTTP returns 409/500, any ownership/session/audit state differs, Admin
  authorization is not correct, or the authoritative readback is unavailable,
  stop immediately. Do not retry destructive operations, manually edit remote
  D1, delete the provisional row, revoke sessions by hand, or modify the
  roster. Report the exact external evidence and leave remote data untouched.

## Plan self-review

- [ ] Every A–H section of the superseding spec maps to at least one task.
- [ ] The two reviewed contract fixes are explicit: Admin
  employee-binding requires registered active LINE Admin, and revoke plus
  postcondition share the same parenthesized predicate.
- [ ] No task removes migrations or the token_hash NOT NULL constraint.
- [ ] No task uses verification_status or employee_roster for active
  authorization, registration, binding, claim, or View As.
- [ ] Historical guest evidence accepts expired and revoked sessions, while
  revocation touches only valid/unrevoked sessions.
- [ ] The test race is isolated to a temporary test database trigger/harness.
- [ ] No task introduces client claim fields, raw token logging, business
  re-parenting, manual remote cleanup, frontend deployment, or main merge.
- [ ] Task 7 separates automated results from manual/external evidence, and
  Task 8 has an explicit deployment authorization gate.

Plan complete and saved to
docs/superpowers/plans/2026-09-12-identity-verification-simplification.md.
