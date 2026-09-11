# Provisional Employee and LINE Authentication Design

## Goal

Extend the formal Cloudflare Worker + D1 authentication flow so a valid but
unmapped six-character employee ID can complete explicit LINE onboarding as an
`UNVERIFIED` canonical user, while preserving canonical `user_id` ownership,
server-side LINE verification, and fail-closed authorization.

## Current constraints

- The formal Worker uses `env.DB` bound to `bento-formal`.
- `0002_canonical_identity_rekey.sql` is present in the repository but is not
  yet applied to the remote D1 database.
- The current employee guest session requires a canonical `users.user_id` and
  the current guest login rejects an unknown employee with `404`.
- The current workbook has no employee ID column and no approved identity map;
  full production employee import remains `BLOCKED`.
- CORS, `.env.development`, GAS code, production secrets, commit, push, and
  deploy are outside this change.

## Identity and session model

`users.user_id` remains the only relational application identity.
`users.employee_id` remains the textual corporate identity and is normalized
by trim followed by uppercase. `users.line_user_id` remains a nullable unique
LINE identity attribute.

Migration `0003_provisional_employee_identity.sql` adds:

- `users.verification_status`, constrained to `VERIFIED` or `UNVERIFIED`, with
  existing canonical users defaulting to `VERIFIED`.
- A rebuilt `employee_guest_sessions` table whose `user_id` is nullable,
  whose `employee_id` is retained directly on the session when created by the
  new Worker, and whose status is `VERIFIED` or `UNVERIFIED_EMPLOYEE`. The
  session employee ID is nullable with a compatibility default so the
  currently deployed Worker can continue inserting old-format verified
  sessions until the new Worker is deployed.

An unknown employee login creates only a provisional opaque session. It does
not create a user row and cannot acquire application data. After the user has
authenticated with LINE and explicitly supplied a display name and pickup
floor, the server atomically creates a new canonical user with a server-
generated `user_id`, `role = 'User'`, `active = 1`, `balance = 0`, and
`verification_status = 'UNVERIFIED'`. The same transaction attaches and
revokes the onboarding session.

## Central principal and authorization

The canonical principal contains `userId`, `employeeId`, `lineUserId`,
`role`, `active`, `verificationStatus`, `authMode`, `registered`, and
`capabilities`. Capability derivation is centralized:

- `VERIFIED + User`, `ProxyAdmin`, or `Admin` receives the existing role and
  auth-mode capability set.
- `UNVERIFIED` receives only onboarding capabilities:
  `CAN_VIEW_SELF_ONBOARDING_STATE`, `CAN_COMPLETE_PROFILE`, and
  `CAN_BIND_LINE`.
- An inactive principal receives no capabilities.

`assertCan` authorizes from the principal's derived capabilities rather than
recomputing permissions from `role`. This prevents an `UNVERIFIED` user with
`role = User` and `active = 1` from inheriting ordinary user access if a route
forgets a local verification check. Protected application-data routes require
a verified capability and cannot use a provisional `user_id` to read balances,
orders, or another user.

The `/api/me` response remains the onboarding state surface. Provisional
responses include `status: 'UNVERIFIED_EMPLOYEE'`, the normalized employee ID,
and only the own provisional profile when one exists. All privileged routes,
View As, member balances, top-up, calendar administration, role assignment,
and other-user access are denied centrally.

## Employee Guest Login contract

The server normalizes and validates the request with `/^[A-Z0-9]{6}$/` after
trimming. Invalid input returns:

```json
{"error":"INVALID_EMPLOYEE_ID"}
```

with HTTP 400. A canonical employee with `line_user_id IS NULL`, active state,
and `verification_status = VERIFIED` receives the existing opaque guest
session with `status: 'VERIFIED'` and self-only guest capabilities.

Any canonical user whose employee ID already has a non-null `line_user_id`
is rejected before session creation with:

```json
{"error":"LINE_LOGIN_REQUIRED"}
```

and HTTP 409, regardless of `verification_status`. A valid employee ID with
no canonical row returns HTTP 200 and an opaque provisional session with:

```json
{
  "success": true,
  "status": "UNVERIFIED_EMPLOYEE",
  "authMode": "employee_guest",
  "employeeId": "ABC123",
  "token": "...",
  "expiresAt": "..."
}
```

No `user`, role, balance, or privileged capability is returned for that
provisional response.

## LINE onboarding and collision rules

Existing LINE bindings continue to resolve directly without asking for an
employee ID. An unbound LINE identity uses a separate server-authenticated
employee lookup and binding flow; it must not create an employee guest
session. The employee guest/onboarding session remains only for the fallback
flow where no LINE authentication context is available.

- Existing employee: the frontend shows canonical employee data and requires
  explicit confirmation before `line-employee-bind`.
- Unknown employee: the frontend collects display name and floor, then the
  server verifies the LINE Bearer token, rechecks the employee ID, and creates
  the unverified canonical row atomically through `line-employee-bind`.
- No LINE context: the fallback uses `employee-guest` followed by
  `line-bind`; that is the only path that creates an employee guest session.
- A LINE ID already owned by another canonical user returns `LINE_ALREADY_BOUND`.
- An employee ID already bound to another LINE identity returns
  `EMPLOYEE_ALREADY_LINE_BOUND` or `LINE_LOGIN_REQUIRED` as appropriate.
- Ordinary login never rebinds an existing employee or LINE identity.
- Rebind/account transfer is out of scope.

The request body is never an authority for `employeeId`, `userId`,
`lineUserId`, `role`, or `verificationStatus`; those values are resolved from
the verified session, LINE profile, and canonical D1 state.

## Remote rollout

Local migration and all Worker/React/security tests run first. A fresh export
is created without overwriting existing `.local-imports` artifacts. Only then
are `0002` and `0003` applied to `bento-formal`, in that order, with schema,
index, uniqueness, foreign-key, and row-count verification between steps.

The workbook employee import is not executed because its current readiness is
blocked and there is no approved mapping. `139653` therefore remains an
unknown valid employee and must resolve to `UNVERIFIED_EMPLOYEE` after the new
Worker source is deployed. Source changes require a later Worker deploy; this
task does not deploy.

## Verification

Tests cover normalization, verified/unknown/invalid employee states, the
LINE-required rule for any bound user, provisional central capabilities,
privileged route denial, profile completion, LINE binding, existing binding,
collision protection, and no silent rebind. Automated Worker verification,
root governed verification, remote migration evidence, and manual LINE smoke
evidence are reported separately.
