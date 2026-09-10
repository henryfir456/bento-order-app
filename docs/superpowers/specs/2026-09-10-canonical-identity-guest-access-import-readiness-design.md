# Canonical Identity, Employee Guest Access, and Remote Import Readiness Design

**Date:** 2026-09-10  
**Status:** Self-reviewed draft; implementation pending  
**Scope:** Cloudflare Worker + formal D1 only. GAS production code and remote D1 remain out of scope.

## Goal

Prepare the formal Worker + D1 architecture for a safe legacy-data import by
making `user_id` the relational identity, making `employee_id` the business
canonical identity, adding bounded employee guest access and conflict-safe
LINE binding, and making dry-run import/reconciliation the same business path
that a future remote import will use.

The work stops at a remote-import readiness checkpoint. A readiness result of
`BLOCKED` is expected for the current workbook because its `Users` sheet does
not contain an `employee_id` field. No production D1 write, remote import,
deployment, commit, or push is part of this design or implementation.

## Existing evidence and constraints

The repository is a React/Vite + GAS/LIFF application with a formal Worker
under `worker-poc/`. The current formal schema uses `users.line_user_id` as
the primary key and uses LINE ID columns as foreign keys throughout orders,
ledger, audit, likes, calendar, and idempotency tables. The current Worker
auth flow verifies a LINE Bearer token against `https://api.line.me/v2/profile`
and may create an unknown LINE user through the legacy registration route.

The local source workbook is `gas/便當系統設定.xlsx`. Read-only inventory
found these rows: Settings 13, Likes 5, TopupHistory 2, Users 3, Menu 28,
Announcements 2, and Orders 25. Its Users headers are
`UserID (LINE ID)`, `DisplayName`, `樓層`, `Balance`, and `Role`; no
`employee_id` field is present. Orders contain 22 non-blank LINE IDs and 3
rows without a LINE owner. The current workbook therefore cannot prove
canonical employee ownership. The importer must surface that condition and
return `BLOCKED`; it must not derive employee IDs from names, LINE IDs, or
numeric coercion.

The existing working-tree cancellation changes present before this task are
user-owned and must be preserved. They touch the root App/API cancellation
flow, Worker order routing, and cancellation tests. This feature avoids the
root App cancellation code and edits overlapping Worker/test files only
around the existing behavior when required by the new identity contract.

## Architectural invariants

1. `users.user_id` is the internal relational identity.
2. `users.employee_id` is the company business identity and is stored as text.
3. `users.line_user_id` is a nullable, unique external LINE identity.
4. `display_name` is presentation data only.
5. `employee_guest` is an authentication mode, never a persistent role.
6. Only an active, unbound employee with a non-blank employee ID can use
   employee-only guest access.
7. Once a user has a LINE binding, employee-only guest access is rejected,
   including by already-issued guest sessions.
8. Guest authorization is the low-risk self-service subset of the stored
   role, even when the stored role is `Admin` or `ProxyAdmin`.
9. LINE binding updates the existing canonical user row and never creates a
   second user or moves orders, balance, or ledger ownership.
10. No identity conflict is silently merged; unresolved ownership blocks
    remote import when financial or order ownership could be affected.
11. Financial reconciliation cannot be forced to pass with a balancing offset
    that has no source evidence or approved policy.
12. Dry-run, local stage, and future remote replacement use the same
    parse → normalize → resolve → validate → transform → reconcile →
    persistence-planner path.

## Approach

Use one forward formal migration that rebuilds identity-dependent tables in a
data-preserving way. The migration changes relational references to
`user_id`, keeps historical external identity snapshots where useful, and
leaves `d1_migrations` untouched. The Worker keeps its current Bearer
boundary: a Bearer value is first checked against the server-side guest
session table; otherwise it is verified as a LINE access token. No JWT or
general IAM framework is introduced.

The importer gains a small exact identity-mapping layer. It accepts a source
employee ID when present, an exact existing LINE-to-employee mapping when
proven, or an explicit source-row mapping supplied by a local mapping file.
It never uses fuzzy matching. The current workbook is intentionally left
unresolved until a reviewed employee mapping is supplied.

## Data model

### Users

The formal `users` table becomes:

```text
user_id       TEXT PRIMARY KEY
employee_id   TEXT NULL, UNIQUE when non-blank
line_user_id  TEXT NULL, UNIQUE when non-blank
display_name  TEXT NOT NULL
pickup_floor  TEXT NOT NULL, one of 1樓 / 9樓
balance       INTEGER NOT NULL DEFAULT 0
role          TEXT NOT NULL, User / ProxyAdmin / Admin
active        INTEGER NOT NULL DEFAULT 1
created_at    TEXT NOT NULL
updated_at    TEXT NOT NULL
```

`employee_id` remains nullable for already-existing LINE users or
historical-only records that cannot yet be mapped safely. The guest endpoint
requires a non-blank employee ID, and reconciliation marks active users
without one as not import-ready. New imported active users must include an
employee ID. A unique partial index or equivalent uniqueness rule allows
multiple NULL values while preventing duplicate non-blank employee IDs.

All monetary fields remain SQLite `INTEGER`; negative balances remain valid.

### Relational ownership

The following tables use internal `user_id` references instead of
`line_user_id` ownership keys:

```text
likes.user_id
orders.user_id
opening_balance_snapshots.user_id
balance_ledger.user_id
balance_ledger.operator_user_id
admin_audit_log.actor_user_id
admin_audit_log.target_user_id
idempotency_keys.actor_user_id
calendar_settings.updated_by_user_id
order_status_history.actor_user_id
```

External LINE IDs are retained only as nullable user attributes or explicit
historical snapshots. They are not foreign-key authorities.

`orders` also records immutable event context needed for auditability:

```text
employee_id_snapshot
line_user_id_snapshot
display_name_snapshot
created_by_user_id
created_auth_mode       line | employee_guest | legacy_import
cancelled_by_user_id
cancelled_auth_mode     NULL or line | employee_guest | legacy_import
```

The order owner remains `orders.user_id`; snapshots preserve historical
readability and do not determine ownership. `order_status_history` stores
`actor_user_id`, `actor_auth_mode`, and external identity snapshots. Existing
legacy rows are marked `legacy_import` rather than being falsely described as
LINE-authenticated or guest-created.

`balance_ledger` stores `user_id`, `operator_user_id`, and external identity
snapshots where the source has them. Existing balance/ledger sequence and
opening-balance policy behavior remains intact.

### Guest sessions

Add a focused `employee_guest_sessions` table:

```text
session_id        TEXT PRIMARY KEY
token_hash        TEXT NOT NULL UNIQUE
user_id           TEXT NOT NULL REFERENCES users(user_id)
auth_mode         TEXT NOT NULL CHECK (auth_mode = 'employee_guest')
created_at        TEXT NOT NULL
expires_at        TEXT NOT NULL
revoked_at        TEXT NULL
revoked_reason    TEXT NULL CHECK (revoked_reason IN ('line_bound', 'admin_revoke'))
```

The clear token is returned once to the client and is never stored. Every
request hashes the Bearer value and loads the session server-side. The session
contains no client-controlled role, balance, employee ID, or authorization
state. A default short lifetime is eight hours. Binding revokes all guest
sessions for that user, and identity resolution also rejects a session when
the user is no longer active or has a non-NULL LINE binding.

## Identity and authentication flow

### LINE identity

The existing LINE profile verification remains the source of
`line_user_id`. `resolveCanonicalIdentity` loads the matching user by the
unique LINE ID, then returns separate `actor`, `authorizationActor`, and
`effectiveSubject` fields. A missing row remains an unregistered LINE
identity; it is not auto-created.

The legacy `POST /api/register` route remains only as a compatibility surface
for an already registered user. An unknown LINE identity receives a stable
`EMPLOYEE_BIND_REQUIRED` response and must be linked through the guest-bound
LINE binding flow. This preserves the existing access-token boundary without
creating a stranger employee.

### Employee guest login

Endpoint:

```text
POST /api/auth/employee-guest
```

Request:

```json
{ "employeeId": "001234" }
```

The server trims and validates the employee ID as text. Numeric JSON values
are rejected so an ID such as `001234` cannot be silently converted to
`1234`. The server loads exactly one user by `employee_id`, checks
`active = 1`, and checks `line_user_id IS NULL`. It then creates an opaque
session with a hashed token and returns the public user projection, the
server-derived `authMode: "employee_guest"`, and the guest capability list.

Stable errors are:

```text
INVALID_EMPLOYEE_ID          400
EMPLOYEE_NOT_FOUND           404
EMPLOYEE_INACTIVE            403
EMPLOYEE_ALREADY_LINE_BOUND  409
```

The endpoint does not return a LINE account identifier. It does not call LINE
Profile API and does not create a user.

### Guest request resolution

For protected requests, the Worker resolves the Bearer value as follows:

```text
Bearer token
  ├─ matching active, unexpired, unrevoked guest session
  │    → user_id from session
  │    → auth_mode = employee_guest
  │    → re-check active and line_user_id IS NULL
  └─ no guest session
       → verify with LINE Profile API
       → lookup user by verified line_user_id
       → auth_mode = line
```

The server ignores any client-supplied `userId`, `employeeId`, `role`,
`authMode`, balance, or display name in protected request bodies and query
strings. A guest token cannot be changed into another employee by changing
request data.

### LINE binding

Endpoint:

```text
POST /api/auth/line-bind
Authorization: Bearer LINE_ACCESS_TOKEN
X-Employee-Guest-Session: GUEST_SESSION_TOKEN
```

The server verifies both credentials. The guest session determines the
employee; the LINE profile determines the verified `line_user_id`. No second
employee ID is accepted in the request body.

The binding transaction uses a unique LINE constraint and a conditional
update:

```sql
UPDATE users
SET line_user_id = ?, updated_at = ?
WHERE user_id = ?
  AND active = 1
  AND line_user_id IS NULL;
```

It revokes the employee's guest sessions in the same atomic batch, setting
`revoked_reason = 'line_bound'`. After the batch, the server reads the row. A
row containing the requested LINE ID is a successful first bind or idempotent
repeat; a different LINE ID is a conflict. A unique-constraint failure means
the LINE ID belongs to another employee and is rejected. Concurrent different
claims of one employee therefore yield at most one binding; concurrent
repeats of the same binding are idempotent.

The revoked session is immediately invalid for ordinary guest requests. The
bind endpoint alone may accept a session revoked with `line_bound` for a
same-user, same-verified-LINE idempotent replay; it must reject that token for
any different LINE identity or any other endpoint. An expired session or a
session revoked for another reason is never accepted for binding.

Binding cases:

```text
unbound employee + unused LINE             → 200 BOUND
same employee + same LINE                  → 200 ALREADY_BOUND
employee bound to a different LINE         → 409 EMPLOYEE_ALREADY_LINE_BOUND
LINE already bound to another employee     → 409 LINE_ALREADY_BOUND
missing/expired guest session               → 401 GUEST_SESSION_INVALID
inactive or missing employee               → 403/404 stable error
```

On success, the response is a LINE-authenticated context for the same
`user_id`. Orders, balance, ledger, role, floor, and history do not move.

## Authorization model

The backend centralizes effective permissions in `assertCan` (or its focused
equivalent). The effective action set is the intersection of stored role and
authentication mode:

```text
line + User       → existing User actions
line + ProxyAdmin → existing ProxyAdmin actions
line + Admin      → existing Admin actions
guest + any role  → READ_SELF / WRITE_SELF low-risk self-service only
```

Guest self-service includes reading menu/calendar, reading the effective
user's own balance and history, creating/replacing their own order, cancelling
their own order, and other existing low-risk personal reads explicitly
covered by current routes. Guest does not receive `READ_ADMIN_SUMMARY`,
`ADMIN_CALENDAR`, `ADMIN_TOP_UP`, `READ_MEMBER_BALANCES`, `ADMIN_ROLE`,
`ADMIN_ANNOUNCEMENTS`, `VIEW_AS`, proxy assignment, role/identity mutation,
or any other privileged action.

All sensitive routes enforce the resolved context on the server. UI hiding is
not an authorization boundary. View As remains read-only, is available only
to a LINE-authenticated Admin, and never changes the authorization actor.

## Legacy inventory and archive strategy

The importer reports each source and its identity/financial effect:

| Source | Formal destination | Identity dependency | Treatment |
| --- | --- | --- | --- |
| Users | `users`, `opening_balance_snapshots` | employee ID / exact LINE mapping | launch-required; unresolved rows block |
| Orders | `orders`, `order_items`, `order_status_history` | owner mapping | launch-required; unresolved financial ownership blocks |
| TopupHistory | `balance_ledger` only after approved policy; otherwise quarantine | owner/operator mapping | archive evidence; no synthetic ledger |
| Menu | `menu_versions`, `menu_items` | none | operational current/menu history |
| Settings | `calendar_settings` | none | operational calendar state |
| Likes | `likes` | exact user mapping | current operational state; unresolved rows quarantine |
| Announcements | `announcements` | none | useful operational/archive data |
| Other | `import_quarantine` with raw/normalized payload | source-specific | unresolved or unsupported; never silently dropped |

Orders retain item name, unit price, quantity, subtotal, pickup floor, order
date, status, and owner snapshots. Cancelled rows remain historical rows.
Inactive/departed employees remain in `users` with `active = 0` when the
source explicitly supports that state; they are not deleted. No generic
archive schema is added for this migration.

## Exact identity mapping

Identity resolution is deterministic and produces a status/evidence record for
every identity-bearing source row. The only automatic or explicit resolution
paths are:

```text
employee_id exact match
→ verified exact LINE-to-employee mapping
→ exact explicit source mapping
→ unresolved
```

Names, display labels, and raw LINE IDs are never transformed into an
`employee_id`. A LINE ID can resolve only through an already reviewed,
authoritative LINE-to-employee mapping. Fuzzy matching and name-only matching
are never implemented.

The local mapping file is an exact, human-reviewed input and is never
committed. Its minimal shape is:

```json
{
  "bySource": {
    "Users:2": "001234",
    "Orders:4": "001234"
  },
  "byLegacyLineUserId": {
    "legacy-line-id-from-reviewed-source": "001234"
  }
}
```

Every mapped employee ID is parsed as a string. A mapping conflict is a hard
block. Reports use `sheet:row` and a one-way digest of external IDs as safe
identifiers; raw input is retained only inside the ignored local artifact or
quarantine payload needed for review.

The report classifications are:

```text
AUTO_MATCHED_BY_EMPLOYEE_ID
AUTO_MATCHED_BY_LINE_ID
EXPLICIT_MAPPING_APPLIED
WAITING_FOR_FIRST_LINE_BIND
EXPLICIT_MAPPING_REQUIRED
AMBIGUOUS
ORPHAN
CONFLICT
CURRENT_ONLY
LEGACY_ONLY
```

`WAITING_FOR_FIRST_LINE_BIND` is normal when a canonical employee has no LINE
ID. `EXPLICIT_MAPPING_REQUIRED`, `AMBIGUOUS`, `ORPHAN`, and `CONFLICT` block
replacement when they affect users, orders, ledger, or roles.

## Import and reconciliation path

The importer exposes a default dry-run command using the local workbook and
an optional exact mapping file:

```powershell
npm.cmd run import:production:dry-run -- `
  --input "..\gas\便當系統設定.xlsx" `
  --identity-map ".local-imports\employee-identity-map.json" `
  --output ".local-imports\bento-formal-identity-review.json" `
  --sql-output ".local-imports\bento-formal-identity.sql" `
  --target bento-formal `
  --database-id e75bc185-afb5-4a5d-abc9-81bd79525cff `
  --config wrangler.jsonc
```

It writes no D1 rows. The future stage/replacement planner consumes the same
validated model. A non-ready validation does not produce an executable SQL
replacement file.

The machine-readable report contains:

```text
source fingerprint and importer version
source sheet headers, row counts, and date ranges
employee ID type, total, unique, duplicate, missing, leading-zero risk
identity status counts and safe record identifiers
Users insert/update/skip/fail and LINE-binding readiness
Orders source/resolved/unresolved/duplicate/invalid rows and amount totals
Ledger source/resolved/unresolved/duplicate/invalid rows and amount totals
Menu / Calendar / Announcements / quarantine counts
per-user legacy balance, ledger-derived balance, planned balance, difference
aggregate financial totals and unexplained offsets
PASS or FAIL readiness gate with explicit blockers
```

Financial rules:

* Preserve the source Users balance as an operational snapshot only when its
  owner is resolved.
* Do not accept TopupHistory as formal ledger events without an explicit
  opening-balance/event policy.
* Do not fabricate adjustment or balancing rows.
* A non-zero balance without trusted ledger/opening evidence is
  `OPENING_BALANCE_POLICY_REQUIRED` and fails readiness.
* An identity conflict that could merge balances, ledger, orders, or roles is
  `CONFLICT` and fails readiness.

Idempotency rules:

* `user_id` is deterministic from the canonical employee ID for imported
  users.
* Source batch identity is deterministic from source SHA-256 and importer
  version.
* Source entity IDs and order line numbers are preserved as stable keys.
* A repeated local stage or planned import uses `INSERT OR IGNORE`/unique
  constraints and produces no duplicate users, orders, order items, or
  ledger entries.
* A replacement dry-run records source fingerprint and expected counts; a
  future remote replacement refuses an already-applied fingerprint.
* Crash/partial rerun behavior is covered by local disposable D1 tests; the
  current remote command remains gated and unexecuted.

## Remote readiness checkpoint

The readiness artifact prepares, but does not execute, this sequence:

```text
1. Remote backup/export of the exact bento-formal D1.
2. Read-only remote schema/count/identity preflight.
3. Reviewed exact replacement command with --confirm-production-replace.
4. Read-only post-import reconciliation and financial checks.
5. Recovery procedure using the backup and a separately approved restore plan.
```

The exact target remains `bento-formal` with database ID
`e75bc185-afb5-4a5d-abc9-81bd79525cff`. No command in this sequence runs as
part of the current task. For the current workbook, the missing employee ID
mapping makes the final status:

```text
REMOTE IMPORT READINESS: BLOCKED
REMOTE IMPORT: NOT EXECUTED
```

## Frontend UX boundary

The existing React app remains GAS-bound by default. This task prepares the
Worker contract and UX copy without routing the production React app to the
new guest flow. A future Worker transport slice can present:

```text
歡迎使用
[ LINE 登入 ]
或
員工編號 [________]
[ 使用員編進入 ]
```

Guest sessions display `訪客模式` or `員編登入` and offer `綁定 LINE`.
When a bound employee enters an employee ID, the UI displays
`此員工編號已完成 LINE 綁定，請使用 LINE 登入。` without identifying the
bound LINE account. Binding uses the current guest context; the user is not
asked to enter a second employee ID. The UI uses server-returned
`authMode`/capabilities and never treats a stored Admin role as sufficient
for guest privileges.

## Testing strategy

Add focused Worker tests for:

* employee ID text parsing, leading-zero preservation, numeric rejection,
  duplicate/missing IDs, and exact mapping conflicts;
* valid guest login, unknown/inactive/bound rejection, opaque session lookup,
  token expiry, stale session rejection, and employee spoof prevention;
* guest self order/cancel/balance/history access and server-side denial of
  calendar administration, top-up, member balances, roles, View As, and
  Admin/ProxyAdmin capabilities;
* first bind, same bind idempotency, employee/LINE conflicts, concurrency,
  same canonical `user_id`, session revocation, and post-bind guest rejection;
* formal schema rekey, foreign keys, snapshots, negative balances, and
  migration preservation from the old line-keyed schema;
* importer inventory, mapping statuses, orphan/quarantine behavior,
  deterministic IDs, dry-run no-write behavior, partial rerun, duplicate
  source, order/ledger collisions, and financial reconciliation;
* relevant existing auth, orders, cancel, balance, ledger, admin,
  ProxyAdmin, calendar, and migration regression tests.

Automated verification follows the repository-declared order. Root required
commands are `node --test tests/strict-identity-ledger.test.cjs`,
`npm.cmd run lint`, and `npm.cmd run build`; the Worker package's declared
formal test command is run as an additional scope-appropriate check. Real
LIFF authentication, View As in a real browser, GAS deployment/production
contract, and remote D1 contents remain manual or external evidence and are
not claimed from local tests.

## Non-goals

This design does not modify any `.gs` file, rewrite Google Sheets, remove GAS,
deploy a Worker, change CORS, execute remote migrations/imports, write remote
D1, commit, push, create a generic IAM/authentication framework, create a
generic ETL platform, use fuzzy/name matching, or add unexplained financial
offsets. Guest UI polish and production React cutover remain separate from
the import correctness gate.
