# Bento Admin, Order Management, and Release Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Admin announcement CRUD, broaden order-management access safely, simplify balance presentation, and establish human-approved release/changelog governance.

**Architecture:** Reuse existing React/Worker permission and data patterns. Keep authorization centralized and server enforced. CHANGELOG.md becomes canonical release history while UI remains a presentation layer.

**Tech Stack:** React, Vite, Cloudflare Workers, D1, Node tests, CodeGraph CLI.

**Spec:** `docs/superpowers/specs/2026-09-10-bento-admin-order-release-design.md`

## Global Constraints

- Work only in the detached worktree
  `C:\Users\SER\AppData\Local\Temp\bento-order-app-release-worktree`.
- Preserve the main-worktree untracked `dev-start.bat` and `dev-start.ps1`.
- Do not modify GAS, `.gs` files, Netlify, Worker production configuration,
  remote D1 data, or CORS behavior.
- Do not deploy, commit, push, tag, or change the package version. The current
  version remains `0.9.0` until a later human version approval.
- Do not add a D1 migration: the existing formal `announcements` table already
  contains all required fields.
- Keep `project_skills: []` unchanged. The field exists; the missing evidence
  is an authoritative non-empty project-local Skill entry schema and governance
  contract. Do not create a release Skill in this pass.
- Do not introduce a second permission mechanism. Worker authorization remains
  server-enforced through `worker-poc/src/auth/permissions.js`; frontend maps
  only control presentation.
- Preserve the current LIFF authentication, Authorization header, View As
  identity separation, Worker API, ledger, and GAS retirement boundaries.
- Treat `source_order` as import/source-row metadata, not a user-facing sort
  field. Admin-created rows use `source_order = 0`; clients cannot set it;
  updates preserve it. Admin list order is exactly:
  `start_date DESC, source_order DESC, announcement_id DESC`. The existing
  public active-announcement query keeps its current two-term order.
- Create `CHANGELOG.md` by fully migrating the existing
  `src/data/changelog.js` history. Preserve every version, date, category,
  change item, item order, and commit reference. Add a regression test before
  replacing the hard-coded source.

## Task 1 — Announcement backend/contracts + tests

**Files:**

- Add `worker-poc/tests/admin-announcements.test.js`.
- Modify `worker-poc/src/auth/permissions.js`.
- Modify `worker-poc/src/domain/announcements.js`.
- Modify `worker-poc/src/routes/admin.js`.

### Tests first

- [ ] Add formal Worker fixture setup with `SqliteD1`, `seedUser`,
  `profileFetch`, and the existing request helper.
- [ ] Add an Admin-only matrix test for `GET`, `POST`, `PATCH`, and `DELETE`:
  Admin succeeds; ProxyAdmin and User receive the existing forbidden response.
- [ ] Add create coverage for title, content, start date, end date, and
  omitted/default `enabled`; assert a generated ID and HTTP 201.
- [ ] Add edit coverage for each editable field and a complete response row.
- [ ] Add enable and disable coverage through `enabled: true` and
  `enabled: false`.
- [ ] Add delete coverage with explicit row removal and a second delete that
  returns the existing not-found response.
- [ ] Add invalid payload coverage for malformed JSON, empty/blank title or
  content, invalid date-only values, reversed date range, invalid boolean,
  empty patch, and unknown `source_order` input.
- [ ] Add list coverage proving disabled, future, expired, and active rows are
  visible to Admin but public `/api/calendar` behavior is unchanged.
- [ ] Add source-order coverage using imported rows with source orders 1, 2,
  and 3; assert the existing `start_date DESC, source_order DESC`
  precedence.
- [ ] Add two newly created rows with the same start date and default
  `source_order = 0`; assert Admin list order follows
  `announcement_id DESC` as the stable tie-breaker and that the stored source
  order is not client-controlled.

### Implementation

- [ ] Add `ACTIONS.ADMIN_ANNOUNCEMENTS` to the centralized Worker action map
  and grant it only to `Admin`.
- [ ] Extend `worker-poc/src/domain/announcements.js` with focused functions
  for admin list, create, update, and delete. Keep the existing
  `getActiveAnnouncements` public query and output unchanged.
- [ ] Use the existing `isDateOnly`, response error helpers, statement
  preparation, mutation batch, clock, ID, and audit conventions. Validate the
  complete resulting date range on patch.
- [ ] Set `source_order` to the database default 0 for Admin-created rows;
  never accept it from API payloads and never rewrite it during update.
- [ ] Query the Admin list with:
  `ORDER BY start_date DESC, source_order DESC, announcement_id DESC`.
- [ ] Add `/api/admin/announcements` dispatch to `worker-poc/src/routes/admin.js`
  using the existing identity and error handling. Keep all responses inside the
  formal Worker wrapper so route errors receive the same CORS treatment.
- [ ] Use the existing transaction/audit pattern for create, update, and
  delete. Do not add a migration or a legacy GAS path.
- [ ] Run the focused test file and the existing announcement/permission tests;
  keep the first failing output for diagnosis before moving to Task 2.

## Task 2 — Announcement Admin UI and Worker client

**Files:**

- Add `src/features/admin/AnnouncementManagement.jsx`.
- Modify `src/api/apiClientCore.js`.
- Modify `src/App.jsx`.
- Modify `tests/strict-identity-ledger.test.cjs`.

### Tests first

- [ ] Add source-contract assertions for the four Worker client operations:
  list, create, update, and delete.
- [ ] Add source-contract assertions that the Admin navigation exposes
  `公告管理` only for the Admin actor, uses the existing authenticated Worker
  transport, and keeps the public AnnouncementBar/AnnouncementModal imports.
- [ ] Add an assertion that delete requires an explicit confirmation before
  calling the delete operation.
- [ ] Add an assertion that View As state cannot expose or submit the
  Admin-only announcement management controls.

### Implementation

- [ ] Add Worker-only client operations with these stable names and payloads:
  `getAdminAnnouncements()`, `createAdminAnnouncement(payload)`,
  `updateAdminAnnouncement(id, payload)`, and
  `deleteAdminAnnouncement(id)`. Reuse `createWorkerRequest`; do not add GAS
  counterparts.
- [ ] Build `AnnouncementManagement` with a list, create/edit form, enabled
  toggle, inline API/validation error state, refresh-after-mutation behavior,
  and a confirmation step for delete.
- [ ] Keep form fields limited to title, content, start date, end date, and
  enabled. Do not add sorting, drag-and-drop, preview, or rich-text behavior.
- [ ] Add the Admin section to the existing `adminSection` navigation in
  `src/App.jsx`. Use the authenticated actor's Admin capability for this
  Admin-only control, and prevent View As from invoking mutations.
- [ ] Preserve existing public announcement loading and rendering paths.
- [ ] Run the focused frontend contract test and `npm.cmd run build` after the
  component is wired, fixing only issues introduced by this feature.

## Task 3 — Order-management permission change + tests

**Files:**

- Modify `worker-poc/src/auth/permissions.js`.
- Modify `src/auth/permissions.js`.
- Modify `worker-poc/tests/permissions.test.js`.
- Modify `worker-poc/tests/admin-summary.test.js`.
- Modify `worker-poc/tests/view-as.test.js` if the existing View As boundary
  assertions require the new positive User summary case.
- Modify `tests/strict-identity-ledger.test.cjs`.

### Tests first

- [ ] Add Worker permission assertions that User gains only
  `READ_ADMIN_SUMMARY`, while `READ_MEMBER_BALANCES`, calendar, top-up, role,
  announcement, and View As actions remain denied.
- [ ] Add direct Worker admin-summary requests for User, ProxyAdmin, and Admin.
  User and ProxyAdmin receive the existing order-summary capability; only
  Admin continues to receive member-balance data under the existing
  `getAdminSummary` condition.
- [ ] Add frontend capability assertions that User gains exactly
  `viewAdminOrderSummary`, `viewAllOrders`, and `viewOrderStatistics`.
- [ ] Assert that User still lacks `manageCalendar`, `manageAnnouncements`,
  `viewMemberBalances`, `topupMember`, `manageRoles`, and `viewAsUser`.
- [ ] Assert that ProxyAdmin and Admin behavior outside order management is
  unchanged.

### Implementation

- [ ] Add `READ_ADMIN_SUMMARY` to the Worker User role grant without changing
  the existing Admin-only member-balance branch.
- [ ] Add only the three order-summary capabilities to the frontend User map.
- [ ] Keep `ADMIN_ANNOUNCEMENTS` Admin-only from Task 1 and do not grant any
  other Admin-only capability as a side effect.
- [ ] Update only the existing centralized permission maps and the existing
  order-management navigation checks. Do not add role-condition workarounds.
- [ ] Run the focused Worker permission/admin-summary tests and strict
  identity/ledger assertions.

## Task 4 — Balance presentation cleanup + regression test

**Files:**

- Modify `src/App.jsx`.
- Modify `tests/strict-identity-ledger.test.cjs`.

- [ ] Add/update the narrow source assertion for the header copy before the
  JSX edit.
- [ ] Remove only the `💰 餘額` header/info-row label so the displayed value is
  `-$300` rather than `💰 餘額 -$300`.
- [ ] Leave `formatBalanceAmount`, balance API calls, D1/ledger code,
  authorization, top-up modal, transaction labels, and View As balance data
  unchanged.
- [ ] Run the focused strict test and inspect the diff to confirm this is a
  presentation-only change.

## Task 5 — CHANGELOG canonical source and complete history migration

**Files:**

- Add `CHANGELOG.md`.
- Add `src/data/changelogParser.js`.
- Modify `src/data/changelog.js`.
- Modify `src/components/ChangelogModal.jsx`.
- Add `tests/changelog-migration.test.cjs`.
- Modify `tests/strict-identity-ledger.test.cjs`.

### Migration test first

- [ ] Add a focused Node test with the pre-migration history as an explicit
  expected fixture. It must assert the exact release sequence:
  `0.9.0`, `0.8.0`, `0.7.1`, `0.7.0`, `0.6.0`, `0.5.0`, `0.4.1`, `0.4.0`,
  `0.3.0`, `0.2.1`, `0.1.0`.
- [ ] Assert every historical date from the current source, one `Changes`
  category per migrated release, every change item and its original order, and
  every existing commit reference, including empty commit arrays.
- [ ] Assert that the Markdown parser returns no missing or duplicate
  historical release and that `[Unreleased]` is separate from the historical
  sequence.
- [ ] Add a source-contract assertion that `src/data/changelog.js` imports
  `CHANGELOG.md?raw` and derives `CHANGELOG` from the parser rather than
  maintaining the old hard-coded release array.

### Implementation

- [ ] Create root `CHANGELOG.md` with `[Unreleased]` first. Put the current
  implementation changes under `[Unreleased]` using `Added` and `Changed`.
- [ ] Migrate the existing releases in their exact current order and dates:

  ```text
  0.9.0  2026-09-09
  0.8.0  2026-09-09
  0.7.1  2026-09-04
  0.7.0  2026-09-04
  0.6.0  2026-09-04
  0.5.0  2026-09-03
  0.4.1  2026-09-03
  0.4.0  2026-09-03
  0.3.0  2026-09-03
  0.2.1  2026-09-03
  0.1.0  2026-09-02
  ```

- [ ] Put each legacy `changes` array in an explicit `### Changes` section,
  preserving exact text and order. Preserve the legacy `commits` arrays as a
  `**Commits:**` metadata line that the parser can round-trip; represent an
  empty array as `none`.
- [ ] Implement `parseChangelog(markdown)` in the pure
  `src/data/changelogParser.js` module. Return release version, date,
  categories, flattened changes in category/item order, and commits.
- [ ] Update `src/data/changelog.js` to import `CHANGELOG.md?raw`, keep
  `APP_VERSION` from `package.json`, and export the parser result.
- [ ] Update `ChangelogModal` so numbered releases render as `vX.Y.Z` and
  `[Unreleased]` renders as `Unreleased` without changing the existing modal
  API or the current version header behavior.
- [ ] Keep `package.json` and `package-lock.json` at version `0.9.0`.
- [ ] Run the migration test, strict test, and build before proceeding.

## Task 6 — Release Skill and governance gate

**Files:** none expected.

- [ ] Re-read `agent.yaml` and the declared `.agents/skills` manifests after
  the feature changes; confirm `project_skills: []` is still the supported
  current state.
- [ ] Confirm no authoritative non-empty third-party Skill entry schema or
  governance contract has appeared in the repository/shared-source evidence.
- [ ] Leave `agent.yaml`, `.agents/skills`, `shared_skills`, `shared_source`,
  and agent-platform snapshots unchanged.
- [ ] Report release-changelog Skill registration as blocked by missing
  authoritative entry governance, not by a missing manifest field.

## Task 7 — Full verification and post-change CodeGraph evidence

**Files:** no source changes are planned by this task.

### Focused and repository verification

- [ ] Run `node --test worker-poc/tests/admin-announcements.test.js`.
- [ ] Run `node --test tests/changelog-migration.test.cjs`.
- [ ] Run the declared root test command:
  `node --test tests/strict-identity-ledger.test.cjs`.
- [ ] Run the formal Worker suite exactly as declared:
  `npm.cmd run test:formal --prefix worker-poc`.
- [ ] Run the full Worker suite exactly as declared:
  `npm.cmd test --prefix worker-poc`.
- [ ] Run the declared lint command using the Windows equivalent:
  `npm.cmd run lint`.
- [ ] Run the declared build command using the Windows equivalent:
  `npm.cmd run build`.
- [ ] Run `git diff --check` and
  `git -c safe.directory=C:\Users\SER\AppData\Local\Temp\bento-order-app-release-worktree status --short`.
- [ ] Record each command as PASS, FAIL, NOT RUN, or NOT VERIFIED with the
  exact command and a concise output summary. Do not treat an unrelated
  baseline failure as a feature pass.

### CodeGraph evidence

- [ ] Use the fixed CLI `@lzehrung/codegraph@2.3.21` with cache outside the
  repository:

  ```powershell
  $env:CODEGRAPH_CACHE_DIR = 'C:\Users\SER\AppData\Local\CodeGraph\cache\bento-order-app'
  codegraph --help
  codegraph orient --root . --budget small
  ```

- [ ] Run `codegraph impact --help` first. If the confirmed syntax supports
  the requested worktree comparison, run the exact supported equivalent of
  `codegraph impact --base HEAD --head WORKTREE` and retain JSON/output. Do not
  invent an unsupported argument.
- [ ] Run targeted post-change `search`, `symbols`, `refs`, `deps`, `rdeps`,
  and `refactor-plan` queries for:
  `ADMIN_ANNOUNCEMENTS`, the four admin announcement functions,
  `handleAdminRoute`, `READ_ADMIN_SUMMARY`, `hasPermission`,
  `formatBalanceAmount`, `parseChangelog`, and `CHANGELOG`.
- [ ] Repeat the four baseline `rg` searches and compare candidate files with
  the retained pre-change outputs.
- [ ] Record the actual analysis mode for each query: native/full, mixed, or
  reduced/regex fallback. The prior baseline had reduced graph-only query
  results with `nativeFilesUsed=0`; do not describe those as full/native.
- [ ] Fill the evidence ledger with exact values for pre-change `rg` files,
  CodeGraph true dependencies, false positives/unsupported relationships,
  manually inspected files, late dependencies, reviewer omissions, missed
  tests/contracts, and rework caused by missed impact.
- [ ] Exclude legacy GAS from the coverage denominator because the approved
  scope explicitly retires it.

### Independent review

- [ ] Perform a separate defect-first review of the final diff and test output.
  Inspect Admin-only server enforcement, User/ProxyAdmin/Admin boundaries,
  delete confirmation, frontend/backend permission agreement, changelog
  migration completeness, source-order semantics, protected files, and
  unrelated changes.
- [ ] Keep reviewer findings separate from automated test results. If an
  independent reviewer tool is unavailable, report that limitation rather
  than fabricating reviewer findings.

## Task 8 — Version recommendation gate

**Files:** no release-version files may be changed by this task.

- [ ] Inspect the final diff, current `package.json` version `0.9.0`, test
  evidence, and compatibility impact.
- [ ] Produce a SemVer recommendation only after the implementation evidence
  is complete. The new Admin announcement feature and expanded order-summary
  capability are candidates for a minor change, but the final recommendation
  must follow the actual diff.
- [ ] Provide a proposed numbered changelog entry separately from the current
  `[Unreleased]` content.
- [ ] Stop before changing `package.json`, `package-lock.json`, moving
  `[Unreleased]`, tagging, committing, pushing, or deploying.
- [ ] End the implementation report with
  `WAITING FOR HUMAN VERSION APPROVAL` and include the CodeGraph rating as
  `HIGH VALUE`, `MEDIUM VALUE`, `LOW VALUE`, or `NEGATIVE VALUE` based only on
  recorded evidence.

## Execution order and completion gate

Execute Tasks 1 through 5 in order, then Task 6, Task 7, and Task 8. A task
is complete only when its focused tests pass and its diff has been inspected.
The overall work is not releasable until all applicable automated checks have
evidence, the independent review is reported separately, and the human version
approval gate remains explicitly open.

