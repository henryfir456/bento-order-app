# Admin identity management 0.13.0 design

## Goal

Make the Admin member-management surface explain authentication source,
employee binding, verification, and authorization as separate server-owned
concepts. Add a Worker + D1 Admin employee-binding operation with bounded
automatic verification, while keeping GAS retired and unchanged.

This slice starts from the clean `0.12.1` checkpoint `60fe511` in the
isolated `admin-identity-0.13.0` worktree. It does not commit, push, deploy,
seed the remote D1 database, or alter Google Sheets.

## Current-state findings and data-model decision

The formal Worker already has:

- canonical `users.user_id` relational identity;
- nullable, partially unique `users.employee_id` and `users.line_user_id`;
- `users.active` for canonical-user activity;
- `users.verification_status` with storage values `VERIFIED` and `UNVERIFIED`;
- `admin_audit_log` with actor/target snapshots;
- a local-only employee-master dry-run planner.

The existing canonical rows cannot themselves be trusted as an employee
registry. Migration `0002` leaves legacy imported `employee_id` values null,
and the `users` table has no provenance field distinguishing imported employee
records from LINE-created or provisional users. Migration `0003` defaults
existing rows to `VERIFIED`, which is a compatibility state, not proof that a
submitted employee ID matches a trusted employee source. `users.active` only
describes the canonical account and cannot express employee-record activity.

Therefore 0.13.0 adds a minimal `employee_roster` source table. It is not a
second ungoverned employee master: every row must carry a trusted provenance
and source reference. It deliberately allows duplicate `employee_id` values
so an import or review process can represent ambiguity instead of silently
collapsing it. Runtime auto-verification requires exactly one row for the
submitted ID, active status, and an allowed trusted provenance.

The migration creates the table empty. A separate reviewed employee-master
preload/import operation is required to populate it and is outside this
request. Existing canonical users are never copied into the roster by this
feature.

## Authoritative identity model

The system keeps these concepts independent:

1. Authentication proves who is making the request. A LINE bearer token is
   resolved by LINE Profile; an opaque employee guest token is resolved from
   D1. `authMode` remains the request authentication mode.
2. Employee binding associates one canonical `user_id` with one textual
   `employee_id`. It does not prove that the person is approved, change a
   role, or change a balance.
3. Verification decides whether the employee identity is trusted for normal
   application access. It is stored in `users.verification_status` and
   projected as a public `identityState`.
4. Authorization derives capabilities from the authenticated principal,
   stored role, active state, authentication mode, employee binding, and
   verification state. Frontend visibility is never an authorization check.

The public identity states are:

| `identityState` | Storage / meaning | UI label |
| --- | --- | --- |
| `EMPLOYEE_BIND_REQUIRED` | Canonical user exists but has no employee ID | 待綁員編 |
| `PENDING_VERIFICATION` | `verification_status = UNVERIFIED`, or a new/provisional identity awaiting review | 待審核 |
| `VERIFIED` | Active canonical identity is verified | 已驗證 |

The existing onboarding-only `NEW_PROVISIONAL_EMPLOYEE` and `UNREGISTERED`
states remain valid for `/api/me` lifecycle responses. The existing
`EXISTING_UNVERIFIED_EMPLOYEE` compatibility name is accepted at migration
boundaries, but all new public member and identity projections use
`PENDING_VERIFICATION`. The frontend consumes the server-returned
`identityState`; it does not map `employee_id`, role, or a local boolean to a
higher state.

`verificationStatus` continues to expose the current storage values
`VERIFIED` and `UNVERIFIED`. `UNVERIFIED` is not treated as verified by any
client or route and is projected by the server as `PENDING_VERIFICATION`.

`authSource` is a member-list projection, not a client-auth claim:

- `LINE` when the canonical user has a non-empty `line_user_id`;
- `EMPLOYEE_GUEST` when the canonical user is not LINE-bound and is reachable
  through the employee guest model.

This lets the UI say `LINE` or `非 LINE` without exposing LINE IDs or claiming
that the current Admin request was made by the listed member.

## Trusted auto-verification policy

The only automatic verification decision is the server-side
`resolveEmployeeVerification(employeeId)` policy. A submitted employee ID is
auto-verified only if all conditions hold:

- the normalized textual ID matches exactly one `employee_roster` row;
- that row has `active = 1`;
- that row has an allowed trusted provenance (`TRUSTED_IMPORT` or
  `ADMIN_APPROVED`);
- no second roster row exists for the same normalized ID;
- no other canonical user owns the ID.

If the roster is empty, missing, inactive, untrusted, duplicated, or otherwise
ambiguous, the binding/onboarding mutation stores `UNVERIFIED` and returns
`PENDING_VERIFICATION`. A valid format or the user's knowledge of an ID is
never evidence by itself. A canonical ownership conflict is a hard `409`
failure and never becomes a pending reassignment.

This resolver is used only at identity-establishing mutation boundaries:
Admin employee binding and provisional onboarding/binding flows. A guest
login read alone does not promote an already pending canonical user.

Admin employee binding and Admin verification approval are separate concepts.
This slice adds only employee binding plus the bounded automatic decision; it
does not add a manual approval mutation. Any future approval endpoint must
have its own capability, audit action, and state transition and cannot be
hidden inside the binding action.

## D1 schema

Migration `0004_employee_roster_verification_source.sql` adds:

```sql
CREATE TABLE employee_roster (
  roster_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  provenance TEXT NOT NULL
    CHECK (provenance IN ('TRUSTED_IMPORT', 'ADMIN_APPROVED')),
  source_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_employee_roster_employee_id
  ON employee_roster(employee_id);
```

No unique index is placed on `employee_roster.employee_id`; ambiguity must be
detectable. The existing partial unique `users_employee_id_unique` remains
the exact-text ownership invariant, and
`users_employee_id_normalized_unique` enforces normalized ownership. The
accepted ID remains the import contract (`[A-Za-z0-9][A-Za-z0-9._-]*`), with
trimmed uppercase lookup keys. A pre-existing normalized collision must make
the migration fail closed. The migration is forward-only
and must be applied to the exact formal D1 before deployment, with backup,
schema/count/FK verification, and a separate reviewed roster preload. No
remote command is run in this slice.

## API contract

### Member list

`GET /api/admin/members/balances` remains the member-list route and returns
each public user with:

```json
{
  "userId": "user-123",
  "name": "Example",
  "employeeId": null,
  "authSource": "LINE",
  "identityState": "EMPLOYEE_BIND_REQUIRED",
  "verificationStatus": "VERIFIED",
  "floor": "1樓",
  "balance": 0,
  "role": "User",
  "active": true
}
```

The route remains Admin-capability protected and audited. `usersSummary` in
the Admin summary uses the same projection when included.

### Admin employee binding

```text
POST /api/admin/users/:userId/employee-binding
Authorization: Bearer <LINE access token>
Content-Type: application/json

{ "employeeId": "139653" }
```

The route resolves the LINE profile server-side, requires an active,
verified LINE Admin principal with the central `ADMIN_EMPLOYEE_BIND`
capability, and disables View As for the mutation. It uses the path
`userId` as the selected canonical target and never trusts a body role,
balance, LINE ID, or verification flag.

Success returns the authoritative target projection:

```json
{
  "success": true,
  "status": "BOUND",
  "verificationStatus": "UNVERIFIED",
  "identityState": "PENDING_VERIFICATION",
  "verificationDecision": "PENDING_TRUST_REVIEW",
  "user": { "userId": "user-123", "employeeId": "139653" }
}
```

Trusted unique roster matches use `verificationDecision: "AUTO_VERIFIED"`
and return `VERIFIED`. A same-user/same-ID retry returns success with
`status: "ALREADY_BOUND"` and the authoritative current state. A different
existing target employee ID returns `USER_EMPLOYEE_ALREADY_BOUND`; another
canonical owner returns `EMPLOYEE_ID_ALREADY_BOUND` with HTTP 409. Missing
targets, malformed IDs, and unauthorized principals fail without mutation.

The update, status decision, and `ADMIN_EMPLOYEE_BIND` audit event are one D1
batch. The update changes only `employee_id`, `verification_status` when the
bounded policy requires it, and `updated_at`; it never changes role, balance,
orders, or ownership keys. The unique user index and transaction failure path
protect concurrent claims.

## Frontend design

The Worker adapter adds `adminBindEmployee({ userId, employeeId })` and never
sends an access token, role, balance, or client-authenticated actor ID as
authority. The UI exposes the operation only when the server/local capability
projection allows it and only for a target with a null employee ID; the server
remains authoritative if the UI is bypassed.

`MemberBalanceManagement` renders the existing desktop table at medium widths
and compact two-line cards on small screens. Each row shows name, employee
ID, compact `LINE`/`非 LINE` source badge, one status badge, floor, balance,
role, and action. Null employee IDs show `未綁定` plus `綁員編` for an Admin.
Filter tabs are `全部`, `待綁員編`, `待審核`, and `已驗證`; filtering is
client-side over the last server response only.

The View As modal uses the same badge component and status mapping as the
member list. Selecting View As never changes the authenticated actor or
capabilities. After a successful bind the UI closes the dialog and fetches
the member list (and `/api/me` if the target is the current Admin) again; it
does not patch a local employee ID or verification state.

If a legacy GAS adapter is selected, the new binding operation is unavailable
and the UI does not call it. Missing identity fields are displayed with a
safe `待確認` fallback; no GAS identity contract is created.

## Security invariants

- A guest token cannot resolve to an Admin identity-management capability.
- LINE identity is accepted only from the server-validated LINE Profile API.
- `employee_id` is normalized and checked as text; leading zeroes survive.
- Canonical employee ownership is protected by the existing unique index and
  a transaction/readback conflict path.
- Binding cannot replace another canonical user's employee ID.
- Auto-verification cannot be caused by format validity, name, LINE ID, role,
  balance, or client-provided status.
- Admin authorization is enforced in the Worker route/domain, not only in
  React.
- Audit rows contain actor/target snapshots, action, submitted-ID digest,
  trust decision, and result without storing a raw credential.
- View As is read-only and never becomes the mutation actor.
- No client storage or response exposes a LINE token as identity data.

## Verification and regression coverage

Focused tests cover:

- auth-source and status badge rendering for LINE, non-LINE, pending bind,
  pending review, and verified rows;
- Worker member projection and filter inputs;
- Admin successful binding, non-Admin denial, malformed input, missing target,
  employee conflict, same-user idempotency, and role/balance preservation;
- trusted unique roster auto-verification;
- missing, inactive, untrusted, and ambiguous roster records remaining
  pending;
- no frontend or client payload can elevate verification;
- guest/LINE auth regression and guest privilege denial;
- migration schema/index/ambiguity behavior and audit atomicity.

Repository-declared root verification remains the required order:
`node --test tests/strict-identity-ledger.test.cjs`, `npm.cmd run lint`, and
`npm.cmd run build`. Worker formal tests run as an additional high-risk
scope check. Real LIFF, real View As, remote D1 contents/migration, and
production Worker deployment remain not verified locally.

## Governance and release

`AGENTS.md` is updated to state that Cloudflare Worker + D1 is the only
production backend, GAS is retired legacy evidence, and new features must be
Worker-only unless the user explicitly reauthorizes GAS. Current transport
and migration docs are updated to remove the stale assumption that GAS is the
production default.

The release target is `0.13.0`. `CHANGELOG.md` remains English; the UI
changelog translation in `src/data/changelog.js` remains Traditional Chinese.
No commit, tag, push, deploy, remote migration, or remote roster preload is
part of this slice.
