# Canonical identity and employee guest access

This document describes the formal Cloudflare Worker + D1 contract. The GAS
backend, React transport, and production deployment remain unchanged by this
local implementation.

## Identity contract

`users.user_id` is the relational identity. Every ownership or actor foreign
key in the formal schema uses this value, including orders, order history,
likes, ledger rows, ledger operators, audit rows, idempotency actors,
calendar-setting updates, opening snapshots, and quarantine review ownership.

`users.employee_id` is the business identity. It is a trimmed, non-empty text
value and remains text everywhere so leading zeroes such as `001234` survive.
`users.line_user_id` is nullable and unique, but is only an external identity
attribute. `display_name` is presentation data and is never used to resolve an
employee. Historical LINE IDs may remain in explicit event snapshots for
auditability; snapshots are not relational ownership keys.

Existing formal users migrated from the old schema receive a deterministic
internal `legacy_<sha256-like-hex>` user ID derived from the old LINE value
only as a migration key. Their `employee_id` remains NULL until an exact,
reviewed business mapping is supplied. A migration key is never an employee
ID.

## Authentication and authorization

The formal Worker resolves a bearer token in this order:

1. Match the hash of an opaque employee guest token in
   `employee_guest_sessions`; require an unexpired, unrevoked session whose
   user is active and still has `line_user_id IS NULL`.
2. Otherwise verify the bearer with LINE Profile and look up the verified
   `line_user_id` in `users`.

An unknown LINE profile is not auto-registered. The compatibility registration
surface returns `EMPLOYEE_BIND_REQUIRED` until an existing canonical employee
is linked.

Employee guest login is:

```text
POST /api/auth/employee-guest
{ "employeeId": "001234" }
```

The request value must be a string. The endpoint accepts only one active,
unbound canonical employee and returns a one-time opaque token with
`authMode: "employee_guest"`. It does not call LINE, accept a client role,
or create a user. Numeric input is rejected rather than being coerced and
losing leading zeroes.

Guest requests are self-only. The effective action set is exactly
`READ_SELF`, `REGISTER_SELF`, and `WRITE_SELF`, regardless of the stored role;
therefore a guest-authenticated `Admin` or `ProxyAdmin` cannot read admin
summary, top up another account, change roles, edit calendar settings, use
View As, or access other privileged operations.

The guest token determines the canonical actor. Client-supplied `userId`,
`employeeId`, `lineUserId`, `role`, balance, and display-name fields cannot
change ownership or authorization. Guests can order, cancel their own order,
and read their own balance/history while the session is valid.

## Atomic LINE binding

Binding is:

```text
POST /api/auth/line-bind
Authorization: Bearer <LINE access token>
X-Employee-Guest-Session: <employee guest token>
```

The Worker verifies both credentials, conditionally updates the existing
canonical user row, and revokes every guest session for that `user_id` in one
D1 batch. A unique LINE constraint rejects claims already owned by another
user. The implementation reads back the same canonical row and treats a
same-user/same-LINE replay as `ALREADY_BOUND`; it never inserts a second user.

After a successful bind, the old guest token immediately fails normal
requests, including `/api/me`, order mutation, cancellation, balance/history,
and admin routes. Only the bind endpoint may accept that revoked token for an
idempotent replay to the same verified LINE identity. Different LINE claims,
expired sessions, inactive users, and other revocation reasons are rejected.

## Readiness gates

Identity foundation readiness is independent of the legacy workbook:

```text
IDENTITY FOUNDATION READINESS: READY
```

The evidence covers the canonical `user_id` schema, LINE authentication,
employee guest login, conflict-safe LINE binding, server-side permission
enforcement, and the existing React/LIFF login boundary. The React app still
defaults to GAS transport, and the Worker guest-login UI plus production
transport cutover remain a separately authorized follow-up. Those frontend
cutover items do not make the formal Worker identity foundation or the legacy
import gate appear ready or blocked.

Legacy import readiness is a separate gate:

```text
LEGACY IMPORT READINESS: BLOCKED
```

The current workbook's mapping, ownership, and financial evidence remain the
only inputs to this gate. The compatibility field `readiness` in validation
and reports aliases `legacyImportReadiness`; replacement SQL is allowed only
when the legacy gate is `PASS` and has no relational blockers.

## Import relationship

The dry-run, local stage, and future remote replacement all use the same
parse → normalize → exact identity map → validate → transform → reconcile →
persistence-plan path. Mapping precedence is explicit employee ID, then an
exact reviewed LINE/source mapping. There is no fuzzy name matching and no
derivation from a raw LINE ID.

The current workbook lacks `employee_id` in `Users`, so legacy import
readiness is truthfully `BLOCKED`; no replacement SQL is emitted. Financial
reconciliation reports unexplained differences and policy blockers directly.
It never inserts an unexplained balancing offset or synthetic ledger event to
force a pass.
