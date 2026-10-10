# Repository convergence evidence — 2026-10-10

## Scope and authorization

User decision at 13:32:23 UTC: retain and merge only Issue #36 feasibility research; close implementation PR #38/#39 without merging, close Issue #36 as Not planned, verify historical merges and preserve uncertain/unique work. No Worker/frontend deployment, formal migration, production D1 data mutation, third-party login/API/contact, real order/payment or new credentials.

Start: `feature/36-vendor-order-ui` at `cc4ae1d7c176e8d64a7566ded85cad4076a7a9fe`, clean working tree; main/origin/main `5dd8667360f522c012a338641bd7ec584dab1ef4`, version 0.15.15. `git fetch origin --prune` succeeded. No pre-existing staged, unstaged or untracked changes and no collisions. Other worktree files/processes and project-mech-grid are untouched.

## Governance and verification profile

Read root `AGENTS.md`, `agent.yaml`, `PROJECT_STATE.md`, `DECISIONS.md` and exactly the declared repo-local skills: ap-safe-preflight 0.2.0 and ap-verification-core 0.4.0, shared source agent-platform v0.7.0. Manifest schema 2 and declared fields/required command order are valid; declared paths are repo-relative directories without reparse points. Only root AGENTS.md is tracked. No shared skill/governance configuration is changed.

Changed files in the research PR: `docs/vendor-orders-p0.md`, this evidence file, `PROJECT_STATE.md`, `CHANGELOG.md`. No source, tests, package/version, schema or runtime files change. Profile **GOVERNANCE_ONLY / STANDARD**; FAST is ineligible because the prescribed `tools/get-toolchain-capabilities.ps1` is missing (NOT RUN). Fallback read-only probe `Get-Command node,npm.cmd,git | Format-List Name,Source; git version; node --version` exited 0: Node v24.20.0, Git 2.55.0.windows.3, node/npm.cmd/Git in installed program directories. No dependency installation or new credential.

FAST gates: roots/manifest/paths/start ledger PASS; collisions/unowned changes PASS; governance-only/no runtime impact PASS; no runtime high-risk signal PASS; release/tag/repo boundaries PASS (no new release/tag); deterministic probe availability FAIL (missing prescribed script); complete probe output FAIL for that unavailable entry; prior classification/baseline consistency PASS. Escalate to STANDARD; this does not bypass safety or authority.

## Automated evidence

Declared order was executed on research head d2b5e8b7 before the document-only convergence edits:

| Command | Exit | Result |
| --- | --- | --- |
| `node --test tests/strict-identity-ledger.test.cjs` | 0 | PASS: 90 total, 87 passed, 3 existing skips |
| `npm.cmd run lint` | 0 | PASS: existing unused-variable/escape warnings |
| `npm.cmd run build` | 0 | PASS: existing >500 kB bundle warning |
| `git diff --check` | 0 | PASS after document edits; only normal LF/CRLF warning |
| `git diff --exit-code origin/main -- src worker-poc tests package.json package-lock.json agent.yaml AGENTS.md .agents` | 0 | PASS: exact runtime/schema/test/governance equality to baseline main |
| `node --test tests/changelog-migration.test.cjs` | 0 | PASS: 2/2 after edits; original released and Unreleased parsed history preserved |
| PowerShell `$testFiles=@(Get-ChildItem tests -Filter *.test.cjs \| ForEach-Object FullName); node --test $testFiles` | 1 | FAIL / PRE_EXISTING_FAILURE: 223 total, 218 pass, 2 fail, 3 skipped after edits |
| `npm.cmd test` in `worker-poc` | 1 | FAIL / PRE_EXISTING_FAILURE: 469 total, 462 pass, 7 fail on unchanged Worker files |

Reliable pre-change baseline captured during the preceding Issue #36 preflight on the same main revision/runtime: root 223 total/218 pass/2 fail/3 skipped, Worker 469 total/462 pass/7 fail. Current root failures are the same `cancel-flow.test.cjs:115/120` stale direct delegated-user regex assertions; current Worker failures are the same `formal-cleanup.test.js:302/341/358/382/397/421/481` inventory comparisons (`sqlite_sequence` 3 vs 2). No additional failure and no diff touching those contracts. Baseline debt is retained, not hidden/fixed by this documentation change.

Local logs: `%TEMP%/bento-convergence-identity.log`, `bento-convergence-lint.log`, `bento-convergence-build.log`, `bento-convergence-root-after.log`, `bento-convergence-worker-before.log`; prior baselines `%TEMP%/bento-issue36-root-baseline.log` and `bento-issue36-worker-baseline.log`. Typecheck NOT RUN (no declared script). No GAS runtime change or mandatory GAS-only gate.

GitHub combined statuses and workflow runs for original research head are empty, and `git ls-tree -r --name-only HEAD .github` finds no workflow. CI is **NOT RUN / no defined applicable workflow**, not PASS. Local tests do not establish CI. The old integration branch's workflow triggers only that branch and is not installed/enabled on main by this convergence.

The first optional full-root process launch failed with `exec-server transport disconnected`; two other concurrent read/test launches hit automatic permission-review deadlines. No unsafe-action rejection occurred. Each deadline was retried once as permitted; read inventory and Worker tests then ran. Final root checks also ran. No ACL/sandbox change or alternate credentials; no MXC prelaunch retry.

## PR, Issue and branch disposition

- PR #37: research-only merge candidate; effective decision explicitly supersedes historical GO/internal plan and keep-Issue-open text. Preserve original dated evidence and restart conditions. Exact new head/merge SHA is recorded in GitHub and the final handoff.
- PR #38 closed/unmerged: preserve `feature/36-vendor-order-core` at `298d330f98f85e541cb82c6487c3312169464b2d`, including initial implementation `d2b701471cf769dbda7504f81d9339bec2e316b5`.
- PR #39 closed/unmerged: preserve `feature/36-vendor-order-ui` at `cc4ae1d7c176e8d64a7566ded85cad4076a7a9fe`.
- Issue #36 closed with `state_reason=not_planned`; official order-create permissions and browser/sandbox acceptance absent. No feature completion/production claim.
- Issue #32/#34 remain OPEN for real platform/device acceptance; comments record their already-merged heads. Issue #5 remains OPEN: pure-helper extraction is only partial decomposition, not completion.

| Historical local branch | Original head / merged revision | Evidence and action |
| --- | --- | --- |
| `fix/34-canonical-line-binding` | `50c8a8f82ed56e1241ca7daa06f918559aeba232` / `5dd8667360f522c012a338641bd7ec584dab1ef4` (PR #35) | Identical tree `32eb76ec3e3e1efc3fcef8613bdc8219fb266507`; git cherry marks equivalent. Normal `git branch -d` refuses non-ancestral squash head; retain, no force. |
| `fix/32-liff-startup-recovery` | `4171837b08da08c6a2ff890decf2d060fd7c1e94` / `a71d9bfa90d76093e74c6a8d58d4f89cb0b0436f` (PR #33) | Identical tree `c219adaa2d4b19830ca13234ccbafdafbbec5ed3`; git cherry equivalent. Normal deletion refused; retain, no force. |
| `fix/canonical-legacy-identity` | `23a27cbe2d9b09782371e53ead170c5495c37d7f` / `ef22218ec75fa9f157920d206137702bd77f4ad9` (PR #30) | Identical tree `4bd9b3da6580d8eca42f78d67a3676ad05a5cc64`; intermediate cherry entries differ, so endpoint tree/merged PR evidence is used. Normal deletion refused; retain, no force. |
| `fix/issue-23-taipei-month-filter` | `1c18c512f32fd503db001c00f68c0b19ad442cd7` / `d9a6fa875705ad460771ae01421badba4303f907` (PR #27) | Ancestor of main; matching merged tree `59b8af24f5228bd3ada6b401eaaac82f5dc39bfd`. Still checked out by another clean Temp worktree; preserve. |
| `test/integration-issues-1-2-4-5` | `35dae8c19ed9a64e0677dd9454a56d4ef54e7796` | Main comparison 82 behind/22 ahead; most commits patch-equivalent. Unique non-merge commit `851107a62f207868db636b550d4db85d75e0d49f` adds branch-only CI workflow. Preserve; no claim all unique work is superseded. |

Specified five historical remote branches were already absent at the start and fetch pruned their stale remote-tracking refs; **none was remotely deleted by this batch**. Remaining remote refs at start: main, P0 spike, core and UI. Keep P0 history as well as the two paused implementation branches. No duplicate merge of PR #35/#33/#30/#27.

`git worktree list --porcelain` found this checkout, the clean Temp issue23 worktree, and a clean detached bento-identity worktree at ef22218 in Documents. Their files, branch ownership and processes are not changed.

## Review, manual boundary and follow-up

Independent delegating-thread read-only review confirmed four merged PR trees and identified the outdated P0 GO/open-Issue language; the superseding decision resolves that finding. Primary-agent inspection additionally found the integration workflow unique commit and preserved it. Final document review/merge evidence is reported in PR #37 and final handoff; no new independent executable pass is claimed.

Real LIFF authentication, View As/platform behavior, hosted frontend availability, Worker deployment, production D1/migrations and merchant/browser/sandbox acceptance: **NOT VERIFIED** in this batch. Deployment is explicitly NOT RUN. No release tag or version bump (0.15.15 unchanged). Remaining debt: 2 root/7 Worker baseline failures, missing capability script, pending platform acceptance, paused integration authorization and preserved historical refs/worktree ownership. Final fetch/main fast-forward/clean-tree evidence is a separate final Git step, not assumed here.
