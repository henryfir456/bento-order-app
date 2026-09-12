# Canonical identity and employee guest access

This document describes the formal Cloudflare Worker + D1 contract. Worker +
D1 is the active production architecture; GAS is fully retired and retained
only as legacy regression evidence.

The superseding 0.13.0 identity design is recorded in
`docs/superpowers/specs/2026-09-12-identity-verification-simplification-design.md`.
Earlier claim/verification documents are historical and remain unchanged.

## Identity contract

`users.user_id` is the relational identity. Ownership or actor foreign keys
in the formal schema use this value, including orders, order history, likes,
ledger rows, audit rows, idempotency actors, calendar-setting updates,
opening snapshots, and quarantine review ownership.

`users.employee_id` is textual business identity. It is normalized by trim and
case for comparison, while leading zeroes such as `001234` are preserved.
`users.line_user_id` is nullable and unique, and `display_name` is presentation
data only. Historical LINE IDs may remain in event snapshots for auditability;
snapshots are not relational ownership keys.

The authoritative registered state is:

```text
active=1 + authMode=LINE + employee_id exists
```

This state uses the canonical stored role. `verification_status` is retained
as an informational compatibility field and does not gate registration,
authorization, binding, claim, View As, or normal application access.

## Authentication and authorization

The formal Worker resolves an opaque employee guest token first when it is
valid, unexpired, unrevoked, and associated with an active unbound user.
Otherwise it verifies the Bearer credential with LINE Profile and resolves the
server-validated `line_user_id` in `users`. Client-supplied user IDs, roles,
balances, employee IDs used as ownership authority, and display names do not
change the actor.

An active registered LINE principal receives the central capabilities for its
stored role, including Admin or ProxyAdmin capabilities. An active LINE
principal with no employee ID is limited to the self binding/onboarding
boundary. An employee_guest principal is always guest-only regardless of its
stored role; its effective actions are `READ_SELF`, `REGISTER_SELF`, and
`WRITE_SELF`.

`PENDING_VERIFICATION`, `UNVERIFIED`, and `employee_roster` remain only for
legacy employee_guest/status compatibility and historical tests. They are not
active LINE authorization gates or approval workflow states.

## Employee guest login

```text
POST /api/auth/employee-guest
{ "employeeId": "001234" }
```

The request value must be a string. The endpoint returns an opaque,
expiring `employee_guest` session for an active unbound employee or an
explicit provisional session for an unknown textual ID. It never calls LINE,
accepts a client role, or creates an Admin-capable principal. A LINE-bound
employee returns `LINE_LOGIN_REQUIRED`.

Employee guest onboarding remains a compatibility path for users without a
LINE context. It keeps `line_user_id` NULL, stored role `User`, and the guest
capability boundary. The legacy roster resolver may populate a historical
verification value for this guest path only; that value does not grant access.

## LINE employee binding and claim

For an authenticated LINE principal without an employee ID, use the existing
endpoint:

```text
POST /api/auth/line-employee-bind
Authorization: Bearer <LINE access token>
{ "employeeId": "001234" }
```

The Worker derives the LINE identity from the verified token. The binding
decision tree is:

1. no normalized owner -> normal binding;
2. owner is the current LINE survivor -> idempotent success;
3. another owner explicitly matching the claimable employee_guest provisional
   predicate -> atomic claim, retire, revoke, and audit;
4. any other existing owner -> `409 EMPLOYEE_ID_ALREADY_BOUND`.

`line_user_id IS NULL` by itself is not claim permission. A claimable owner
must be active, unbound, non-privileged, uniquely owning the normalized ID,
and have historical matching employee_guest provenance. It must not own
orders, balance ledger rows, opening-balance snapshots, likes,
idempotency/business ownership, or another relation that cannot be safely
re-parented. Audit/history references and expired or revoked guest evidence do
not block the claim.

The claim runs as one D1 `batch()` with SQL-level failure assertions using the
existing `employee_guest_sessions.token_hash NOT NULL` constraint. It
rechecks survivor, owner, ownership uniqueness, provenance, dependencies, and
concurrency inside the atomic mutation; releases the provisional employee ID,
retires the row with `active=0` and `employee_id=NULL` without hard delete,
revokes only currently valid matching guest sessions, writes exactly one
`PROVISIONAL_EMPLOYEE_CLAIMED` audit event, and reads back the survivor.

The revoke and postcondition predicate is shared and parenthesized:

```sql
auth_mode = 'employee_guest'
AND revoked_at IS NULL
AND expires_at > batch_clock
AND (
  (employee_id is the normalized requested employee ID)
  OR user_id = retired provisional owner
)
```

The survivor keeps its LINE identity, active state, role, balance, and
historical `verification_status`. No financial or historical business row is
automatically re-parented.

## Admin and View As boundary

Admin employee binding requires a registered active LINE Admin:

```text
active=1 + authMode=LINE + employee_id exists + role=Admin
```

The Worker central capability policy authorizes every Admin/ProxyAdmin route;
frontend navigation is only presentation. View As changes the read subject
only, never the authorization actor, and mutations remain forbidden while a
View As context is active.

## Readiness and import relationship

Identity foundation readiness is independent of the legacy workbook:

```text
IDENTITY FOUNDATION READINESS: READY
```

The evidence covers canonical `user_id`, LINE authentication, restricted
employee guest sessions, conflict-safe binding/claim, server-side permission
enforcement, opaque session transport, and the React/LIFF boot boundary.
Real LIFF and production deployment evidence remain separately authorized
manual steps.

Legacy import readiness remains separate:

```text
LEGACY IMPORT READINESS: BLOCKED
```

The import path still requires an explicit exact identity map and financial
reconciliation. It must not infer identity from names or create unexplained
balancing entries. No remote migration, roster preload, D1 mutation,
deployment, or cleanup is implied by this document.
