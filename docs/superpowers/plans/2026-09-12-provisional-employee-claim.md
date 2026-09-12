# Provisional Employee Claim/Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the formal provisional employee claim/merge flow through the existing authenticated LINE employee-binding endpoint. Transfer a claimable provisional employee owner to the authenticated LINE survivor atomically, preserve audit lineage, fail closed on every unsafe state, and keep Admin mutation capabilities unavailable while the survivor is UNVERIFIED.

**Architecture:** The formal Cloudflare Worker remains the only production backend. The existing LINE binding route delegates the other-canonical-owner collision to a Worker domain helper. The helper performs a server-authoritative preflight for error classification, then repeats all ownership, identity, evidence, dependency, and roster guards inside one D1 batch. Every required one-row mutation is followed immediately by a SQL statement that turns a failed row-count/postcondition into a NOT NULL constraint failure. The batch is therefore committed only after the complete transfer and audit succeed.

**Tech Stack:** Cloudflare Worker, D1 SQLite, prepared statements, D1Database.batch, existing formal migrations, Node test runner, React/Vite frontend unchanged.

**Spec:** Approved design at `docs/superpowers/specs/2026-09-12-provisional-employee-claim-design.md`, including the corrected D1 atomicity strategy and the requirement that employee_guest_sessions.token_hash remain NOT NULL.

## Global Constraints

- [ ] Do not change the frontend request contract. The frontend must not send claim, lineUserId, verificationStatus, or a provisional user id.
- [ ] Keep the existing authenticated LINE employee-binding endpoint and server-side LINE profile resolution.
- [ ] Keep the CORS fix isolated in the existing HEAD commit titled `fix(worker): allow bounded run.pinggy.link CORS in remote-test mode`. Do not amend it, duplicate it, or mix identity changes into that commit.
- [ ] Do not add a migration, permanent assertion table, provisioning_source column, or merged_into_user_id column. The final 0003 schema already supplies employee_guest_sessions.token_hash TEXT NOT NULL and that existing constraint is the SQL assertion primitive.
- [ ] Do not hard-delete the provisional user. On success set active=0 and employee_id=NULL while retaining the row.
- [ ] Do not perform one-off remote deletion or manual cleanup. Remote convergence must use the same claim path that local tests exercise.
- [ ] Do not merge main or deploy the frontend. A Worker-only remote smoke is allowed only after local implementation verification passes and must stop if the claim smoke does not pass.
- [ ] Preserve existing normal LINE binding, guest binding, View As separation, access-token validation, Worker authorization, and D1 contracts.
- [ ] Treat only true canonical business ownership as a dependency blocker. Audit/history references are retained and do not block a claim; employee_guest sessions are evidence/revocation data and are not re-parented.
- [ ] Treat every unexpected claim failure as fail closed: never return success after a failed batch and never infer a successful transfer from a stale diagnosis.
- [ ] Report automated verification and manual/external verification separately as PASS, FAIL, NOT RUN, or NOT VERIFIED.

## Implementation map

Create:

- `worker-poc/src/domain/employeeClaim.js` — claimability classification, SQL-level atomic transfer, rollback classification, and authoritative readback.

Modify:

- `worker-poc/src/domain/employeeVerification.js` — export the shared employee-id digest helper while preserving current roster verification semantics.
- `worker-poc/src/domain/adminIdentity.js` — consume the shared digest helper and remove the duplicate private implementation.
- `worker-poc/src/domain/guestAccess.js` — delegate only the different-canonical-owner collision to the claim helper; leave normal binding and guest flows intact.
- `worker-poc/tests/provisional-schema.test.js` — assert token_hash is NOT NULL and reject a NULL token hash.
- `worker-poc/tests/permissions.test.js` — add the Admin-role plus UNVERIFIED capability regression.
- `worker-poc/package.json` — include the new claim test in both formal test scripts.

Create:

- `worker-poc/tests/employee-claim.test.js` — claim, verification, dependency, evidence, authorization, idempotence, and atomic rollback coverage.

Do not modify:

- frontend source or request payloads;
- GAS code or GAS tests;
- formal migrations;
- remote data;
- the existing CORS commit.

---

## Task 0: execution preflight and protection

- [ ] Before any implementation mutation, run the repository-declared ap-safe-preflight workflow.
- [ ] Confirm Git root, agent.yaml schema, declared skill paths, required commands, branch, and baseline status.
- [ ] Record and protect the approved untracked spec and the existing CORS commit. Any unrelated staged, unstaged, or untracked change discovered at execution time remains untouched.
- [ ] Confirm the final formal migration still defines employee_guest_sessions.token_hash as NOT NULL before changing application code.
- [ ] Do not proceed with code changes if the manifest or declared skills become invalid.

## Task 1: write regression tests first

Update the formal test suite before implementing the helper. Add `worker-poc/tests/employee-claim.test.js` to both the package test and formal-test command lists.

### Schema contract

- [ ] Extend `worker-poc/tests/provisional-schema.test.js` to assert columns(employee_guest_sessions).get('token_hash').notnull === 1.
- [ ] Add an insertion attempt with token_hash=NULL and assert that the formal D1 harness rejects it with a NOT NULL error.
- [ ] Keep the existing nullable user_id and employee_id assertions and the existing provisional-session coverage.
- [ ] Use this test as the regression contract for the SQL assertion; do not replace it with a new table or migration.

### Reusable claim fixture

- [ ] Build a formal D1 fixture containing:
  - an active LINE survivor with a server-resolved line_user_id, employee_id=NULL, role=Admin, and an initial verification_status=VERIFIED;
  - an active canonical provisional owner with employee_id=139653, line_user_id=NULL, verification_status=UNVERIFIED, and role=User;
  - one unexpired, unrevoked employee_guest session proving the owner-to-employee relationship;
  - four additional matching sessions bound to the owner and two additional matching sessions with user_id=NULL, all unexpired and unrevoked;
  - one unrelated guest session;
  - no employee_roster row for 139653;
  - an audit reference to the provisional owner that must not count as a dependency.
- [ ] Configure the server profile fixture for the survivor's LINE user id. The test request must contain only the existing employee binding body.
- [ ] Use a fixed clock so expiry and audit timestamps are deterministic.

### Successful claim and authoritative state

- [ ] Exercise the actual authenticated LINE binding route, not a frontend-specific claim branch.
- [ ] Assert the claim succeeds and the survivor retains active=1 and role=Admin.
- [ ] Assert the survivor owns employee_id=139653 and has verification_status=UNVERIFIED.
- [ ] Assert the provisional row still exists with active=0 and employee_id=NULL.
- [ ] Assert all six matching still-valid employee_guest sessions are revoked, including sessions whose user_id is NULL. Assert the unrelated session is unchanged.
- [ ] Assert the explicit audit action PROVISIONAL_EMPLOYEE_CLAIMED exists once, with actor_user_id equal to the survivor and target_user_id equal to the retired provisional owner.
- [ ] Assert audit metadata contains only the employee-id digest, verification decision/status, reason, and outcome fields needed for lineage. Assert the digest is a lowercase 64-character SHA-256 value and raw guest tokens are absent.
- [ ] Perform an authoritative /api/me readback and assert authSource=LINE, identityState=PENDING_VERIFICATION, verificationStatus=UNVERIFIED, employeeId=139653, and onboarding-only capabilities.
- [ ] Assert the role remains Admin in the canonical row while the capability projection does not include any Admin mutation action.

### Roster decision matrix

Create isolated fixtures for the same claim shape and assert the following:

- [ ] A missing roster match produces verification_status=UNVERIFIED, identityState=PENDING_VERIFICATION, decision PENDING_TRUST_REVIEW, and reason NO_TRUSTED_MATCH; it never produces VERIFIED.
- [ ] Exactly one active trusted roster match with provenance TRUSTED_IMPORT produces verification_status=VERIFIED, identityState=VERIFIED, decision AUTO_VERIFIED, and reason TRUSTED_UNIQUE_ACTIVE.
- [ ] Exactly one active trusted roster match with provenance ADMIN_APPROVED produces the same VERIFIED result.
- [ ] An inactive, untrusted, or ambiguous roster result produces UNVERIFIED/PENDING_VERIFICATION and never VERIFIED.
- [ ] A survivor that was previously VERIFIED is assigned the roster decision from this claim; the prior VERIFIED state is not retained when the roster is missing or untrusted.
- [ ] Assert the audit records the same decision that the assignment produced.

### Claim rejection and normal-flow regression

- [ ] A different owner bound to LINE returns 409 EMPLOYEE_ID_ALREADY_BOUND and neither row changes.
- [ ] A different owner with verification_status=VERIFIED returns 409 EMPLOYEE_ID_ALREADY_BOUND.
- [ ] A different owner with role=Admin or ProxyAdmin returns 409 EMPLOYEE_ID_ALREADY_BOUND.
- [ ] Missing or invalid employee_guest provisional evidence returns 409 EMPLOYEE_ID_ALREADY_BOUND.
- [ ] A true business dependency in orders.user_id, balance_ledger.user_id, opening_balance_snapshots.user_id, likes.user_id, or idempotency_keys.actor_user_id returns 409 PROVISIONAL_IDENTITY_HAS_DEPENDENCIES and leaves every row/session/audit unchanged.
- [ ] An audit/history reference alone does not block the claim.
- [ ] A deliberately ambiguous duplicate normalized canonical owner fails closed with 409 EMPLOYEE_ID_ALREADY_BOUND and no partial mutation. The test may remove the local normalized unique index only to construct this invalid legacy state, and must restore the test database by isolation rather than changing a formal migration.
- [ ] Replaying the claim after success for the same LINE survivor returns idempotent success/readback, does not retire another row, and does not append a second merge event.
- [ ] A guest token attempting the LINE binding endpoint is rejected by the existing authenticated LINE boundary and causes no mutation.
- [ ] Keep and run the existing normal LINE binding regression: an employee id with no existing owner follows the current binding path, including its current verification response.
- [ ] Keep and run the existing guest binding tests, including the current 139653-equivalent provisional behavior and collision rejection coverage.

### SQL-level rollback and race tests

- [ ] Add a race-before-batch test that performs a read-only diagnosis, changes the survivor state before the helper builds its batch, then invokes the helper. Assert no release, retire, assignment, revocation, or audit survives and the authoritative post-rollback result is fail closed.
- [ ] Add a deterministic in-transaction race harness in the formal test only. After the owner release and retirement statements have run, change the survivor state before the assignment statement so the assignment matches zero rows. The following SQL assertion must fail on employee_guest_sessions.token_hash NOT NULL. Assert D1 rollback restores the provisional owner employee_id=139653 and active=1, restores the survivor employee_id=NULL and active=1, leaves every guest session unrevoked, and writes no audit.
- [ ] Use a temporary test trigger or equivalent test-only batch hook; do not add production hooks, permanent triggers, or schema objects.
- [ ] Assert a native normalized-employee unique constraint failure also returns a failed transaction and never leaves the owner released.
- [ ] These tests must not inspect a successful batch's meta.changes to decide whether to rollback. They must observe thrown SQL failure and final database state.

## Task 2: share employee-id digest logic

- [ ] In `worker-poc/src/domain/employeeVerification.js` export exactly one shared digest helper with the existing Web Crypto SHA-256 behavior:

~~~js
export const digestEmployeeId = async (employeeId) => {
  const bytes = new TextEncoder().encode(employeeId);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => (
    value.toString(16).padStart(2, '0')
  )).join('');
};
~~~

- [ ] Preserve employeeIdText normalization/validation, sameEmployeeId, trusted provenance, and resolveEmployeeVerification outputs.
- [ ] In `worker-poc/src/domain/adminIdentity.js` import digestEmployeeId from employeeVerification.js and remove the private duplicate. Preserve all current admin audit metadata and tests.
- [ ] Add or retain a focused digest assertion showing the claim audit digest and the existing admin identity digest use the same canonical normalized employee id.

## Task 3: implement the claim domain helper

Create `worker-poc/src/domain/employeeClaim.js` with this public interface:

~~~js
export const claimProvisionalEmployee = async (
  database,
  { survivorUserId, lineUserId, employeeId, clock = new Date() } = {}
) => {};
~~~

The helper must return the same public binding/readback shape used by the existing LINE binding flow, or throw the existing HTTP error types/codes used by the route. It must not accept a client-supplied claim flag, verification status, or provisional user id.

### Authoritative preflight and classification

- [ ] Normalize employeeId with employeeIdText.
- [ ] Resolve the survivor with getUserById and require that its canonical row has the supplied survivorUserId, exact authenticated lineUserId, active=1, and employee_id=NULL for the claim path.
- [ ] Read every canonical user whose normalized employee_id equals the requested employee id; do not use a LIMIT 1 query for claimability.
- [ ] Require exactly one owner for a claim candidate and reject ambiguity or competing canonical ownership.
- [ ] Read owner state, employee_guest evidence, the five current business dependency sets, and the current roster decision for error classification only. This read is never trusted as the mutation authorization.
- [ ] Preserve idempotence: if the authoritative survivor already owns the normalized employee id, return the current survivor readback without a transfer. If another LINE-bound owner or any unsafe owner state is present, return the established 409 collision error.
- [ ] Return PROVISIONAL_IDENTITY_HAS_DEPENDENCIES only when the post-rollback authoritative state contains true business ownership dependencies. Do not return it for audit/history references or guest-session evidence.

### Exact dependency guard

Implement an explicit current-schema ownership map. A provisional owner is blocked when any row exists for its user id in:

- orders.user_id;
- balance_ledger.user_id;
- opening_balance_snapshots.user_id;
- likes.user_id;
- idempotency_keys.actor_user_id.

- [ ] Treat order history rows that are reached through an owned order as covered by the order ownership blocker; do not re-parent or delete order history.
- [ ] Treat admin_audit_log actor/target references as retained lineage, not blockers.
- [ ] Do not re-parent guest sessions. Revoke matching still-valid sessions in the transfer.
- [ ] Before implementation verification, inspect all current formal schema tables for direct canonical ownership references and encode any additional unsafe current owner relation explicitly. Do not use an audit/history catch-all that would block safe claims.

### SQL/D1 atomic primitive

Use only prepared statements passed to D1Database.batch. D1 batch executes the prepared statements sequentially as one transaction and rolls the whole sequence back when any statement fails. A standalone prepare().run() is not a transaction. The implementation must not rely on JavaScript checking result metadata after a successful batch.

- [ ] Add a private assertion statement that uses only the existing employee_guest_sessions table:

~~~sql
INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
SELECT ?, NULL, ?
WHERE changes() <> 1;
~~~

- [ ] Bind a fresh random session id and the batch clock expiry to each assertion. When the immediately preceding guarded DML changes zero or more than one row, the INSERT attempts NULL for token_hash and fails the existing NOT NULL constraint. When the DML changes exactly one row, the SELECT yields zero rows and the assertion succeeds.
- [ ] Add the assertion immediately after the survivor guard update, owner release, owner retirement, survivor assignment, and audit insert. Do not put any JavaScript between a guarded DML and its assertion.
- [ ] For the set-based session revocation update, use a SQL postcondition assertion rather than an exact row count. The assertion must attempt the same NULL-token insert when any still-valid matching guest session remains. A zero revocation count is valid only when no matching still-valid session exists.
- [ ] Do not read meta.changes from a successful batch to perform rollback. Only a thrown SQL/constraint error can abort the D1 batch; readback occurs after the batch has already rolled back or committed.
- [ ] Use runMutationBatch from `worker-poc/src/db/transactions.js` so all D1 failures are wrapped as TransactionError after D1 rollback.

### Ordered atomic statements

Prepare one batch in the following order. All values are bound parameters; no user input is interpolated into SQL.

1. Resolve and guard the authenticated LINE survivor with a one-row UPDATE that writes the supplied clock to updated_at only when user_id, line_user_id, active=1, and employee_id IS NULL all match. Follow it immediately with the NULL-token assertion. This makes survivor resolution itself part of the SQL-failing operation.
2. Release the provisional owner by setting employee_id=NULL only when all of these are true:
   - the owner id is the exact preflight owner id;
   - active=1;
   - line_user_id IS NULL;
   - verification_status=UNVERIFIED;
   - role is neither Admin nor ProxyAdmin;
   - normalized employee_id equals the requested normalized employee id;
   - a subquery confirms exactly one normalized canonical owner;
   - an employee_guest session exists for that owner with auth_mode=employee_guest, status=UNVERIFIED_EMPLOYEE, matching normalized employee_id, unrevoked state, and unexpired time;
   - none of the explicit business dependency queries finds a row;
   - no competing canonical owner exists.
   Follow it immediately with the NULL-token assertion.
3. Retire the same owner by setting active=0 and employee_id=NULL, guarded by the exact owner id, active=1, line_user_id IS NULL, verification_status=UNVERIFIED, role restrictions, and employee_id IS NULL after release. Follow it immediately with the NULL-token assertion.
4. Assign the requested employee id to the survivor, preserving the survivor role and line binding, and set verification_status from a roster CTE evaluated inside this batch:
   - exactly one matching roster row and exactly one active row whose provenance is TRUSTED_IMPORT or ADMIN_APPROVED gives VERIFIED;
   - all other missing, inactive, untrusted, or multiple-row states give UNVERIFIED.
   Require survivor active=1, exact line_user_id, employee_id IS NULL, retired-owner active=0/employee_id=NULL, and no other canonical owner with the normalized employee id. Follow it immediately with the NULL-token assertion.
5. Revoke every still-valid employee_guest session where revoked_at IS NULL, expires_at is after the batch clock, auth_mode=employee_guest, and either normalized employee_id matches or user_id equals the retired provisional owner. This includes user_id IS NULL matching sessions. Set revoked_reason=line_bound and revoked_at to the batch clock.
6. Run the set-based revocation postcondition assertion. It must fail with the same existing token_hash NOT NULL constraint if any matching still-valid session remains.
7. Insert exactly one admin_audit_log row with action PROVISIONAL_EMPLOYEE_CLAIMED, actor_user_id equal to the LINE survivor, actor_auth_mode=line, target_user_id equal to the retired provisional owner, no raw token, and metadata containing:
   - employeeIdDigest;
   - verificationDecision;
   - verificationStatus;
   - identityState;
   - reason;
   - outcome=CLAIMED;
   - retiredProvisionalUserId.
   Derive verificationDecision, verificationStatus, identityState, and reason in the INSERT from the same employee_roster CTE rule used by assignment, rather than binding a stale preflight decision. Keep employee-id snapshot fields NULL for this new event so the digest is the only employee identifier stored for this lineage event.
8. Follow the audit INSERT immediately with the NULL-token assertion.

### Verification and failure handling

- [ ] Use one SQL definition of roster trust semantics for assignment and audit. The result must be AUTO_VERIFIED/TRUSTED_UNIQUE_ACTIVE for one active trusted unique row and PENDING_TRUST_REVIEW with NO_TRUSTED_MATCH, INACTIVE_OR_UNTRUSTED_MATCH, or AMBIGUOUS_MATCH otherwise.
- [ ] If any batch statement fails, let runMutationBatch surface TransactionError only after D1 rollback. Then re-read the canonical state and classify:
  - survivor now owns the requested employee id: idempotent success/readback;
  - a different LINE-bound or otherwise unsafe owner exists: EMPLOYEE_ID_ALREADY_BOUND;
  - the owner has true business dependencies: PROVISIONAL_IDENTITY_HAS_DEPENDENCIES;
  - the state is not a safe success or known rejection: retain the transaction failure and never claim success.
- [ ] In every failure classification, verify that no partial owner release, retirement, survivor assignment, session revocation, or audit row remains.
- [ ] After a successful batch, perform an authoritative survivor readback by user id and require active=1, exact LINE binding, requested normalized employee id, preserved role, and the roster-derived verification status. Return that readback, not a preflight object.
- [ ] Let publicUser and the existing /api/me projection derive identityState and capability output from the authoritative survivor row.

## Task 4: integrate only the existing collision branch

- [ ] In `worker-poc/src/domain/guestAccess.js` import claimProvisionalEmployee.
- [ ] Preserve the current flow for an inactive survivor, same-employee idempotence, survivor already bound to another employee, and an unowned employee id.
- [ ] Replace only the branch where getUserByEmployeeId finds a different canonical owner with a call to claimProvisionalEmployee using the server-resolved survivor user id, server-resolved LINE user id, normalized employee id, and request clock.
- [ ] Do not add a claim query parameter or any client-controlled identity/verification fields.
- [ ] Keep the existing response semantics for normal LINE binding and propagate the claim helper's established 409 errors.
- [ ] Leave bindLineIdentity, employee guest login, provisional session creation, and session inspection unchanged except for the required post-claim revocation behavior.

## Task 5: enforce the capability regression

- [ ] Confirm the central early UNVERIFIED gate in `worker-poc/src/auth/permissions.js` remains before role-specific Admin and ProxyAdmin actions. Do not allow role=Admin to bypass that gate.
- [ ] Extend `worker-poc/tests/permissions.test.js` to assert every Admin mutation action is absent for a principal with role=Admin, active=1, employee binding present, verification_status=UNVERIFIED.
- [ ] Exercise the actual Admin role mutation endpoint from `worker-poc/src/routes/roles.js` with the claimed LINE survivor. Assert 403, leave the role column as Admin, and assert no ROLE_UPDATED audit event is written.
- [ ] Assert read-only/onboarding capability behavior remains available where the existing policy permits it.

## Task 6: local implementation verification

Run in the repository root and report each result separately:

- [ ] Automated: `npm --prefix worker-poc run test:formal` — PASS only when all formal tests, including employee-claim.test.js, pass.
- [ ] Automated: `node --test tests/strict-identity-ledger.test.cjs` — PASS/FAIL with output.
- [ ] Automated: `npm run lint` — PASS/FAIL with output.
- [ ] Automated: `npm run build` — PASS/FAIL with output.
- [ ] Automated: execute the repository-declared ap-verification-core workflow and preserve its baseline attribution and defect-first review.
- [ ] Review the diff and search for raw token logging, client claim fields, direct remote cleanup, migration changes, and unintended frontend/GAS edits.
- [ ] Confirm the only pre-existing CORS change remains in its own HEAD commit and the identity implementation is not amended into it.
- [ ] Do not commit implementation changes unless the user separately requests a commit. The current request authorizes implementation planning and implementation, not an additional commit instruction.

## Task 7: remote smoke readiness and execution boundary

After all local automated checks pass:

- [ ] Verify Worker-only deployment readiness and use the existing Worker deployment procedure only when the user explicitly authorizes deployment at that point.
- [ ] Do not deploy frontend and do not merge main.
- [ ] Use the real authenticated LINE flow against the Worker with the existing employee binding request to claim 139653. Do not send claim=true, lineUserId, verificationStatus, or a provisional user id.
- [ ] Do not delete the remote provisional row and do not perform manual cleanup.
- [ ] Read back the survivor through /api/me and inspect the authoritative D1 state:
  - LINE survivor employee_id=139653, active=1, original role retained;
  - survivor verification_status=UNVERIFIED, identityState=PENDING_VERIFICATION, authSource=LINE, employeeId=139653 because employee_roster has no match;
  - provisional owner row retained, active=0, employee_id=NULL;
  - all six matching still-valid employee_guest sessions revoked, including user_id=NULL sessions;
  - one PROVISIONAL_EMPLOYEE_CLAIMED audit event with digest and decision metadata.
- [ ] If the remote smoke does not match exactly, stop without frontend deployment, main merge, remote delete, or manual cleanup.
- [ ] Report remote evidence as manual/external verification, separate from automated local verification.

## Plan review checkpoint

Before starting Task 0 or any implementation mutation, obtain explicit user acceptance of this saved plan. The approved spec is accepted, but this plan is a separate review artifact. After plan acceptance, execute the tasks in order and pause before any remote smoke/deployment boundary if local verification is not PASS.

## Self-review checklist

- [ ] The transfer has one D1 batch and no post-batch JavaScript rollback assumption.
- [ ] A failed survivor guard, release, retirement, assignment, audit insert, or revocation postcondition produces SQL failure through the existing token_hash NOT NULL constraint.
- [ ] A release followed by a later assignment failure restores the provisional owner's original employee_id and active state.
- [ ] Normalized uniqueness and all ambiguity/competition checks fail closed.
- [ ] Only true business ownership blocks; audit/history references remain preserved.
- [ ] Verification is recomputed from employee_roster and can downgrade a previously VERIFIED survivor to UNVERIFIED/PENDING_VERIFICATION.
- [ ] Admin role preservation and Admin capability denial are both tested.
- [ ] No client-controlled claim fields, raw tokens, hard delete, new schema, frontend change, main merge, or frontend deployment was introduced.
