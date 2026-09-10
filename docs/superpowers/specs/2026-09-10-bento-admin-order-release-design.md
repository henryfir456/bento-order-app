# Bento Admin, Order Management, and Release Governance Design

Status: approved for specification review; implementation has not started.

Date: 2026-09-10

Repository: `C:\Users\SER\Desktop\AI\80_bento-order-app`

## 1. Scope and guardrails

This change covers four related product and governance concerns:

1. Admin-only announcement management in the active React/Worker/D1 stack.
2. Giving every role the existing ProxyAdmin order-management capability,
   without broadening any other Admin-only capability.
3. Removing the `💰 餘額` label from the header balance presentation while
   preserving balance data and authorization behavior.
4. Making `CHANGELOG.md` the canonical release history and requiring an
   explicit human approval gate before a numbered release is finalized.

The active implementation scope is React + Cloudflare Worker + D1 + tests.
Legacy GAS remains retired and is not changed, mapped, or used as a coverage
requirement. No deployment, remote D1 mutation, commit, push, or final release
version update is part of this work.

The existing untracked `dev-start.bat` and `dev-start.ps1` files in the main
worktree are user-owned and are preserved. Implementation and verification are
performed in the detached worktree
`C:\Users\SER\AppData\Local\Temp\bento-order-app-release-worktree`.

## 2. Existing architecture and constraints

The root `agent.yaml` uses schema version 2. Its required repository
verification is:

- `node --test tests/strict-identity-ledger.test.cjs`
- `npm run lint`
- `npm run build`

The `agent.yaml` manifest has a `project_skills` field, and its current value
is an empty list: `project_skills: []`. The missing evidence is an
authoritative non-empty entry schema and governance contract for project-local
third-party Skills. A release Skill will not be registered or added until that
contract is available. `agent.yaml` will therefore remain unchanged.

The formal Worker already owns active announcement reads through
`worker-poc/src/domain/announcements.js` and
`worker-poc/src/routes/readOnly.js`. The existing D1 formal migration already
contains the `announcements` table with these fields:

```text
announcement_id, title, content, start_date, end_date, enabled,
source_order, created_at, updated_at
```

The public calendar response remains date-window filtered. Admin management
must be able to list disabled and future/expired records without changing the
public read contract.

Authorization is centralized in
`worker-poc/src/auth/permissions.js` and the frontend capability map in
`src/auth/permissions.js`. Server authorization is authoritative; UI hiding is
only a presentation concern.

## 3. Announcement management design

### 3.1 Capabilities and authorization

Add one server capability, `ACTIONS.ADMIN_ANNOUNCEMENTS`, with an Admin-only
role grant. It must not be included in User or ProxyAdmin permissions.

Every announcement management route must call the existing identity resolver
and centralized authorization helper before reading or mutating data. The
frontend must use the authenticated actor's Admin capability for showing the
management entry and must not allow View As state to turn a hidden Admin-only
control into an effective mutation authority.

The required authorization matrix is:

| Operation | User | ProxyAdmin | Admin |
| --- | --- | --- | --- |
| List all announcements | denied | denied | allowed |
| Create | denied | denied | allowed |
| Edit | denied | denied | allowed |
| Enable/disable | denied | denied | allowed |
| Delete | denied | denied | allowed |
| Public active announcement read | existing behavior | existing behavior | existing behavior |

Unauthorized requests must use the repository's existing 401/403 response
conventions and must not expose data through an alternate route.

### 3.2 Worker API contract

Add the smallest formal Worker route surface needed by the UI:

```text
GET    /api/admin/announcements
POST   /api/admin/announcements
PATCH  /api/admin/announcements/:id
DELETE /api/admin/announcements/:id
```

All routes use the existing formal Worker response and error wrappers, so CORS
handling remains identical for success, authorization failure, validation
failure, not-found failure, and unexpected errors.

The admin list returns all records, including disabled, future, and expired
records. Its ordering rule is defined in section 3.3 from the existing
`source_order` evidence; it is not a new user-facing sorting feature. The
response shape is:

```json
{
  "announcements": [
    {
      "id": "announcement-id",
      "title": "Title",
      "content": "Body",
      "start_date": "2026-09-10",
      "end_date": "2026-09-10",
      "enabled": true
    }
  ]
}
```

Create accepts `title`, `content`, `start_date`, `end_date`, and optional
`enabled`; omitted `enabled` defaults to enabled. It returns the created
announcement with HTTP 201. The server generates the identifier using the
existing ID utility. The `source_order` field is server-controlled and is not
part of the request or response contract.

Patch accepts any non-empty subset of the same editable fields. It supports
the enable/disable action through `enabled: true` or `enabled: false`. It
returns the updated announcement. Delete requires the route identifier and
returns the repository's standard successful empty response after deleting.

Validation rules are deliberately limited to the current data model and
existing helpers:

- `title` and `content` must be non-empty strings after trimming.
- `start_date` and `end_date` must be date-only values in `YYYY-MM-DD` form.
- `end_date` must not precede `start_date`.
- `enabled`, when present, must be a boolean at the API boundary.
- Create requires all four content/date fields; patch requires at least one
  recognized field and validates the complete resulting date range.
- Empty JSON, malformed JSON, missing identifiers, unknown fields, invalid
  dates, and invalid booleans use the existing bad-request error pattern.
- Updates and deletes for an unknown identifier use the existing not-found
  pattern.

No new table, migration, sorting feature, drag-and-drop ordering, preview
mode, rich-text editor, or GAS implementation is introduced. `source_order`
remains an internal existing ordering value rather than a new UI capability.

### 3.3 Existing `source_order` semantics and ordering rule

The current repository evidence gives `source_order` a source/import meaning,
not a user-facing announcement rank:

- The formal migration defines it as `INTEGER NOT NULL DEFAULT 0`.
- The formal importer writes `row.source.row`, which is the source workbook
  row number, into `announcements.source_order`.
- The replacement importer uses the same source-row mapping.
- The legacy POC query aliases SQLite `rowid` as `source_order`.
- The formal public query currently orders by `start_date DESC,
  source_order DESC`, and the existing announcement test uses source orders
  1, 2, and 3 to prove that ordering for equal start dates.

Therefore admin-created rows use the migration default `source_order = 0`.
The API treats `source_order` as an unknown input field, so clients cannot set
or change it; updates preserve the stored source order. The Admin list query
must use this exact total order:

```sql
ORDER BY start_date DESC, source_order DESC, announcement_id DESC
```

The first two terms preserve the existing formal/import precedence. The
identifier is only a stable tie-breaker for rows with the same date and source
order, including multiple Admin-created rows; it is not exposed as a sorting
control. The public active-announcement query remains unchanged in this
feature and continues to use its existing `start_date DESC,
source_order DESC` ordering.

Tests must retain the existing imported/source-row ordering case and add an
Admin-list tie case proving that two new `source_order = 0` rows have a stable
identifier tie-break without changing public active-read semantics.

### 3.4 Domain and transaction behavior

Add a focused admin announcement domain module or extend the existing domain
module only if that is the repository's smaller coherent boundary. Reuse the
existing statement helpers, transaction wrapper, ID generation, clock, and
audit conventions. Create, update, and delete must be atomic and must not
partially change the row on validation or database failure. Audit entries must
use the existing event/action convention rather than inventing a second audit
format.

The public `getActiveAnnouncements` behavior remains unchanged: only enabled
records inside the inclusive Taipei date window are returned to public clients.

### 3.5 Frontend management UI

Add an Admin-only `公告管理` section using the existing admin navigation and
feature conventions. The UI contains:

```text
公告管理
├─ ＋新增公告
└─ 公告列表
   ├─ 編輯
   ├─ 啟用/停用
   └─ 刪除（confirmation required）
```

The form edits title, content, start date, end date, and enabled state. It
loads the full admin list, refreshes after each successful mutation, presents
validation/API errors through existing app patterns, and does not alter the
public AnnouncementBar or AnnouncementModal behavior. Delete always requires
explicit confirmation before the API request.

Add Worker-only API client operations for the four routes. The existing
request helper continues to supply Authorization and JSON Content-Type; no
legacy GAS operation is added or changed.

## 4. Order-management permission design

The requested capability change is narrow:

```text
User       -> exactly the current ProxyAdmin order-management capability
ProxyAdmin -> current order-management capability unchanged
Admin      -> current order-management capability and existing Admin-only
              capabilities unchanged
```

Based on the current frontend and Worker sources, the order-management set is
the order summary/read capability represented by:

```text
Worker: READ_ADMIN_SUMMARY
Frontend: viewAdminOrderSummary, viewAllOrders, viewOrderStatistics
```

`READ_MEMBER_BALANCES`, `ADMIN_ANNOUNCEMENTS`, `ADMIN_TOP_UP`, `ADMIN_ROLE`,
`ADMIN_CALENDAR`, and `VIEW_AS` remain outside the User grant. In particular,
the permission change must not be implemented through a scattered
`role === 'Admin'` or `role !== 'User'` workaround.

The Worker permission map must add `READ_ADMIN_SUMMARY` to User while
preserving the current Admin-only member-balance condition in
`getAdminSummary`. The frontend map must add only the three order-summary
capabilities to User. The UI must show the order-management entry when the
new capability is present and must continue to hide calendar, announcement,
member-balance, top-up, role, and View As controls from User.

Tests must prove both positive access and negative boundaries for all three
roles, including direct Worker requests rather than only rendered UI states.

## 5. Balance presentation design

The header/info-row copy changes from:

```text
💰 餘額 -$300
```

to:

```text
-$300
```

This is presentation-only. Do not change the balance value, API operation,
ledger, D1 query, calculation, authorization, formatter, top-up modal, or
transaction labels. The narrow regression assertion must verify the header no
longer contains the label while the existing balance formatter and data flow
remain present.

## 6. Changelog and release governance

### 6.1 Canonical source

Create root `CHANGELOG.md` as the canonical release history using a minimal
Keep-a-Changelog-style format:

```markdown
# Changelog

## [Unreleased]

### Added

### Changed
```

The current package version remains `0.9.0` during this work. The implemented
changes are recorded under `[Unreleased]`; no numbered release section or
package version is written until the human approval gate.

The first creation of this file is a complete migration of the existing
`src/data/changelog.js` release history. The current history contains these
numbered releases, in this order:

```text
0.9.0, 0.8.0, 0.7.1, 0.7.0, 0.6.0, 0.5.0, 0.4.1, 0.4.0,
0.3.0, 0.2.1, 0.1.0
```

Every version, date, change item, item order, and existing `commits` reference
must be represented in `CHANGELOG.md` with no silent loss. Because the legacy
array has one `changes` list rather than named categories, its migrated items
use one explicit `### Changes` category per historical release. New work may
use `### Added` and `### Changed` under `[Unreleased]`. The parser and
regression test must preserve the category, item order, and commit metadata;
the existing modal may continue to present the flattened change items.

The file must describe the actual implemented announcement management,
order-management capability expansion, and balance presentation change. It
must not claim GAS changes, deployment, or an approved release.

### 6.2 UI presentation

Replace the hard-coded release array in `src/data/changelog.js` with a
compile-time Vite raw import of `CHANGELOG.md` and a small deterministic
parser. Browser runtime must not fetch or independently maintain a second
changelog. The parser must preserve release headings, dates when present,
category headings, bullet text, and commit metadata sufficiently for the
existing `ChangelogModal` presentation and migration regression test.
`[Unreleased]` is rendered as the friendly label `Unreleased` and is not
treated as a numbered application version.

`APP_VERSION` continues to come from `package.json`. If the parser needs a
normalized intermediate shape, that shape is derived from the Markdown and is
not a second source of release truth. A focused migration regression test must
compare the parsed historical releases with the pre-migration values for
version, date, category, item text/order, and commits, and must assert that
the historical release sequence remains complete and ordered. Tests must fail
if the UI source no longer imports or derives from `CHANGELOG.md`.

### 6.3 Human approval gate

After implementation and verification, the agent may recommend a SemVer
version and show a proposed numbered changelog entry. It must stop before:

- moving `[Unreleased]` into a numbered release;
- changing `package.json` or `package-lock.json` version;
- tagging;
- committing or pushing;
- deploying.

Those actions require a later explicit human approval. Passing tests is not
release approval.

### 6.4 Release Skill status

The repository manifest declares `project_skills`, but it is currently empty;
the missing piece is the authoritative non-empty entry schema and governance
contract for a third-party project-local Skill. Therefore this phase does not
create `.agents/skills/release-changelog` and does not modify `agent.yaml`.
The release workflow remains documented in this spec and the implementation
plan until governance evidence permits a conforming Skill.

## 7. CodeGraph evidence to preserve

The pre-change evidence was collected with
`@lzehrung/codegraph@2.3.21` and external cache
`C:\Users\SER\AppData\Local\CodeGraph\cache\bento-order-app`. The complete
`rg` outputs are retained outside the repository at:

`C:\Users\SER\AppData\Local\Temp\bento-phase0-baseline-2d8c22024f1e4b17a8e3426fe7203cc6`

### 7.1 rg-only candidate baseline

| Concern | Candidate files | Count |
| --- | --- | ---: |
| Announcement | `src/App.jsx`, announcement components/data, Worker announcement/read routes/domain, formal schema/tests, related docs and fixtures | 38 |
| Permissions/order management | frontend permission/App/API/admin feature files, Worker permission/domain/routes, permission/admin/calendar/role/view-as tests and fixtures | 77 |
| Balance presentation | `src/App.jsx`, frontend permission/API/mock/auth/ViewAs/formatter/balance files, strict ledger test | 10 |
| Version/changelog/release | package manifests, App/modal/data, strict ledger test, existing docs/plans/specs, Worker docs/scripts/tests | 76 |

The exact candidate paths are retained in the four baseline output files. The
highest-value paths manually inspected before this spec were:

```text
src/App.jsx
src/auth/permissions.js
src/api/apiClientCore.js
src/data/changelog.js
src/components/AnnouncementBar.jsx
src/components/AnnouncementModal.jsx
src/components/ChangelogModal.jsx
src/features/admin/AdminOrderSummary.jsx
src/features/balances/formatters.js
tests/strict-identity-ledger.test.cjs
worker-poc/src/formalWorker.js
worker-poc/src/auth/permissions.js
worker-poc/src/domain/announcements.js
worker-poc/src/domain/adminSummary.js
worker-poc/src/domain/orders.js
worker-poc/src/routes/admin.js
worker-poc/src/routes/readOnly.js
worker-poc/src/routes/calendar.js
worker-poc/src/routes/balance.js
worker-poc/src/routes/roles.js
worker-poc/migrations-formal/0000_formal_initial_schema.sql
worker-poc/tests/announcements.test.js
worker-poc/tests/admin-summary.test.js
worker-poc/tests/permissions.test.js
worker-poc/tests/helpers/formal-fixtures.js
agent.yaml
```

`rg` did not express call direction, permission propagation, or the distinction
between public active reads and Admin all-record reads; those were the
questions CodeGraph was used to investigate.

### 7.2 Pre-change CodeGraph findings

`codegraph orient --root . --budget small` completed with 144 files. The
central graph files included `worker-poc/src/formalWorker.js`, the formal test
fixtures, `worker-poc/src/http/errors.js`, and transaction helpers.

Before implementation, targeted refs/deps/rdeps found these true relationships.
The queried symbol handles included `getActiveAnnouncements`, `assertCan`,
`hasPermission`, `formatBalanceAmount`, and `CHANGELOG` in their current
source locations. The useful reference counts were 3 for
`getActiveAnnouncements`, 12 for `assertCan`, 11 for `hasPermission`, 8 for
`formatBalanceAmount`, and 2 for `CHANGELOG`.

- `getActiveAnnouncements` is referenced by the Worker read-only route and
  depends on the date-window helper; its reverse dependency is the public
  read route.
- `assertCan` is a centralized permissions helper used by admin summary,
  orders, users, balance, calendar, read-only, roles, and permission tests;
  its reported dependency is the existing HTTP error helper.
- `hasPermission` feeds the frontend App and mock API capability checks.
- `formatBalanceAmount` is shared by App, View As presentation, and member
  balance management.
- `CHANGELOG` is consumed by App/changelog presentation and depends on the
  package version source.
- `createOrReplaceOrder` connects the order domain, route, authorization,
  errors, idempotency, transaction, and deadline helpers.

The following limitations are part of the evidence, not assumptions:

- CodeGraph fuzzy `submitOrder` results were ambiguous and surfaced the
  frontend request reference rather than the Worker order write symbol; the
  actual Worker `createOrReplaceOrder` had to be queried separately.
- Several exported arrow functions, including `assertCan`, were not resolved
  by callers/callees queries even though refs/deps/rdeps returned useful
  relationships.
- Search queries reported `mode=reduced`, `backend=graph-only`, and
  `nativeFilesUsed=0`; the initial graph setup was mixed, but these query
  results were not a native/full-graph result.
- A fuzzy query produced the unsupported/noisy relationship `assertCan` to
  `assertCancelled`.
- Legacy GAS is intentionally outside this change and must not be scored as a
  CodeGraph coverage failure.

### 7.3 Post-change evidence ledger

The implementation and review phases must append concrete evidence to this
ledger before the final report:

| Metric | Required evidence |
| --- | --- |
| Pre-change `rg` candidate files | The four counts and retained path outputs above |
| True dependencies found by CodeGraph before edit | The relationships in section 7.2 plus command output handles |
| False positives/unsupported relationships | The fuzzy/arrow-function/reduced-query limitations in section 7.2 |
| Files manually opened | Exact final list, including all changed files and authorization/test boundaries |
| Late dependencies | Any file first found after editing; report `none` only if verified |
| Reviewer omissions | Independent review findings; report review unavailability rather than inventing findings |
| Rework from insufficient impact analysis | Exact change/rework, or `none` with evidence |

After implementation, run the supported `impact` form confirmed by the
installed CLI and repeat targeted `search`, `symbols`, `refs`, `deps`, `rdeps`,
and `refactor-plan` queries for the changed surfaces. Compare the post-change
`rg` list with the baseline. The final CodeGraph rating must use the evidence
definitions from the implementation plan:

- HIGH VALUE: an important true dependency was found before implementation and
  likely prevented a missed change, test, or rework;
- MEDIUM VALUE: no critical new dependency, but manual navigation/inspection
  was materially reduced;
- LOW VALUE: results mostly duplicated `rg` navigation;
- NEGATIVE VALUE: noise or incompleteness increased work or caused an incorrect
  conclusion.

## 8. Verification and review design

Implementation must use focused tests first, then the repository-defined
verification commands and applicable Worker tests. The required order is:

1. Focused announcement, permission, balance, changelog, and Worker contract
   tests as the affected code is changed.
2. Root strict identity/ledger test:
   `node --test tests/strict-identity-ledger.test.cjs`.
3. Worker package test commands as declared by
   `worker-poc/package.json`, including formal Worker, announcement,
   permission, admin-summary, and relevant auth/error tests.
4. `npm run lint`.
5. `npm run build`.
6. `git diff --check` and `git status --short`.

Every command will be reported as PASS, FAIL, NOT RUN, or NOT VERIFIED with
its exact command and output summary. Automated verification and independent
review findings will be reported separately. Review must specifically inspect:

- Admin-only server enforcement;
- User/ProxyAdmin/Admin positive and negative boundaries;
- destructive delete confirmation and not-found behavior;
- frontend/backend permission agreement;
- canonical changelog versus presentation divergence;
- unrelated files and protected main-worktree changes.

Real LIFF authentication, View As behavior in a real browser, GAS deployment,
and production contracts remain manual/external verification items and are not
claimed as locally verified.

## 9. Explicit non-goals

This design does not:

- modify any `.gs` file or GAS API;
- change the existing D1 schema unless implementation proves the existing table
  cannot satisfy the stated contract;
- change Worker CORS, production configuration, D1 data, Netlify, or deploys;
- add a second generic permission mechanism;
- grant User announcement, balance-administration, role, calendar, top-up, or
  View As powers;
- add announcement sorting, drag-and-drop, preview mode, or rich text;
- finalize a version, create a tag, commit, push, or deploy;
- create or register an ungoverned project-local release Skill;
- count legacy GAS as active CodeGraph coverage.

