# Formal Worker + D1 Backend Design Specification

**Date:** 2026-09-08
**Status:** Architecture approved; Wave 0–6 local implementation baseline; Option 1 migration policy approved; real-workbook validation complete; not deployed
**Decision:** Strategy B — rebuild the formal backend on a clean D1 schema

## 1. Decision summary

The next engineering phase is a formal Cloudflare Worker + D1 backend rebuild. The
existing Worker POC is a parity and feasibility artifact, not the formal schema to
be evolved indefinitely. Strategy B is approved because the POC currently models
money as floating point, stores order lines without a transaction-safe parent
model, overlays status rather than recording an auditable state history, and does
not provide the final ledger, idempotency, or identity boundaries required by the
application.

The formal backend will be built from a clean schema and a deterministic,
local-only importer. The React application remains on GAS while the backend gates
are incomplete. After every backend gate passes, React will switch directly to the
Worker API. There will be no long-lived dual-backend adapter and no
VITE_BACKEND_MODE.

This execution phase updates the approved specification/plan and formal
Worker modules/tests only. It does not activate React cutover, execute a
database reset, deploy, push, or modify the real workbook. The resulting
repository checkpoint may be committed only after its authorized final review.

## 2. Normative constraints

The following requirements are binding for implementation:

1. GAS source and the workbook are legacy behavioral and data-shape references.
   They are not the formal runtime source of truth after cutover.
2. The formal source of truth is D1 plus the Worker domain rules. Google Sheets
   synchronization is not part of the target architecture.
3. The current POC database is not patched into the formal model. A clean formal
   migration chain and clean D1 state are required at the implementation gate.
4. The real workbook is a local-only importer input. It must remain ignored and
   must never be committed, embedded in fixtures, or included in generated
   reports committed to the repository.
5. Backend authentication derives the canonical identity from a validated LINE
   access token. Client-supplied user IDs, roles, names, balances, and effective
   identities are not trusted.
6. Authenticated identity, View As identity, and effective read subject remain
   separate concepts. Authorization is evaluated against the authenticated actor.
7. Duplicate legacy menu rows are preserved as separate formal menu items. Each
   receives a stable internal menu key. legacy item_id is retained as a
   non-unique source attribute and is never a primary or unique key.
8. Orders whose LINE user cannot be resolved are placed in importer quarantine.
   They are not dropped and the importer must not invent or infer a user.
9. An incomplete legacy ledger is not reconstructed into false historical
   transactions. The approved migration policy imports `Users.balance` as the
   signed operational opening snapshot, including zero and negative values,
   without creating historical `TOPUP`, `ORDER`, `REFUND`, or `ADJUSTMENT` rows.
   Incomplete or unverifiable `TopupHistory` rows remain quarantined evidence.
   A future cutover adjustment is separately gated and is not authorized by
   this migration policy.
10. Cancellation is a state transition and audit event, not deletion.
11. Money is stored as INTEGER application currency units. Dates are
   YYYY-MM-DD in the application timezone, Asia/Taipei. Timestamps are UTC.
12. New order and balance mutations are transaction-safe and idempotent while
    preserving the existing GAS behavior that an order may drive balance
    negative. Integer money and ledger conservation remain mandatory; an
    insufficient-balance rejection is a separate future product change.
13. React changes are deferred until every backend gate is PASS. The cutover is
   direct React -> Worker -> D1.
14. This phase must not run GAS live benchmark work, a dual-backend migration,
   production deployment, repository push, or remote D1 destructive reset.

## 3. Source evidence and boundaries

The inventory was built by tracing the source rather than only listing function
names:

| Source | Role in the design |
|---|---|
| gas/Code.gs | Legacy HTTP action routing and response entry points |
| gas/Auth.gs | LINE profile lookup, registration, token-derived identity |
| gas/Users.gs | User fields, balances, floor validation, role values |
| gas/Permissions.gs | User, ProxyAdmin, and Admin capability matrix |
| gas/Bootstrap.gs and gas/DeferredBootstrap.gs | Initial and deferred UI data flows |
| gas/Calendar.gs and gas/Announcements.gs | Calendar, deadlines, likes, announcements |
| gas/Orders.gs | Order validation, replacement, cancellation, balance effects |
| gas/Balances.gs | Legacy balance snapshot and TopupHistory behavior |
| gas/Admin.gs | Administrative summary, balances, proxy assignment |
| gas/Utils.gs | Shared date, spreadsheet, parsing, and response helpers used by legacy flows |
| gas/appsscript.json | GAS runtime/deployment configuration; preserved as legacy deployment evidence |
| src/App.jsx | Actual React action callers and View As behavior |
| src/api/gasApi.js | GAS transport, LIFF access-token forwarding, mock seam |
| gas/便當系統設定.xlsx | Local-only legacy workbook shape and import evidence |
| worker-poc/ | Existing POC schema, contract, parity, and verification artifacts |

The workbook was inspected read-only. Its observed counts and shape are used to
design validation, not to publish data values. The workbook contains
real or real-like identities and transactions and is therefore sensitive
local input.

## 4. Legacy API inventory and data flow

### 4.1 HTTP action inventory

The following table is the migration contract. The legacy action names are
reference labels; the formal Worker exposes resource routes described in section
8.

| Legacy action | Legacy transport | Auth and actor rule | Data flow | Classification and formal target |
|---|---|---|---|---|
| getUserInfo | POST | GAS derives LINE user from access token | LINE profile -> Users lookup -> public user or unregistered response | AUTH/READ -> GET /api/me |
| registerUser | POST | GAS derives LINE user; ignores client identity | Validate floor -> lock -> create User -> canonical readback | AUTH/WRITE -> POST /api/register |
| getBootstrapData | POST | Token-authenticated registered user | User + settings + order map + calendar; optional deferred UI data | AUTH/READ -> GET /api/bootstrap |
| getDeferredBootstrapData | POST | Token-authenticated registered user | Likes and active announcements after core bootstrap | AUTH/READ -> GET /api/bootstrap/deferred |
| getCalendarEvents | GET | Legacy route accepts userId query but calendar data is server-derived | Settings and likes -> dated calendar events | READ/LEGACY -> GET /api/calendar |
| getInitData | GET/legacy internal | Used for target date and vendor menu | Calendar setting + latest menu date <= target | READ/LEGACY -> /api/order-page data |
| getOrderPageData | GET | Legacy userId is not authoritative | Init data + user's active order for target date | READ -> GET /api/order-page |
| getUserOrder | GET/legacy internal | User must be canonical | Active order lines for exact date and user | READ/LEGACY -> order-page projection |
| getUserAllOrdersMap | GET | Legacy userId is overwritten by token-derived user | Active orders grouped by date | READ -> GET /api/orders/map |
| submitOrder | POST | Token-authenticated registered user | Deadline + menu + floor + items -> lock -> replace active order -> balance effects -> append lines | TRANSACTION/WRITE -> POST /api/orders |
| cancelOrder | POST | Token-authenticated canonical user | Deadline + active order ownership -> lock -> mark cancelled -> refund | TRANSACTION/WRITE -> POST /api/orders/:orderId/cancel |
| updateMyPickupFloor | POST | Token-authenticated canonical user | Validate allowed floor -> locked user update | WRITE -> PATCH /api/me/pickup-floor |
| toggleLike | POST | Token-authenticated registered user | Upsert/delete date/user like -> vendor side effect under lock | WRITE -> POST /api/calendar/:date/like |
| getBalanceHistory | POST/legacy internal | Canonical user | Legacy ledger rows and user balance | READ/LEGACY -> balance history repository |
| getBalanceHistoryByMonth | POST | Token-authenticated canonical user | Monthly balance history reconstruction | READ -> GET /api/me/balance/history |
| getAdminSummary | POST/GET | Admin or ProxyAdmin according to permission matrix | Active orders -> date/vendor/floor/item aggregation | ADMIN/READ -> GET /api/admin/summary |
| getMemberBalances | POST | Admin only | Users and balances | ADMIN/READ -> GET /api/admin/members/balances |
| topUpBalance | POST | Admin only; operator from token | Lock user -> update snapshot -> append TOPUP row | ADMIN/TRANSACTION -> POST /api/admin/balances/top-up |
| adminSetVendor | POST | Admin only | Upsert Settings date/vendor/mode | ADMIN/WRITE -> PUT /api/admin/calendar/:date |
| assignProxy | POST | Admin only | Update target role; formal API validates allowed role values | ADMIN/WRITE -> PUT /api/admin/users/:userId/role |
| getOrders | GET | Admin/ProxyAdmin legacy listing | All active/admin order projection | ADMIN/LEGACY -> admin summary/order projection |
| Invalid Action and diagnostic routes | GET/POST | No formal contract | Legacy error or POC diagnostics | REMOVE at cutover |

### 4.1a File-level inventory coverage and negative findings

The file-level inventory covers every GAS source file currently present:
Code.gs, Auth.gs, Users.gs, Permissions.gs, Bootstrap.gs,
DeferredBootstrap.gs, Calendar.gs, Announcements.gs, Orders.gs, Balances.gs,
Admin.gs, Utils.gs, and appsscript.json. Utils.gs is shared legacy support
logic rather than a public API; appsscript.json is deployment configuration.
Neither is a formal Worker runtime dependency.

No MenuOverrides sheet, GAS function, or React action was found in the inspected
source. The formal menu model therefore uses menu_versions and menu_items,
retains disabled rows for audit, and does not invent a separate override table.
If later source evidence introduces an override concept, it must be added as a
new reviewed contract rather than inferred during import.

### 4.2 Actual frontend callers

The current React caller set in src/App.jsx is:

getDeferredBootstrapData, getAdminSummary, getMemberBalances, getUserInfo,
getBootstrapData, registerUser, GET getCalendarEvents, GET
getUserAllOrdersMap, getBalanceHistoryByMonth, toggleLike, GET
getOrderPageData, adminSetVendor, submitOrder, cancelOrder,
updateMyPickupFloor, and topUpBalance.

src/api/gasApi.js forwards the LIFF access token to VITE_GAS_API_URL and has a
mock API branch. The formal cutover must preserve observable response fields
where that avoids unnecessary UI churn, but the Worker route and error model
become canonical. No caller or environment variable is changed in this phase.

### 4.3 Important traced flows

Bootstrap:

1. LIFF supplies an access token to the React API client.
2. GAS calls LINE profile and derives the canonical LINE user ID.
3. GAS reads registered user, settings, order map, and calendar.
4. Deferred data separately reads likes and active announcements.
5. React derives presentation state, including View As, from authenticated
   user and returned data.

Order replacement:

1. React sends selected items and a target date.
2. GAS authenticates the token, not the submitted userId.
3. GAS validates registration, floor, deadline, and server-side menu prices.
4. Under a script lock, active prior lines are cancelled/refunded and the new
   order is deducted and appended.
5. The formal Worker turns this into one D1 transaction with an idempotency
   record, parent order, line snapshots, ledger rows, and status history.

Admin/View As:

1. The authenticated actor is the token-derived account.
2. The UI may select a View As subject for permitted read presentation.
3. The server authorizes the actor's role and records actor/target separately.
4. A client-supplied userId never changes the authenticated actor.
5. Mutations target the authenticated actor unless the route is an explicit
   admin operation with a separately authorized target.

## 5. Legacy workbook schema inventory

The following is the observed workbook shape. Counts are inventory observations
from the local workbook and are not a promise that production data remains the
same.

| Sheet | Logical range and observed rows | Columns | Formal target | Shape and validation notes |
|---|---:|---|---|---|
| Settings | A1:C14; 13 data rows | order_date, vendor, mode | calendar_settings | order_date is the natural key; vendor may be blank; mode is A/B after normalization |
| Likes | A1:C6; 5 data rows | Date, LINE_UserID, Created_At | likes | composite date + LINE user key; unknown users are import issues |
| TopupHistory | A1:L3; 2 data rows | Timestamp, LINE_UserID, 姓名, 樓層, 異動金額, 結餘, 備註, TransactionID, Type, ReferenceID, OperatorUserID, OperatorName | import_quarantine/evidence; balance_ledger only after a separate later policy | source contains snapshots and ledger-like rows; completeness is not assumed |
| Users | A1:E4; 3 data rows | UserID (LINE ID), DisplayName, 樓層, Balance, Role | users plus balance import evidence | role values observed are Admin, ProxyAdmin, and User; balance must not silently become fabricated history |
| Menu | A1:H29; 28 data rows | date, vendor, item_id, item_name, price, enabled, note, image URL column with blank header | menu_versions and menu_items | duplicate (date, vendor, item_id) group exists; all observed enabled values are true; legacy item_id is non-unique |
| Announcements | A1:F3; 2 data rows | id, title, content, start_date, end_date, enabled | announcements | active window is inclusive and evaluated in Asia/Taipei |
| Orders | A1:P26; 25 line rows | order_id, order_date, vendor, name, pickup_floor, item_id, item_name, quantity, unit_price, subtotal, created_at, updated_at, blank status column, LINE_UserID, BalanceAfter, blank note column | orders, order_items, order_status_history, and quarantine | 20 distinct order IDs; 15 cancelled and 10 active lines; 3 line rows have null LINE user IDs; repeated order_id is expected for line items |

No workbook cell is edited by the importer. The source path is passed locally at
runtime, and output reports containing raw rows stay in an ignored local output
directory.

## 6. Formal domain model

### 6.1 Identity model

The Worker request context has three explicit fields:

- authenticated actor: the LINE user ID established from the validated access
  token;
- effective read subject: the subject whose permitted read view is requested,
  normally the actor and optionally a View As target;
- authorization actor: always the authenticated actor for permission checks and
  audit attribution.

The effective subject is not a replacement for the actor. View As is a read
presentation feature and cannot be used to submit an order, cancel another
user's order, change a balance, or change a role. Explicit admin routes such as
top-up and role assignment carry their own target and authorization checks.

LINE access-token handling follows the official LINE Login profile contract: the
Worker calls the profile endpoint with a Bearer token, and uses the returned
userId/displayName only after a successful response. See the
[LINE Login v2.1 API reference](https://developers.line.biz/en/reference/line-login/).

### 6.2 Date, time, and money

- Business dates are stored as text in YYYY-MM-DD format.
- Deadline evaluation uses Asia/Taipei wall-clock rules.
- Stored event timestamps are UTC ISO-8601 text.
- Money is INTEGER in TWD application units. No REAL balance or price columns
  are allowed.
- The current GAS deadline behavior is preserved: mode A is 10:00 on the
  order date; mode B is 18:00 on the previous Asia/Taipei date.
- Every mutation receives one server timestamp and uses it consistently for
  all rows in that mutation.

### 6.3 Tables, keys, and invariants

#### users

- Primary key: line_user_id TEXT.
- Fields: display_name, pickup_floor, balance INTEGER, role, created_at,
  updated_at.
- role is constrained to User, ProxyAdmin, or Admin.
- balance is an operational snapshot maintained together with ledger writes.
- A user row may not be created from an orphan order.

#### calendar_settings

- Primary key: order_date.
- Fields: vendor, mode, updated_by_line_user_id, created_at, updated_at.
- mode is constrained to A or B.
- Missing legacy mode is normalized using the existing vendor inference during
  import and recorded as a warning; future writes store explicit mode.

#### likes

- Composite primary key: order_date, line_user_id.
- Foreign key: line_user_id -> users.
- Field: created_at.
- Duplicate likes are impossible; toggle is an idempotent upsert/delete.

#### menu_versions

- Primary key: menu_version_id, generated by the formal system.
- Unique key: vendor, effective_date.
- Fields: vendor, effective_date, source_batch_id, created_at.
- Customer menu selection uses the latest effective date not after the target
  date for that vendor.

#### menu_items

- Primary key: menu_item_id, a stable internal key generated per source row.
- Foreign key: menu_version_id -> menu_versions.
- Fields: legacy_item_id, item_name, price INTEGER, enabled, note, image_url,
  source_order, created_at, updated_at.
- legacy_item_id is indexed for lookup but is explicitly not unique.
- Two legacy rows with the same date, vendor, and item_id remain two distinct
  menu_items with different internal keys.
- Customer reads normally filter enabled items; disabled rows remain available
  to admin/import audit views. This is a formal contract to be covered by tests.

#### announcements

- Primary key: announcement_id.
- Fields: title, content, start_date, end_date, enabled, source_order,
  created_at, updated_at.
- Customer active selection requires enabled plus an inclusive date window in
  Asia/Taipei. Ordering is start_date descending, then source_order descending.

#### orders

- Primary key: order_id.
- Foreign key: line_user_id -> users.
- Fields: line_user_id, order_date, vendor, pickup_floor, note,
  total_amount INTEGER, status, idempotency reference, created_at, updated_at.
- status is ACTIVE or CANCELLED.
- New operational orders require a resolved registered line_user_id.
- An order is never deleted to implement cancellation.

#### order_items

- Composite primary key: order_id, line_no.
- Foreign key: order_id -> orders.
- Optional foreign key: menu_item_id -> menu_items when the source item can be
  resolved; the snapshot fields remain authoritative for historical display.
- Fields: legacy_item_id, item_name_snapshot, quantity INTEGER, unit_price
  INTEGER, subtotal INTEGER.
- Formal writes accept positive integer quantities. Zero quantities are omitted
  as GAS does; negative, fractional, or non-numeric quantities are rejected or
  quarantined.

#### order_status_history

- Primary key: transition_id.
- Foreign key: order_id -> orders.
- Fields: from_status, to_status, actor_line_user_id, reason, metadata_json,
  occurred_at.
- Every create and cancellation has an auditable transition record.

#### balance_ledger

- Primary key: transaction_id.
- Foreign key: line_user_id -> users.
- Optional foreign key: operator_line_user_id -> users.
- Fields: amount INTEGER, balance_after INTEGER, type, reference_id, note,
  occurred_at, source_batch_id.
- type is TOPUP, ORDER, REFUND, or ADJUSTMENT.
- Ledger rows are append-only. The user balance snapshot and ledger row are
  changed in one transaction.
- Historical legacy balances are not emitted as synthetic TOPUP, ORDER, REFUND,
  or ADJUSTMENT rows under the approved Option 1 snapshot-only policy. A future
  cutover adjustment or verified-history promotion requires a separate policy.

The formal migration chain also includes `balance_ledger_sequence`, a small
append sequence keyed by transaction_id. `occurred_at` remains the business
event timestamp and is not a commit-order key; an AFTER INSERT trigger assigns
the sequence inside the same D1 batch and it is used for balance-chain
ordering. Replacement mutations insert the REFUND row before the replacement
ORDER row, so the trigger preserves that sequence.

The chain includes `opening_balance_snapshots` for imported Users.balance
values. It records the signed snapshot, source batch, and policy status
separately from post-cutover ledger rows. A REQUIRED status remains a policy
boundary after later TOPUP, ORDER, or REFUND mutations; it is not cleared by
matching users.balance to the latest ledger balance.

#### idempotency_keys

- Composite unique key: actor_line_user_id, operation, idempotency_key.
- Fields: request_hash, status, response_json, created_at, completed_at.
- Reusing a key with a different request hash is an error.
- A retried completed mutation returns the stored result without a second
  balance or order mutation.

#### admin_audit_log

- Primary key: audit_id.
- Fields: actor_line_user_id, target_line_user_id, action, metadata_json,
  occurred_at.
- View As reads and all admin mutations include actor/target attribution.

#### import_batches and import_quarantine

- import_batches records a local import run, source file hash, importer
  version, status, and timestamps.
- import_quarantine records entity type, source sheet/row, reason code,
  raw_payload_json, normalized_payload_json, and review state.
- Raw quarantine payloads are local-only artifacts and are not committed.
- Orphan orders use reason ORPHAN_ORDER_USER and remain out of orders until a
  human-approved mapping exists.
- Incomplete ledger evidence uses reason INCOMPLETE_LEDGER_POLICY and does not
  create fake history.

### 6.4 Transaction boundaries

The formal Worker uses prepared D1 statements and one transaction boundary for
each mutation:

- submit order: idempotency check -> read canonical user/menu/deadline ->
  cancel/refund prior active order if replacement -> read current integer
  balance -> apply the exact debit, including a possible negative result ->
  insert order/items/status/ledger -> complete idempotency;
- cancel order: idempotency check -> verify actor/order/deadline/status ->
  refund -> mark cancelled -> append status and ledger -> complete idempotency;
- top-up: authorization -> lock-equivalent serialized transaction -> update
  balance -> append ledger with its trigger-assigned sequence and audit;
- registration, floor update, role update, vendor setting, and like toggle use
  their own atomic mutation boundaries.

Cloudflare D1 documents that prepared statements can be batched and that a
batch is executed as a transaction sequence with rollback when a statement
fails. The implementation must use that behavior rather than relying on
application-level read-then-blind-write assumptions as concurrency protection.
Competing mutations must use D1 transaction boundaries, conditional state
checks, uniqueness constraints, and idempotency so that no lost update,
duplicate refund, or inconsistent ledger/order state can commit. See the
[D1 database API reference](https://developers.cloudflare.com/d1/worker-api/d1-database/).

## 7. Authorization matrix

| Capability | User | ProxyAdmin | Admin | Actor/target rule |
|---|---:|---:|---:|---|
| Read own profile, calendar, menu, own orders, own balance history | Yes | Yes | Yes | Actor is canonical token identity |
| Register self and update own pickup floor | Yes | Yes | Yes | Target must equal actor |
| Submit or cancel own order | Yes | Yes | Yes | Target must equal actor; View As cannot redirect |
| Toggle own calendar like | Yes | Yes | Yes | Target must equal actor |
| Read active order summary and all-order statistics | No | Yes | Yes | Actor role checked; target filters are read-only |
| Read member balances and member ledger views | No | No | Yes | Actor role checked; target rows are explicit |
| Top up a member | No | No | Yes | Actor is operator; target is explicit and audited |
| Set calendar vendor/mode | No | No | Yes | Actor is operator; setting date is explicit |
| Assign User/ProxyAdmin/Admin role | No | No | Yes | Allowed role values only; actor and target audited |
| View As another user | No | No | Yes | Read-only subject; actor remains authorization identity |

This matrix is enforced in Worker code, not inferred from a client-provided
role field.

## 8. Formal Worker API contract

All non-health routes require:

~~~text
Authorization: Bearer <LINE access token>
~~~

The formal routes are:

| Method and route | Legacy source | Contract purpose |
|---|---|---|
| GET /api/me | getUserInfo | Return canonical registration state and public user, or token-derived identity for an unregistered actor |
| POST /api/register | registerUser | Register token-derived user with validated floor |
| GET /api/bootstrap?targetDate=YYYY-MM-DD | getBootstrapData | Return core user, calendar, order map, and target context |
| GET /api/bootstrap/deferred?bootId=BOOT-... | getDeferredBootstrapData | Return likes and active announcements while echoing the caller boot ID |
| GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD | getCalendarEvents | Return dated events and active announcements |
| GET /api/orders/map | getUserAllOrdersMap | Return actor's active orders grouped by date |
| GET /api/order-page?targetDate=YYYY-MM-DD | getOrderPageData | Return deadline, selected menu, and actor's active order |
| POST /api/orders | submitOrder | Create or replace actor's order transactionally |
| POST /api/orders/:orderId/cancel | cancelOrder | Cancel and refund an actor-owned active order |
| POST /api/calendar/:orderDate/like | toggleLike | Toggle actor's like atomically |
| PATCH /api/me/pickup-floor | updateMyPickupFloor | Update actor's allowed pickup floor |
| GET /api/me/balance/history?month=YYYY-MM | getBalanceHistoryByMonth | Read ledger-backed month view |
| GET /api/admin/summary?date=YYYY-MM-DD | getAdminSummary | Read authorized active-order aggregation |
| GET /api/admin/members/balances | getMemberBalances | Admin-only member balance view |
| POST /api/admin/balances/top-up | topUpBalance | Admin-only audited top-up |
| PUT /api/admin/calendar/:orderDate | adminSetVendor | Admin-only vendor/mode setting |
| PUT /api/admin/users/:userId/role | assignProxy | Admin-only role assignment |

The JSON response should preserve the fields consumed by the current React
surface when practical. Errors use stable machine-readable codes such as
AUTH_REQUIRED, TOKEN_INVALID, NOT_REGISTERED, FORBIDDEN, INVALID_DATE,
DEADLINE_CLOSED, MENU_ITEM_INVALID, IDEMPOTENCY_CONFLICT, and
IMPORT_QUARANTINED. Internal stack traces, access
tokens, and database details are never returned.

The canonical formal startup flow is `GET /api/me` with a LINE Bearer token,
then registration with `POST /api/register` when `registered` is false, then
registered `GET /api/bootstrap`, followed by
`GET /api/bootstrap/deferred?bootId=<caller boot id>`. The `/api/me` unregistered
response is token-derived and does not create a D1 user row; the deferred
response must echo the valid caller boot ID.

## 9. Import and migration strategy

### 9.1 Strategy B execution shape

1. Keep the current POC source and its local-only state identifiable as POC
   reference material; no legacy POC remote migration, deploy, or seed path is
   permitted.
2. Build a formal migration chain containing only the schema in section 6.
3. Before any remote formal migration, obtain a separately authorized clean-D1
   operation. That operation is not part of this documentation phase.
4. Run the importer against an explicit local workbook path.
5. Validate all normalized records before writing any formal D1 rows.
6. Import master data and resolvable transactions only after the validation
   report is reviewed.
7. Keep quarantined rows and reconciliation reports local and reviewable.
8. Use one-time import, not a synchronization adapter or dual-backend mode.

### 9.2 Stable menu identity

For each Menu source row, the importer generates a deterministic internal key
from the source batch identity, sheet name, source row number, and normalized
source identity. The key is stable across repeated runs of the same source and
does not depend on legacy item_id uniqueness. The importer emits a duplicate
warning for repeated date/vendor/item_id groups but does not merge or discard
them.

### 9.3 Orphan order handling

An order line with a blank or unresolved LINE user ID is normalized enough to
retain its source evidence, then written to import quarantine with the source
sheet and row. It is never written to orders, never assigned to a guessed user,
and never discarded. A future human mapping workflow may resolve it explicitly;
that workflow is outside this phase.

### 9.4 Incomplete ledger handling and approved opening-balance policy

TopupHistory is not assumed to be a complete ledger. The importer compares
available ledger rows, Users.balance snapshots, order effects, and source
references, then reports gaps. Under the approved Option 1 policy, it imports
the exact signed Users.balance value as the current operational snapshot,
including zero and negative balances, but it does not invent opening
transactions or backfill missing history. It does not synthesize historical
TOPUP, ORDER, REFUND, or ADJUSTMENT rows.

Incomplete or unverifiable TopupHistory rows remain in import quarantine as
legacy evidence and are not promoted into the formal ledger. Where balance
history cannot be fully explained by formal ledger entries, the API exposes
the OPENING_BALANCE_POLICY_REQUIRED boundary. The formal ledger begins with
future approved mutations, all using the atomic balance + ledger + audit
boundary.

A future cutover ADJUSTMENT is explicitly deferred. If later approved, it must
be a separate reviewed policy identifying a policy ID/version, approver,
approval timestamp, effective timestamp/timezone, target user, signed amount,
reference/evidence, and rollback/compensation rules.

### 9.5 Reconciliation outputs

Each local run produces counts and issue classes without committing raw data:

- source row counts by sheet;
- normalized row counts by entity;
- accepted, warning, and quarantined counts;
- duplicate menu groups and generated internal keys;
- orphan order count;
- unresolved user and menu references;
- balance/ledger reconciliation gaps;
- deterministic source hash and importer version.

Reports contain counts, reason codes, references, and gap classes only; raw
workbook rows are not copied into committed artifacts.

## 10. Implementation waves and gates

| Wave | Scope | Required gate |
|---|---|---|
| 0 | This spec, plan, manifest preflight, and protected-change check | Design review approved; no runtime mutation |
| 1 | Formal schema, importer validation, quarantine skeleton, synthetic fixtures | Schema constraints and importer issue classification pass |
| 2 | LINE authentication, registration, identity context, read-only APIs | Auth/identity and read-only contract tests pass |
| 3 | Order creation/replacement/cancellation, deadlines, idempotency | Transaction, concurrency, and order invariants pass |
| 4 | Balance ledger, history, top-up, opening-balance hold | Ledger conservation and policy-boundary tests pass |
| 5 | Admin summary, roles, View As, calendar/vendor, announcements, likes | Permission and audit tests pass |
| 6 | Local workbook import, reconciliation, quarantine review artifacts | Import report reviewed; no orphan or policy issue silently accepted |
| 7 | Full backend verification and authorized non-destructive external checks | All backend gates PASS, including required manual evidence |
| 8 | Direct React -> Worker cutover | React smoke/E2E and backend gates PASS; no dual mode |

React remains on GAS through Waves 1–7. GAS source is not deleted in this
round. Removal is assessed only after direct cutover evidence and a separate
cleanup decision.

## 11. Risks and explicit policy boundaries

| Risk or ambiguity | Formal treatment |
|---|---|
| Duplicate menu item_id | Stable internal menu_item_id; legacy item_id indexed but non-unique |
| Null/unknown order user | Import quarantine; no discard and no guessed user |
| Incomplete ledger | Approved Option 1 preserves the signed Users.balance snapshot and quarantines unverifiable history; no fabricated rows or opening adjustment |
| Legacy GAS permits negative balances | Formal order path preserves negative-balance behavior; no insufficient-balance business rule is introduced, while integer money, atomic mutations, and ledger conservation remain required |
| Legacy getInitData does not filter Menu.enabled | Formal customer menu filters enabled rows; disabled rows remain auditable and admin-visible |
| Legacy quantity handling | Formal writes accept positive integers; zeros are omitted; invalid values are quarantined |
| Vendor/mode inference | Import records inferred mode as a warning; future writes require explicit A/B |
| View As write confusion | Effective subject is read-only; authorization and mutation actor remain token-derived |
| Real workbook exposure | Root gas/*.xlsx ignore rule and ignored local output directory; no fixture contains real rows |
| POC schema drift | Formal migration chain is clean and separately tested; POC migrations are not the formal source |
| Remote destructive operation | Not permitted in this phase; requires a later explicit operation checkpoint |

## 12. Estimated implementation file scope

The implementation plan is expected to add or modify:

- worker-poc/migrations-formal/0000_formal_initial_schema.sql;
- worker-poc/wrangler.jsonc and worker-poc/package.json only at the formal
  execution checkpoint;
- worker-poc/src/auth/, worker-poc/src/db/, worker-poc/src/domain/,
  worker-poc/src/http/, and route modules;
- worker-poc/scripts/import-legacy-workbook.mjs and its local helper modules;
- worker-poc/tests/ for schema, importer, identity, permission, route,
  transaction, ledger, and admin coverage;
- worker-poc/.gitignore for local importer outputs;
- src/api/workerApi.js, src/api/gasApi.js, and src/App.jsx only in Wave 8;
- documentation for environment variables and cutover evidence.

The exact implementation task order and verification commands are in the
companion implementation plan. No file in this scope is changed by this
specification itself.

## 13. Verification and release evidence

Automated verification must distinguish the repository-declared commands from
Worker-specific tests:

1. node --test tests/strict-identity-ledger.test.cjs
2. npm run lint
3. npm run build
4. Worker test command from worker-poc/package.json after the formal test suite
   exists.
5. Local migration and importer tests against synthetic fixtures.

Manual or external evidence is required for real LIFF authentication, View As
and identity behavior, GAS deployment contract, and any authorized D1 remote
operation. Local static checks must not be reported as evidence for those
behaviors.

This document is a design artifact plus implementation contract. Local Wave 0–3
automated evidence is reported by the implementation session; this document does
not claim remote deployment, remote migration, or real-user flows are verified.

Current external/manual evidence status (2026-09-08):

| Evidence | Status | Boundary |
|---|---|---|
| Real LIFF authentication | NOT VERIFIED | No real LIFF session or live LINE token was exercised. |
| Cloudflare-backed non-production D1 | NOT VERIFIED | Local Wrangler D1 was verified; Cloudflare-backed credentials were unavailable. |
| View As and actor/effective-subject separation | NOT VERIFIED | Automated contract tests pass; no production/manual View As session was exercised. |
| Production GAS contract | NOT VERIFIED | React remains GAS-bound; no production GAS deployment/contract exercise was performed in this slice. |
| Production Worker deployment | NOT RUN | No Cloudflare deployment was performed. |
| React cutover | NOT RUN | React transport remains unchanged and GAS-bound. |
