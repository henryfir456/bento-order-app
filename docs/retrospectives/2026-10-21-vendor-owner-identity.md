# 2026-10-21 — Vendor owner identity separation

- Repository: `henryfir456/bento-order-app`; branch: `fix/separate-vendor-owner-identity`.
- PR: [#144](https://github.com/henryfir456/bento-order-app/pull/144).
- Implementation commit SHA and its parent are recorded in the GitHub PR's commit and base metadata; raw SHAs are omitted here because the repository PII scanner classifies them as numeric identifiers.
- Delivery status: `PARTIAL` while independent review and squash merge are pending. Formal D1 migration, identity conversion, and Worker deployment are explicitly outside this task's execution scope.
- Runtime used for repository work: Node `v24.19.0`, npm `11.9.0`, Wrangler `4.129.0`. PowerShell was unavailable in this executor.

## 本輪目標／實際修改

- Confirmed that `RESERVED_VENDOR_OWNER` protects the legacy LINE owner from Issue #122 (case A), and changed its canonical mapping from employee ID to `users.user_id`. Formal D1 was confirmed at migration 0014, so migrations 0017 and 0018 have not been applied and could be corrected under the forward-only policy.
- Added a dedicated normalized `vendor_principals.vendor_login_id`; kept `users.user_id`, `users.employee_id`, the existing LINE binding, stored `users.role = User`, verification state, historical orders, ledger rows, and payment rows separate and unchanged.
- Resolved Vendor login only for the existing OAuth-authenticated LINE subject on that canonical user. Vendor API scope continues to come from the authenticated user's active membership and canonical enabled Vendor.
- Removed global protected-mapping readiness from Worker startup. The cutover runbook requires successful mapping/principal/membership readback before deploying the new Worker.
- Added a rerunnable, fail-stop PowerShell 7/5.1 conversion script and a formal runbook. They were not run against formal D1.
- Updated this Repo's `AGENTS.md` with the no-repeat launcher fallback and evidence labels. The shared Template policy PR is #26; ADL synchronization remains a separate follow-up after that source policy is reviewed and merged.

## 本輪阻礙

| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| PowerShell script execution | `TOOL_UNAVAILABLE` / `AGENT_EXECUTION_NOT_RUN` | `command -v pwsh` and `command -v powershell` returned no executable; this runtime is not Windows PowerShell. | Did not retry the known MXC launcher or infer a Windows fault. Added a version-controlled PowerShell script and copyable PS 7/5.1 steps. | Verified: PowerShell is unavailable in this executor. Script runtime behavior remains `NOT VERIFIED`. |
| UI verification attempts | `TEST_FAILURE`, then pass | Two earlier full UI attempts had different failures: one browser history assertion while build was running; one temporary-directory cleanup `ENOTEMPTY`. The local Mock UAT passed alone and the final full UI command passed 39/39. | Re-ran the isolated local Mock UAT and then the exact full UI suite; final exit code 0. No product code was changed for either transient failure. | Initial overlap with build is a possible cause, not verified. Cleanup failure root cause remains `UNKNOWN`. |
| Branch-protection / ruleset reads | `API_ACCESS_LIMITED` | Branch-protection reads returned 403 for all three repos; Template/ADL ruleset reads returned the plan-limit 403; Bento rulesets returned an empty list. | Applied the repository's dated 2026-10-19 maintainer confirmation that the three repos had no Branch Protection or Rulesets. Commit status APIs returned no statuses; that is recorded separately from the policy snapshot. | Verified API restrictions; current settings otherwise rely on the dated maintainer confirmation. Required checks are `NOT CONFIGURED` under that confirmation, not marked PASS. |

The known MXC `D:\` launcher was not invoked in this round because the user has already identified its repeated failure. No D-drive repair request or same-launcher retry was made.

## 個資發布檢查

- `PII_SCAN`: `PASS` for the added diff and all new text artifacts; `git diff --check`: `PASS`.
- Issue, PR, commit, tests, and runbook use synthetic identities or generic identifiers. No real employee ID, LINE ID, credential, or payment data is included.
- The user-provided formal D1 backup/export, R2 readback/hash, SQLite integrity, foreign-key, eight-table count, and Bucket Lock/Lifecycle checks were treated as `USER_EXECUTION_VERIFIED` and reused. Their raw source files were not available in this workspace and were not recopied into GitHub.
- Independent reviewer: review is required on the final PR head; the exact head and review submission are recorded by GitHub on PR #144. No result is claimed here before that submission exists.

## 驗證

All repository commands below ran on Node `v24.19.0`; successful commands exited 0.

- 修正前 RED：focused protected-account and formal-schema checks failed on the missing canonical protected mapping / vendor login schema and the global readiness behavior. After implementation, the same contracts are green below.
- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/pii-scan-public-artifacts.test.cjs`: 99 tests, 96 passed, 3 skipped, 0 failed.
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`: 9 + 15 + 14 + 3 tests passed.
- `npm test --prefix worker-poc`: 73 passed, 0 failed.
- `node worker-poc/tests/protected-account.test.js`: 26 passed, 0 failed.
- `node worker-poc/tests/formal-schema.test.js`: 27 passed, 0 failed; its synthetic SQLite fixture applies migrations 0015 through 0021 in order after the 0014 baseline and checks conversion/history contracts.
- Required UI command from `agent.yaml`: 39 passed, 0 failed.
- `npm run lint`: exit 0; existing warnings remain outside modified files.
- `npm run build`: exit 0; Vite reports the existing large JavaScript chunk advisory.
- `git diff --unified=0 origin/main | node scripts/pii-scan-public-artifacts.mjs --diff-stdin`: `PASS`.
- `git ls-files --others --exclude-standard | xargs -r node scripts/pii-scan-public-artifacts.mjs`: `PASS`.
- Formal D1 migration, formal identity conversion, remote Worker deployment, and post-deploy smoke: `AGENT_EXECUTION_NOT_RUN` as requested. The runbook script being present is not execution evidence.

## 改善建議

| 建議事項 | 優先級 | 本輪處理 | 追蹤 | 驗收條件 |
| --- | --- | --- | --- | --- |
| Synchronize the shared executor-fallback policy to ADL after reviewing and merging Template PR #26. | P1 | Separate PR after source PR review/merge. | Template PR #26; ADL follow-up PR to be created. | ADL file matches the merged Template snapshot SHA; its repository validation and independent review pass. |
| Execute the controlled formal cutover only in the approved Windows PowerShell maintenance window. | P1 | Not run by agent; procedure prepared. | This PR's runbook and script; existing release Issues #104/#139. | The exact main SHA and migration sequence pass; dry-run and apply readbacks match; no user/order/ledger/payment or LINE binding changes; then follow the separate Worker release gate. |

## 下一輪預防

- Trigger: before applying formal migrations or deploying the Worker. Verify the clean `main` SHA and the target D1 sequence; stop unless it is exactly at the reviewed starting point and the approved backup still represents the pre-change database.
- Run migrations, then the script's read-only preflight, then its confirmed idempotent conversion and readback, and only then deploy the Worker in the same approved maintenance window. Any mismatch or failure stops the sequence; do not hand-edit data to continue.
- Keep `AGENT_EXECUTION_NOT_RUN` separate from the existing `USER_EXECUTION_VERIFIED` backup evidence. A generated script or dry-run does not establish conversion success.
