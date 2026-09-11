# Identity and verification architecture

Status: active governance for the formal Cloudflare Worker + D1 production
backend. This document records the 0.13.0 identity-management boundary.

## Production transport

Cloudflare Worker + formal D1 is the only production backend and the only
source of truth for identity, authorization, balances, and new feature
behavior. GAS is fully retired. Files under `gas/`, the GAS adapter, and GAS
tests remain only as legacy artifacts and regression evidence; they are not an
active transport or identity authority. New work must not add GAS API,
identity/auth logic, Sheet contracts, or business logic unless explicitly
reauthorized.

## Separate concepts

These concepts must remain independent:

1. Authentication establishes who is making the request. `authMode` is the
   request credential mode (`line` or `employee_guest`).
2. Employee binding associates a canonical `user_id` with one textual
   `employee_id`. IDs retain the import contract's textual form and are
   compared case-insensitively after trim/case normalization. Binding does not
   grant verification, a role, or a balance.
3. Verification establishes whether the employee identity is trusted for
   normal application access. D1 stores `verification_status` and the Worker
   projects it as public `identityState`.
4. Authorization derives capabilities from the authenticated principal,
   central role/capability policy, active state, auth mode, employee binding,
   and verification state. Frontend visibility is never authorization.

`authSource` is a server projection for member management, not a client claim:
`LINE` means the canonical user has a non-empty `line_user_id`; otherwise the
member is `EMPLOYEE_GUEST` / non-LINE.

## Public identity states

| Public state | Server meaning | UI label |
| --- | --- | --- |
| `EMPLOYEE_BIND_REQUIRED` | Canonical user exists with no employee ID | 待綁員編 |
| `PENDING_VERIFICATION` | Canonical employee binding is stored but verification is not trusted | 待審核 |
| `VERIFIED` | Active canonical identity has trusted verification | 已驗證 |

`UNVERIFIED` is a storage value and maps to public
`PENDING_VERIFICATION`. `NEW_PROVISIONAL_EMPLOYEE` and `UNREGISTERED` remain
server-owned lifecycle states where needed by onboarding. The frontend must
consume the returned `identityState`; it must not infer a state from
`employee_id`, role, auth source, or a local boolean, and must never elevate a
state to `VERIFIED`.

## Trusted auto-verification

Automatic verification is exception-oriented: most records with reliable
trusted evidence pass automatically, while uncertain records remain visible
for review. The submitted textual employee ID may become `VERIFIED` only when
all of these conditions hold:

- exactly one `employee_roster` row matches the normalized textual ID;
- that row is active;
- its provenance is an allowed trusted source (`TRUSTED_IMPORT` or a future
  separately governed `ADMIN_APPROVED` record);
- no other canonical user owns the employee ID; and
- no duplicate or other identity ambiguity exists.

Missing, inactive, untrusted, or ambiguous roster evidence stores
`UNVERIFIED` and returns `PENDING_VERIFICATION`. A valid format or knowledge
of an employee ID is never sufficient. A canonical ownership conflict fails
closed and never becomes a reassignment or a pending approval.

The 0.13.0 migration adds the minimal, empty `employee_roster` trust source
because existing imported canonical rows lack source provenance and an
independent employee active/inactive meaning. It deliberately does not add a
unique roster index: duplicate source records must remain representable so
the resolver can fail closed. Canonical `users.employee_id` retains its
partial unique ownership index and adds a case-insensitive normalized
ownership index. A pre-existing case-variant collision must fail migration
closed.

## Admin binding policy

The Worker exposes:

```text
POST /api/admin/users/:userId/employee-binding
Authorization: Bearer <LINE access token>
{ "employeeId": "..." }
```

The route requires a server-validated, active, verified LINE Admin principal,
central `ADMIN_EMPLOYEE_BIND` capability, and no View As mutation context. It
updates only the target employee binding, the bounded verification storage
value, and `updated_at`. Role, balance, orders, and unrelated identity fields
are not changed. The canonical unique index, conditional update, atomic audit
batch, and authoritative readback protect conflicts and concurrent claims.

Same-user/same-ID retry is idempotent and auditable. A different target ID or
another canonical owner's ID fails closed.

Admin “bind employee” and Admin “approve verification” are separate actions.
0.13.0 implements only binding plus bounded automatic verification; it does
not add a manual approval mutation. Any future approval action requires its
own capability, endpoint, audit action, and explicit state transition.

## Review and migration boundary

The member list and View As selector use server-returned `authSource`,
`identityState`, and `verificationStatus`. Filters are client-side over the
latest authoritative response and include all, binding required, pending
verification, and verified. Pending review is therefore visible without
turning client filtering into an authority.

Migration `0004_employee_roster_verification_source.sql` is additive and
local-only in this slice. Remote migration status: `REMOTE MIGRATION: NOT
EXECUTED`. No remote D1 migration, roster preload, Worker deployment, commit,
or push was performed. A later remote operation requires
the exact formal D1 target, backup, reviewed roster provenance, migration
verification, and explicit authorization.
