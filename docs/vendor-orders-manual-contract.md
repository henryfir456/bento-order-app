# Issue #36: internal MANUAL order handoff contract

Status: Draft-only implementation. This feature and migration 0015 have not
been applied to production. See [P0 decision](vendor-orders-p0.md) for public
evidence and the authorization gate for any future official API adapter.

## Authorization and immutable evidence

`/api/vendor-orders/*` uses formal Worker identity. Only verified, active,
LINE-authenticated Admins and explicitly granted ProxyAdmins may use it.
Proxy grants are branch-specific, expiring and revocable. Users, employee
guest sessions, unregistered identities and View As are denied, including
reads. Only Admin may configure branches, mappings and grants. Current
identity/grants are checked again inside each D1 mutation transaction.

Branches reference existing vendor IDs. An administrator must explicitly
confirm branch availability, supported address/floors, service dates,
weekdays/holidays, minimum/fee rules and organizer settlement responsibility.
All deadlines use Asia/Taipei: mode A closes the same day (default 10:00);
mode B closes the previous day (default 18:00). The external cutoff defaults
to 10:30. The SQL clock is authoritative at final reservation. Configuration
does not establish actual merchant availability or create API authorization.

Mapping requires stable menu item ID, canonical BASE/HALF/PLUS variant and
service date, with confirmed external SKU/options/price/availability. Legacy
identity decoding cannot infer from names or prices. Explicit canonical
variants are preserved only through an opt-in menu projection; existing
menu consumers retain their previous behavior. Missing/ambiguous identities,
missing mappings, unavailable items, price/total conflicts and policy
warnings block review/handoff. Internal charged amounts are never rewritten.

Source notes are visible only within protected review responses. Each
nonempty note requires explicit acknowledgement bound to its note hash and
a separately written supplier-safe note (which may be empty after review).
Raw notes and employee identity are excluded from the manual handoff sheet
and audit metadata. Approved supplier notes participate in aggregation.

## Workflow and endpoints

All write responses use the established `{ success, ... }` Worker envelope.

| Endpoint under `/api/vendor-orders` | Purpose |
| --- | --- |
| GET `/access` | Authorized branches, configuration capability, MANUAL-only adapter |
| GET/PUT `/branches/:id` | Read/configure branch (PUT requires expected revision) |
| PUT `/branches/:id/mappings` | Date/item/variant mapping, expected mapping revision |
| PUT `/branches/:id/grants` | Admin grants/revokes verified ProxyAdmin branch access |
| GET `/batches?branchId=...` | Recent batches for recovery after reload |
| POST `/batches` | Prepare/refresh draft from current source and note reviews |
| GET `/batches/:id` | Frozen/current snapshots, drift, manual report and protected audit |
| POST `/batches/:id/review` | Review exact snapshot hash; DRAFT -> READY |
| POST `/batches/:id/handoff` | Explicit confirmation, MANUAL and Idempotency-Key reservation |
| GET `/batches/:id/sheet` | Read-only recovery of previously reserved manual sheet |
| POST `/batches/:id/report` | Revision-bound manual reconciliation; never submits externally |

Preparation/review/handoff fingerprint the full source membership, canonical
ownership, notes, menu semantics, mappings, policy and permanent reservations.
The fingerprint is checked in the first statement of the same D1 batch as
all writes; a failing guard rolls back attempts, claims, state and audit.

Final confirmation reserves one attempt globally per batch/snapshot and one
idempotency key globally. Permanent source-line and owner/date/canonical
vendor claims, plus handed-off floor scopes, survive UNKNOWN, timeout,
cancellation, rejection and failure. New order IDs or changed pickup floor
cannot silently replace a handed-off employee meal. No API clears claims or
automatically retries external submission. A lost response is reconciled by
GET detail/sheet. Concurrent actors cannot obtain two successful claims.

The sheet contains floor/item quantities, external price/options, explicitly
approved supplier notes, delivery address and organizer totals/fees. It
does not contain employee names/IDs or raw notes. Only a canonical Cai
Teacher sheet offers the known official ordering entry; other vendors do
not inherit that link. Human interaction with that website is outside this
implementation and requires separate authorization/evidence.

States: DRAFT -> READY -> SUBMITTING; SUBMITTING -> SUBMITTED/UNKNOWN/FAILED;
SUBMITTED -> ACCEPTED/REJECTED/CANCELLED/UNKNOWN; UNKNOWN permits explicit
reconciliation to SUBMITTED/ACCEPTED/REJECTED/CANCELLED/FAILED; FAILED permits
UNKNOWN/CANCELLED; ACCEPTED permits CANCELLED. REJECTED/CANCELLED are terminal.
SUBMITTED does not imply merchant acceptance. Every report is
`MANUAL_REPORTED`, `platformVerified: false`, with amount/payment status and
reference history recorded append-only. Manual UNKNOWN is not an invitation
to send again. Internal idempotency is not an external exactly-once promise.

The adapter interface is prepare/validate/submit/status/reconcile. MANUAL
submit reserves an internal sheet only. The official MaiFood API stub is
unconditionally OFF; an environment flag cannot enable it. No credentials,
third-party login/request, wallet/top-up/ledger writes or original order
mutations are introduced by this feature.

## Verification boundary

Automated core: 31 endpoint/concurrency/domain tests plus one additive
migration test PASS on disposable in-memory SQLite/D1 fixtures. Independent
defect-first review PASS with no remaining core blocker. Production D1,
real LINE, merchant availability/acceptance/payment and third-party API
authorization are NOT VERIFIED. No migration, merge or deployment was run.

Pre-change full-suite baseline: root 223 tests (218 pass, 2 fail, 3 skipped),
with cancel-flow source-regex failures; Worker 469 tests (462 pass, 7 fail),
with formal-cleanup sqlite_sequence inventory mismatch. Full-suite results
remain FAIL if these reproduce; focused passing tests do not erase that debt.

Core post-change full suites: root 223 (218 pass, 2 fail, 3 skipped); Worker
501 (494 pass, 7 fail). The failing locations and sqlite_sequence mismatch
match the captured pre-change baseline, and these cleanup/cancel source
contracts are unchanged: FAIL / PRE_EXISTING_FAILURE. The new migration
inventory expectation was updated and passes. Required identity suite:
90 (87 pass, 3 skipped), exit 0; lint/build exit 0. Typecheck NOT RUN because
no typecheck script is declared. Capability probe NOT RUN because the
repository does not include tools/get-toolchain-capabilities.ps1; read-only
Get-Command confirmed git, node and npm.cmd available.
