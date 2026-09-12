# Provisional Employee Claim / Merge Design

**Release target:** 0.13.0
**Scope:** Formal Cloudflare Worker + D1 identity path only

## Goal

An authenticated LINE canonical identity with no employee ID may claim a
bounded provisional Employee Guest canonical row through the existing
`POST /api/auth/line-employee-bind` endpoint. The Worker is authoritative;
the transfer is atomic, fail-closed, and does not create a second frontend
identity source of truth.

The CORS correction is already isolated in commit
`e2bfa6208c49c48613fc0eeea8de960d5f859271`:
`fix(worker): allow bounded run.pinggy.link CORS in remote-test mode`.

## Contract boundaries

- The request contract remains the existing authenticated LINE binding
  contract. Frontend does not send `claim`, `lineUserId`,
  `verificationStatus`, or a provisional user ID.
- Do not add a claim endpoint, admin merge workflow, GAS behavior, remote
  delete, or manual cleanup substitute.
- Do not add `provisioning_source` or `merged_into_user_id` in this release.
  Existing `admin_audit_log` is sufficient for merge lineage.
- Do not re-parent financial, order, historical, audit, or other business
  data. Audit/history references may continue to point to the retired row.

## Authoritative decision

The route authenticates the LINE bearer token with LINE, obtains the server
profile, and passes only the server-derived LINE user ID to `lineEmployeeBind`.
Existing normal binding and same-survivor idempotence remain unchanged. Claim
is considered only when the authenticated LINE user is an existing active
canonical survivor with `employee_id IS NULL`, and the first read finds a
different normalized canonical owner for the submitted employee ID.

The first read is diagnosis only. The claim mutation independently resolves
the authenticated survivor and re-checks every predicate inside its D1 batch.

## Exact claimability predicate

All of these must be true at mutation time:

- The survivor is the authenticated canonical row with the same `user_id` and
  `line_user_id`, `active = 1`, and `employee_id IS NULL`.
- Exactly one canonical `users` row owns the normalized employee ID, using
  `COUNT(UPPER(trim(employee_id))) = 1` across all rows.
- That owner is a different row with `active = 1`, `line_user_id IS NULL`,
  `verification_status = 'UNVERIFIED'`, and `role NOT IN ('Admin',
  'ProxyAdmin')`.
- At least one `employee_guest_sessions` row is server-verifiable evidence of
  provisional Employee Guest origin for that exact owner and normalized
  employee ID: `auth_mode = 'employee_guest'`,
  `status = 'UNVERIFIED_EMPLOYEE'`, `user_id = owner.user_id`, and normalized
  session `employee_id` matches.
- The owner has no data that would require unsafe business ownership
  re-parenting.

For this release, the dependency blocker set is exactly:

- `orders.user_id`;
- `balance_ledger.user_id`;
- `opening_balance_snapshots.user_id`;
- `likes.user_id`;
- `idempotency_keys.actor_user_id`.

These are not blockers because they are actor/history lineage rather than
canonical business ownership: order creator/canceller fields,
`order_status_history.actor_user_id`, `balance_ledger.operator_user_id`,
calendar updater fields, import reviewer fields, and all
`admin_audit_log` references. `employee_guest_sessions` are authentication
evidence; they are revoked, never re-parented.

If any dependency blocker exists, return `409
PROVISIONAL_IDENTITY_HAS_DEPENDENCIES`. Any other failed predicate, including
duplicate/ambiguous canonical ownership, LINE-bound owner, verified owner,
privileged owner, missing evidence, or stale ownership, remains `409
EMPLOYEE_ID_ALREADY_BOUND`. Knowing an employee ID never authorizes takeover
of a formal user.

## Atomic transfer

### Supported D1 primitive

The production mutation uses prepared statements passed to
`D1Database.batch()`. D1 executes a batch sequentially and non-concurrently as
one SQL transaction; a statement failure aborts and rolls back the complete
sequence. Separate `prepare().run()` calls are not one transaction, and
JavaScript after `batch()` is never a rollback hook. See the official
[D1 `batch()` contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

SQLite conditional `UPDATE` returning zero rows is not itself a SQL failure.
Therefore the implementation must not wait for `meta.changes` after
`batch()` and pretend that it rolled back.

### SQL-level row-count assertion

Every guarded one-row DML statement is immediately followed by this assertion
statement in the same batch:

```sql
INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
SELECT ?, NULL, ?
WHERE changes() <> 1;
```

SQLite `changes()` reports the rows changed by the most recently completed
`INSERT`, `DELETE`, or `UPDATE`; see the official
[SQLite `changes()` definition](https://www.sqlite.org/lang_corefunc.html#changes).
When the preceding guarded DML changes exactly one row, the `SELECT` emits no
row and the assertion succeeds. When it changes zero or more than one rows,
the assertion attempts to insert `NULL` into the existing
`employee_guest_sessions.token_hash NOT NULL` column. That is a real SQL
failure inside the open batch, so D1 rolls back all earlier statements. The
assertion-only session ID is generated and bound by the Worker; its failed
row is never committed. This uses an existing table constraint and requires
no permanent table, schema column, or migration.

The assertion must be adjacent to the guarded DML so another statement cannot
change the value seen by `changes()`. Returned metadata may be inspected only
after a successful batch for diagnostics; it cannot decide whether the
mutation committed.

### Concrete ordered batch

The Worker prepares one batch in this order. All `?` values are bound
parameters; user input is never interpolated into SQL.

1. `releaseOwner`: execute the guarded `UPDATE` below. It re-checks the
   survivor, normalized unique owner, provisional state, evidence, and every
   business dependency in the same SQL statement.
2. `assertRelease`: execute the assertion immediately after `releaseOwner`.
3. `retireOwner`: execute the guarded retirement `UPDATE` below, retaining the
   canonical row but setting `active = 0` and `employee_id = NULL`.
4. `assertRetire`: execute the assertion immediately after `retireOwner`.
5. `assignSurvivor`: execute the guarded assignment `UPDATE` below. Its
   verification `CASE` is computed from `employee_roster` inside the mutation.
6. `assertAssign`: execute the assertion immediately after `assignSurvivor`.
7. `revokeSessions`: revoke all still-valid, unrevoked matching
   `employee_guest` sessions, including rows where `user_id IS NULL`. Zero
   matching sessions is valid and is not a one-row assertion.
8. `writeAudit`: insert one `PROVISIONAL_EMPLOYEE_CLAIMED` row with actor and
   retired-owner IDs, employee-ID digest, roster decision, and outcome. No
   raw token is written.
9. `assertAudit`: execute the assertion immediately after `writeAudit`.

The ownership portion is:

```sql
-- 1. Release only if the current database still proves every predicate.
UPDATE users AS owner
SET employee_id = NULL, updated_at = ?
WHERE owner.user_id = ?
  AND owner.employee_id IS NOT NULL
  AND length(trim(owner.employee_id)) > 0
  AND UPPER(trim(owner.employee_id)) = ?
  AND owner.active = 1
  AND owner.line_user_id IS NULL
  AND owner.verification_status = 'UNVERIFIED'
  AND owner.role NOT IN ('Admin', 'ProxyAdmin')
  AND (
    SELECT COUNT(*)
    FROM users AS candidate
    WHERE candidate.employee_id IS NOT NULL
      AND length(trim(candidate.employee_id)) > 0
      AND UPPER(trim(candidate.employee_id)) = ?
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM employee_guest_sessions AS evidence
    WHERE evidence.user_id = owner.user_id
      AND evidence.auth_mode = 'employee_guest'
      AND evidence.status = 'UNVERIFIED_EMPLOYEE'
      AND evidence.employee_id IS NOT NULL
      AND UPPER(trim(evidence.employee_id)) = ?
  )
  AND EXISTS (
    SELECT 1
    FROM users AS survivor
    WHERE survivor.user_id = ?
      AND survivor.line_user_id = ?
      AND survivor.active = 1
      AND survivor.employee_id IS NULL
  )
  AND NOT EXISTS (SELECT 1 FROM orders
                  WHERE orders.user_id = owner.user_id)
  AND NOT EXISTS (SELECT 1 FROM balance_ledger
                  WHERE balance_ledger.user_id = owner.user_id)
  AND NOT EXISTS (SELECT 1 FROM opening_balance_snapshots
                  WHERE opening_balance_snapshots.user_id = owner.user_id)
  AND NOT EXISTS (SELECT 1 FROM likes
                  WHERE likes.user_id = owner.user_id)
  AND NOT EXISTS (SELECT 1 FROM idempotency_keys
                  WHERE idempotency_keys.actor_user_id = owner.user_id);

-- 2. A zero-row release becomes a SQL failure before commit.
INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
SELECT ?, NULL, ?
WHERE changes() <> 1;

-- 3. Retire the same owner without hard deleting its canonical row.
UPDATE users
SET active = 0, employee_id = NULL, updated_at = ?
WHERE user_id = ?
  AND active = 1
  AND employee_id IS NULL
  AND line_user_id IS NULL
  AND verification_status = 'UNVERIFIED';

-- 4. A zero-row retirement becomes a SQL failure before commit.
INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
SELECT ?, NULL, ?
WHERE changes() <> 1;

-- 5. Assign only the unchanged authenticated LINE survivor.
UPDATE users AS survivor
SET employee_id = ?,
    verification_status = CASE
      WHEN (
        SELECT COUNT(*)
        FROM employee_roster
        WHERE UPPER(trim(employee_id)) = ?
      ) = 1
      AND EXISTS (
        SELECT 1
        FROM employee_roster
        WHERE UPPER(trim(employee_id)) = ?
          AND active = 1
          AND provenance IN ('TRUSTED_IMPORT', 'ADMIN_APPROVED')
      ) THEN 'VERIFIED'
      ELSE 'UNVERIFIED'
    END,
    updated_at = ?
WHERE survivor.user_id = ?
  AND survivor.line_user_id = ?
  AND survivor.active = 1
  AND survivor.employee_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM users AS competing
    WHERE competing.employee_id IS NOT NULL
      AND length(trim(competing.employee_id)) > 0
      AND UPPER(trim(competing.employee_id)) = ?
  )
  AND EXISTS (
    SELECT 1
    FROM users AS retired
    WHERE retired.user_id = ?
      AND retired.active = 0
      AND retired.employee_id IS NULL
      AND retired.line_user_id IS NULL
      AND retired.verification_status = 'UNVERIFIED'
  );

-- 6. A zero-row assignment becomes a SQL failure before commit.
INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
SELECT ?, NULL, ?
WHERE changes() <> 1;
```

The tail remains in the same batch:

```sql
-- 7. Revoke all still-valid matching guest sessions, including unbound ones.
UPDATE employee_guest_sessions
SET revoked_at = ?, revoked_reason = 'line_bound'
WHERE revoked_at IS NULL
  AND expires_at > ?
  AND auth_mode = 'employee_guest'
  AND (
    (
      employee_id IS NOT NULL
      AND length(trim(employee_id)) > 0
      AND UPPER(trim(employee_id)) = ?
    )
    OR user_id = ?
  );

-- 8. Persist merge lineage and the roster-derived decision.
WITH roster AS (
  SELECT
    COUNT(*) AS total_matches,
    COALESCE(SUM(
      CASE WHEN active = 1
             AND provenance IN ('TRUSTED_IMPORT', 'ADMIN_APPROVED')
           THEN 1 ELSE 0 END
    ), 0) AS trusted_active_matches
  FROM employee_roster
  WHERE UPPER(trim(employee_id)) = ?
), decision AS (
  SELECT
    CASE WHEN total_matches = 1 AND trusted_active_matches = 1
         THEN 'VERIFIED' ELSE 'UNVERIFIED' END AS verification_status,
    CASE
      WHEN total_matches = 1 AND trusted_active_matches = 1
        THEN 'TRUSTED_UNIQUE_ACTIVE'
      WHEN total_matches = 0 THEN 'NO_TRUSTED_MATCH'
      WHEN total_matches > 1 THEN 'AMBIGUOUS_MATCH'
      ELSE 'INACTIVE_OR_UNTRUSTED_MATCH'
    END AS verification_reason
  FROM roster
)
INSERT INTO admin_audit_log (
  audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
  actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
  target_line_user_id_snapshot, action, metadata_json, occurred_at
)
SELECT ?, ?, 'line', ?, ?, ?, ?, NULL, 'PROVISIONAL_EMPLOYEE_CLAIMED',
       json_object(
         'employee_id_digest', ?,
         'verification_status', decision.verification_status,
         'verification_reason', decision.verification_reason,
         'outcome', 'CLAIMED'
       ), ?
FROM decision;

-- 9. A missing audit row becomes a SQL failure before commit.
INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
SELECT ?, NULL, ?
WHERE changes() <> 1;
```

The Worker binds server-generated assertion session IDs, timestamps, the
normalized employee ID, authenticated survivor/owner IDs, and the SHA-256
employee-ID digest. It never binds or stores a guest token in this audit
path.

### Concurrency and rollback proof

The first read cannot authorize the transfer. If any concurrent writer changes
the survivor, owner, evidence, dependency set, or normalized ownership before
the batch's first statement, `releaseOwner` changes zero rows and
`assertRelease` fails inside the batch. The batch rolls back and the
provisional owner retains its original employee ID and `active = 1`.

Once the D1 batch starts, D1 executes its statements sequentially and
non-concurrently. Another writer cannot bind the survivor between
`releaseOwner` and `assignSurvivor`. Thus a committed sequence of “release,
then concurrent survivor bind, then failed assignment” cannot occur.

For defense in depth, if a release did change one row but assignment changed
zero rows for any unexpected reason, `assertAssign` fails before commit. D1
rolls back both release and retirement, restoring the provisional owner's
original employee ID and `active = 1`; the survivor is unchanged. A native
normalized-unique-index failure has the same whole-batch rollback behavior.
No JavaScript row-count assertion is used as a post-commit rollback hook.

After a successful batch, perform an authoritative survivor readback by
`user_id`. The response is based on that readback and verifies the same LINE
ID, requested employee ID, `active = 1`, preserved role, and stored roster
verification status.

## Verification semantics and authorization

`employee_roster` is the only verification trust source:

- exactly one active trusted (`TRUSTED_IMPORT` or `ADMIN_APPROVED`) match:
  `verification_status = VERIFIED`;
- missing, inactive, untrusted, or ambiguous match:
  `verification_status = UNVERIFIED`, public `identityState =
  PENDING_VERIFICATION`.

The survivor's prior `VERIFIED` state is not retained merely because it was
previously verified, and a correctly formatted employee ID is not proof.

The existing central `capabilitiesFor` / `assertCan` policy remains the
authority. A survivor may retain `role = Admin` in the canonical row, but an
`UNVERIFIED` survivor receives only onboarding capabilities. Admin mutation
APIs must reject that principal with `403`; add a regression test through an
actual Admin mutation route.

For the current 139653 shape, where `employee_roster` has no match, the
successful authoritative state is:

```text
authSource=LINE
identityState=PENDING_VERIFICATION
verificationStatus=UNVERIFIED
employeeId=139653
```

The provisional row remains present with `active = 0` and `employee_id =
NULL`, retaining its original role. All matching still-valid guest sessions
are revoked, including the six current related sessions.

## Tests

Add formal Worker regression coverage for:

- claimable provisional owner success and the current 139653-equivalent
  shape;
- survivor receives employee ID, remains active, keeps role, and gets the
  roster-derived verification status;
- provisional row is inactive with ownership cleared and is not deleted;
- all matching guest sessions are revoked, including `user_id IS NULL`;
- `PROVISIONAL_EMPLOYEE_CLAIMED` audit with lineage, digest, decision, and no
  raw token;
- missing roster produces `PENDING_VERIFICATION` / `UNVERIFIED`;
- unique active trusted roster produces `VERIFIED`;
- same-survivor idempotence;
- LINE-bound owner, verified owner, and privileged provisional owner return
  `EMPLOYEE_ID_ALREADY_BOUND`;
- missing evidence, dependent business ownership, ambiguous duplicate
  ownership, and ownership/state changes fail closed;
- a forced assignment failure after a successful release leaves the original
  provisional ownership intact, proving batch rollback;
- guest authentication cannot invoke LINE binding/claim;
- `role = Admin` plus `UNVERIFIED` cannot invoke an Admin mutation API;
- existing normal LINE binding remains unchanged.

Run the repository-declared root test, lint, and build commands plus the
formal Worker suite. Report automated checks separately from manual/external
evidence.

## Remote smoke checkpoint

After implementation and local verification, deploy only the formal Worker.
Do not merge main, deploy frontend, delete 139653, or perform manual remote
cleanup. Use the real authenticated LINE flow through the existing binding
endpoint to bind 139653, then verify read-only evidence:

- provisional row retained, inactive, and `employee_id = NULL`;
- LINE canonical survivor owns 139653, remains active, and preserves role;
- survivor is `LINE` / `PENDING_VERIFICATION` / `UNVERIFIED` because roster
  has no match;
- all six matching still-valid guest sessions are revoked;
- one explicit merge audit exists with no raw token;
- authoritative `/api/me` readback returns the expected projection.

Stop at this checkpoint until the claim smoke passes. No remote cleanup is a
substitute for the product contract.
