# Identity and verification architecture

Status: active governance for the formal Cloudflare Worker + D1 production
backend. This document records the superseding 0.13.0 identity boundary.
The earlier verification-gated design remains historical evidence in
`docs/superpowers/specs/2026-09-12-identity-verification-simplification-design.md`
and is not rewritten here.

## Production transport

Cloudflare Worker + formal D1 is the only production backend and the only
source of truth for identity, authorization, balances, and new feature
behavior. GAS is fully retired. Files under `gas/`, the GAS adapter, and GAS
tests remain only as legacy artifacts and regression evidence; they are not an
active transport or identity authority. New work must not add GAS API,
identity/auth logic, Sheet contracts, or business logic unless explicitly
reauthorized.

## Separate concepts

These concepts remain independent:

1. Authentication establishes who is making the request. `authMode` is the
   request credential mode (`line` or `employee_guest`).
2. Employee binding associates a canonical `user_id` with one textual
   `employee_id`. IDs retain the import contract's textual form and are
   compared case-insensitively after trim/case normalization. Binding does
   not change the canonical role, balance, or LINE identity.
3. `verification_status` and `employee_roster` are retained compatibility
   fields. They are informational and are not an active LINE access gate.
4. Authorization derives capabilities from the authenticated principal,
   central role/capability policy, active state, auth mode, employee binding,
   and canonical role. Frontend visibility is never authorization.

The authoritative registered predicate is:

```text
active = 1 AND authMode = LINE AND employee_id is present
```

An active registered LINE user receives the capabilities of the stored role,
including `Admin` and `ProxyAdmin`, regardless of historical
`verification_status`. An active LINE user without an employee ID receives
only the self-binding/onboarding boundary. An `employee_guest` principal is
guest-only regardless of its stored role.

## Public identity states

| Public state | Server meaning | UI label |
| --- | --- | --- |
| `EMPLOYEE_BIND_REQUIRED` | Canonical LINE user exists with no employee ID | 待綁員編 |
| `PENDING_VERIFICATION` | Legacy employee_guest compatibility projection only; never an active LINE state | 員工訪客 |
| `VERIFIED` | Compatibility projection for an active registered LINE identity (or legacy guest value) | 已註冊 |

`UNVERIFIED` remains a historical storage value and may continue to be
returned as `verificationStatus`. It is informational only: it does not
change `registered`, authorization, employee binding, claimability, View As,
or normal application access. `NEW_PROVISIONAL_EMPLOYEE` and
`UNREGISTERED` remain server-owned lifecycle states where needed by guest
onboarding. The frontend consumes the authoritative `registered`, `authMode`,
and `identityState` response and does not implement verification gates.

## Legacy verification compatibility

The `employee_roster` table and `resolveEmployeeVerification` helper remain
available for legacy employee_guest onboarding and historical regression
coverage. They are not a runtime trust source for active LINE login,
registration, authorization, employee binding, provisional claim, or View As.
No roster match is required to bind an employee ID, and claim never changes
`verification_status` or reads roster evidence. There is no active LINE
approval or `PENDING_VERIFICATION` workflow in 0.13.0.

The additive 0004 schema is retained for compatibility and audit history. It
is not removed or repurposed as an authorization table. Canonical
`users.employee_id` retains its partial unique ownership index and
case-insensitive normalized ownership index. A pre-existing case-variant
collision remains fail-closed.

## Employee binding and provisional claim

The Worker exposes the existing authenticated LINE endpoint:

```text
POST /api/auth/line-employee-bind
Authorization: Bearer <LINE access token>
{ "employeeId": "001234" }
```

The decision tree is:

1. no normalized owner -> normal binding;
2. owner is the authenticated LINE survivor -> idempotent success;
3. another owner explicitly satisfying the claimable employee_guest
   provisional predicate -> atomic claim, retire, revoke, and audit;
4. every other owner -> `409 EMPLOYEE_ID_ALREADY_BOUND`.

Claim requires unique/non-ambiguous ownership, an active unbound survivor,
an active unbound non-privileged provisional owner, historical matching
employee_guest provenance, and no unsafe business ownership. Orders, ledger,
opening-balance, likes, idempotency/business ownership, and other data that
cannot be safely re-parented fail closed. Audit/history references and
historical guest evidence are not blockers.

The claim uses one D1 `batch()` with SQL-level NOT NULL assertions based on
the existing `employee_guest_sessions.token_hash` constraint. It rechecks
the ownership and concurrency guards inside the batch, releases the
provisional employee ID, retires the row with `active=0` and
`employee_id=NULL` without hard deletion, revokes only currently valid
matching guest sessions, writes `PROVISIONAL_EMPLOYEE_CLAIMED`, and performs
an authoritative survivor readback. The revoke update and postcondition use
the same parenthesized guest/validity predicate.

## Admin binding policy

The Admin route is:

```text
POST /api/admin/users/:userId/employee-binding
Authorization: Bearer <LINE access token>
{ "employeeId": "..." }
```

It requires a server-validated registered active LINE Admin principal
(`active=1`, LINE auth mode, and an existing employee ID), the central
`ADMIN_EMPLOYEE_BIND` capability, and no View As mutation context. It updates
only the target employee binding and `updated_at`. Role, balance,
`verification_status`, orders, and unrelated identity fields are not changed.
Same-user/same-ID retry is idempotent and auditable. A different target ID or
another canonical owner's ID fails closed.

Any future verification review would be a separate, explicitly designed
capability and endpoint. 0.13.0 has no active Admin approval workflow.

## Review and remote boundary

The member list and View As selector use server-returned `authSource`,
`identityState`, role, and employee ID. `verificationStatus` may be retained
for historical display but is informational only; there is no active
pending-review filter or approval UI. View As and every privileged Worker
route use the same central role/auth-mode/registered policy.

Migration `0004_employee_roster_verification_source.sql` is additive and
retained; it is not a new remote access prerequisite. Remote migration status:
`REMOTE MIGRATION: NOT EXECUTED`. No remote D1 migration, roster preload,
Worker deployment, commit, or push was performed by this local slice. A later
remote operation requires the exact formal D1 target and separate explicit
authorization.
