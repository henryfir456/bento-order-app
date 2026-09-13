# Legacy Reconciliation Dry-Run Foundation — Implementation Plan

## Goal

Extend the existing Legacy readiness path with a pure, deterministic,
zero-write reconciliation foundation using SQL as the historical source and
Excel as current/master plus recent operational evidence. The final planner
contract is `{ currentSnapshot, historicalFacts, d1Snapshot }`.

## Architecture and constraints

- Preserve `normalizeLegacyWorkbook -> resolveLegacyIdentities -> validateImport`.
- Add one independent pure planner; do not put D1 classification in the
  validator and do not create a second importer/ETL/identity source of truth.
- `gas/bento_script.sql` is the historical source. It is parsed as UTF-16LE
  SQL Server text only; no SQL execution. `username` is formal employee ID in
  `bento_order_count` and `bento_order_status`; `username_update` is never owner.
- `gas/便當系統設定.xlsx` is current/master and recent operational evidence,
  not complete history. Its current identity-bearing sheets lack direct
  employee ID, so name/LINE cannot fill that gap.
- Historical identity path is only SQL username -> strict normalize -> offline
  D1 snapshot -> canonical user ID. No name, LINE, fuzzy, or update-user path.
- Historical facts include order, like, wallet, menu, and type facts with
  normalized employee ID (when applicable), source table/row/id, original
  status/event type, and raw evidence.
- Existing `gas/` artifacts remain legacy evidence. Do not modify the SQL
  source, add it, execute it, or perform cleanup. Do not commit or push.
- `mutationPreview` is semantic and non-executable (`execute:false`); no
  production sequence, SQL, D1 binding, remote command, deploy, or migration.

## Task 1 — TDD red tests first

1. Capture the existing governed baseline before attributing failures to this
   change: root strict identity-ledger test, lint, and build.
2. Add a focused SQL adapter test against `gas/bento_script.sql`: UTF-16LE
   detection, exact table/fact counts, strict normalized IDs, source row/id and
   raw evidence, `username_update` non-owner behavior, and no fabricated order ID.
3. Add planner tests using `{ currentSnapshot, historicalFacts, d1Snapshot }`:
   existing non-LINE and LINE-bound owners, SQL-only deterministic CREATE
   candidates and profile-completeness policy,
   direct-ID master CREATE, duplicate owner/collision fail-closed behavior,
   role safety, balance review, order/like/wallet preview policies, and stable
   plan hash.
4. Retain focused Excel Orders regression tests: blank column 13 recognizes
   `CANCELLED`; an unknown blank-column shape does not default to `ACTIVE`.
5. Add dry-run safety assertions for rowsWritten=0, changedDb=false, no SQL
   execution and no remote/migration/deploy capability.
6. Run new tests before implementation and record the expected module/test
   failures as TDD evidence.

## Task 2 — Reconcile existing workbook foundation

1. Keep the existing `username` header alias and direct identity provenance for
   workbook rows; absent username remains fail-closed.
2. Keep duplicate canonical-header detection and the explicit blank-column-13
   Orders status recognizer. Never restore an `ACTIVE` fallback.
3. Continue to run current Excel normalization/validation for current and
   recent evidence, but do not treat it as SQL history or route SQL facts
   through workbook-only order schemas.

## Task 3 — Implement the SQL historical adapter

Add `worker-poc/scripts/lib/legacy-sql-adapter.mjs` as a pure text parser:

1. Detect UTF-16LE BOM/encoding and parse only known INSERT statements for
   `bento_order_count`, `bento_order_status`, `bento_price`, and `bento_type`.
2. Emit `historicalOrderFacts`, `historicalLikeFacts`,
   `historicalWalletFacts`, `historicalMenuFacts`, and `historicalTypeFacts`.
3. Map `bento_order_count` rows and `status=order` to order facts; map
   `heart`/`heart-outline` to chronological like events; map
   `wallet_add`/`wallet_sub` to wallet evidence. Preserve all original event
   types and updater evidence without using it as owner identity.
4. Preserve `sourceTable`, source row number, source ID, normalized employee ID,
   and raw reconciliation evidence. Invalid/missing usernames become explicit
   identity issues, not guesses.
5. Never emit modern `order_id`, synthetic order IDs, current Like rows, or
   ledger/adjustment mutations.

## Task 4 — Extend the pure planner without a parallel architecture

1. Keep the existing workbook planner implementation for compatibility and
   route the new source-model API through a thin source reconciliation layer;
   do not duplicate identity rules or create a second importer.
2. Accept `{ currentSnapshot, historicalFacts, d1Snapshot }` and resolve SQL
   facts only through normalized employee ID and the offline snapshot. A
   SQL-only ID without a D1 owner receives one deterministic candidate target;
   required profile fields that cannot be safely supplied remain incomplete
   profile state, never guessed values; the local policy migration permits a
   nullable pickup floor while operational order eligibility remains strict.
3. Centralize the SQL-only provisional profile policy: deterministic display
   evidence, null LINE binding, lowest-privilege User role, active canonical
   default, UNVERIFIED status, and canonical balance default 0 marked as not
   legacy-reconciled. Do not infer pickup floor; report the exact required
   profile blocker when the schema has no safe default.
4. Reuse current canonical owner classification, deterministic stable CREATE
   ID, role precedence, balance review, collision/ownership conflict flags,
   and deterministic row ordering.
5. For deterministic existing targets, emit semantic order previews without a
   modern order ID, chronological like-event previews without current-state
   materialization, and wallet review previews without ledger mutation.
6. Add summary fields: total SQL historical identities, unique normalized IDs,
   all action counts, order/like/wallet fact counts, unresolved historical rows,
   resolved historical rows, coverage classes, required-profile blockers,
   normalization collisions, and `planHash` over all three source inputs.

## Task 5a — Verify runtime convergence without changing the runtime contract

1. Prove an imported non-LINE canonical user is returned by repeated employee
   guest login without creating another user.
2. Prove the existing authenticated guest-session `/api/auth/line-bind` path
   attaches LINE to that same user and is idempotent on replay.
3. Prove direct LINE employee binding without an authenticated survivor remains
   `EMPLOYEE_ID_ALREADY_BOUND`, and existing LINE takeover protections remain
   unchanged. SQL import evidence is not authentication proof.

## Task 5 — Update local dry-run entrypoint and report

1. Extend `worker-poc/scripts/legacy-reconciliation-dry-run.mjs` to accept a
   local workbook/current snapshot and required local SQL dump path, parse both,
   load only an offline JSON D1 snapshot, and call the pure source-model planner.
2. Reject `--remote`, `--apply`, `--execute`, `--deploy`, `--migration`,
   `--write`, and equivalent mutation flags before work.
3. Write only an explicitly requested fresh local JSON report. Add source
   hashes and the complete dry-run safety evidence; never emit executable SQL.
4. Keep production import/deployment scripts untouched.

## Task 6 — Documentation and verification

1. Update the design spec and Worker usage document to revoke the old
   Excel-primary historical assumption and state the SQL/Excel boundaries.
2. Run focused SQL adapter, planner, and Orders tests, then existing import and
   formal tests as supplemental evidence.
3. Run governed root commands in `agent.yaml` order: required test, lint, build.
4. Separate fresh PASS/FAIL, captured baseline failures, and unverified remote
   LIFF/D1/deployment evidence. Confirm the SQL file hash is unchanged and
   remains untracked/user-owned. Do not run remote D1, deploy, migration apply,
   commit, or push.

## Acceptance criteria

- SQL `username` is the only historical identity source and normalizes strictly.
- One normalized employee ID plans at most one canonical user.
- Existing non-LINE/LINE owners merge to the same existing user; no duplicate.
- Ambiguous identity, collision, multiple owner, and role escalation fail closed.
- Balance conflict is review-only; no overwrite, synthetic ledger, or adjustment.
- Orders/Likes/TopupHistory produce target relationship previews only after
  deterministic resolution; unresolved rows have no guessed IDs.
- SQL order facts never fabricate modern order IDs; like events are chronological;
  wallet facts remain evidence.
- Blank-header `CANCELLED` never becomes `ACTIVE`.
- Same SQL + Excel snapshot + D1 snapshot yields identical rows, preview,
  summary, and planHash.
- Dry-run reports rowsWritten=0, changedDb=false and no SQL/remote/deploy/
  migration/production mutation.
- No formal import is executed in this task.
