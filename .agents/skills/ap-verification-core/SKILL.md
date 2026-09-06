---
name: ap-verification-core
description: Execute and report repository verification declared by agent.yaml, including evidence-based baseline attribution and a separate defect-first review handoff.
metadata:
  version: "0.3.0"
---

# ap-verification-core

Use this skill after safe preflight and after the relevant change is
complete enough to verify. This skill produces evidence for verification;
it is not a substitute for an independent code reviewer and it does not
authorize mutation, deployment, commit, or push.

## Verification procedure

1. Read the root agent.yaml and use only commands declared under
   commands. Do not invent a replacement command or resolve dependencies
   automatically.
2. Check that every name in verification.required refers to a declared
   command. A missing command is a verification configuration failure.
3. Run deterministic verification only when the current task and
   applicable instructions authorize it. The manifest lists an entry
   point; it does not grant permission.
4. For every attempted command, record the exact command, exit status,
   material output, and affected verification name.
5. Classify each command result exactly as:
   - PASS: the command completed successfully and its output supports the
     check.
   - FAIL: the command completed unsuccessfully or the check found a
     failure.
   - NOT RUN: the command could not be started, for example because a
     tool or dependency was unavailable.
   - NOT VERIFIED: the check requires manual, device, external-service,
     production, or other evidence that was not performed.
6. Keep manual entries in verification.manual separate from automated
   results. Never report a manual or device check as PASS without its
   evidence.
7. If a required command cannot run, report the concrete reason and do
   not guess a substitute. Distinguish environment, dependency, command,
   build, test, and device failures where evidence permits.
8. Keep source, scope, security-guard, and changed-file checks tied to the
   requested change. Do not fix unrelated baseline debt merely to make the
   verification output green.
9. Do not deploy production, modify external services, commit, or push as
   part of verification.

## Baseline attribution

When a required check fails, attach exactly one attribution label in
addition to its result status:

- `NEW_FAILURE`: the failure is introduced or regressed by the current
  change, or the change affects the failing contract. Treat it as a blocker
  until resolved or explicitly accepted by the user.
- `PRE_EXISTING_FAILURE`: reliable baseline evidence shows the same failure
  before the change, current diff/source attribution does not implicate the
  change, and the post-change run shows no additional failure. It remains a
  `FAIL` command result; it may support the handoff summary
  `PASS with pre-existing baseline failure` only when every remaining
  required result is PASS and all evidence is recorded.
- `UNKNOWN_ATTRIBUTION`: baseline evidence is absent, reproduction differs,
  the diff/source relationship is ambiguous, or the environment prevents a
  reliable comparison. Do not report this as a passing verification.

For `PRE_EXISTING_FAILURE`, record the baseline result, current result,
diff or source attribution, stable reproduction details, and why the
failure is outside the requested scope. If baseline evidence was not
captured before mutation, do not infer that a failure is pre-existing from
age, familiarity, or an unrelated-looking diff; use `UNKNOWN_ATTRIBUTION`.
Report follow-up baseline debt separately rather than changing unrelated
code or tests in the current task.

## Verification and independent review

Verification answers whether the requested evidence-backed checks passed.
An independent reviewer separately looks for defects that automated
verification may miss, including requirement mismatch, architecture or
contract drift, authorization/security gaps, hidden edge cases, missing
tests, incorrect assumptions, unnecessary complexity, maintainability, and
uncovered regression risk. Reviewer work is defect-first and must not be
represented as complete merely because tests, lint, or build pass.

Use the smallest risk-appropriate review path:

- `Fast`: verification-core is normally sufficient for low-risk changes.
- `Standard`: use verification-core and add an independent review when it
  is materially useful and available.
- `High-risk`: strongly prefer an independent reviewer, and follow any
  existing policy that requires one, for authentication/authorization,
  financial logic, destructive or irreversible operations, concurrency,
  public API contracts, security-sensitive code, data integrity, and
  deployment or infrastructure changes.

When the orchestration environment supports model or provider selection,
prefer a reviewer from a different model family or provider for important
or high-risk changes. This is a preference for independent blind spots,
not a requirement to add a dependency. If diversity or an independent
reviewer is unavailable, record that fallback explicitly; do not fabricate
review evidence.

## Change-aware verification profiles

Classify the complete changed-file ledger and the risk evidence produced by
`ap-safe-preflight`. The profile is a verification decision, not an
authorization decision. Apply this precedence in order:

1. `IDENTITY_AUTH_HIGH_RISK` when authentication, identity, permissions,
   migration, data integrity, or irreversible behavior is implicated.
2. `UNKNOWN_MIXED` when a path is unrecognized, governance and runtime
   changes are mixed, or scope evidence is incomplete.
3. `FRONTEND` for `src/**`, JSX/CSS, Vite, or frontend configuration.
4. `BACKEND_GAS` for `gas/**` or backend/GAS contract files.
5. `GOVERNANCE_ONLY` for `AGENTS.md`, `README.md`/docs, `skills/**`,
   governance `tools/**`, `agent.yaml`, and `.agents/skills/**`, only when
   no runtime-impact evidence exists.

High-risk evidence overrides path-based classification. Unknown scope or a
mixed governance/runtime diff cannot be downgraded to save time.

Use these default verification depths:

| Profile | Default depth | Required behavior |
| --- | --- | --- |
| `GOVERNANCE_ONLY` | `FAST` | Scoped static, Git, shared-Skill, and release checks only |
| `FRONTEND` | `STANDARD` | Targeted tests plus applicable lint/build |
| `BACKEND_GAS` | `STANDARD` | Relevant GAS/static/contract checks |
| `IDENTITY_AUTH_HIGH_RISK` | `HIGH_RISK` | Full risk-appropriate verification and independent review |
| `UNKNOWN_MIXED` | `STANDARD` minimum | Fail closed or escalate to `HIGH_RISK`; never `FAST` |

For `GOVERNANCE_ONLY`, minimum checks are `git diff --check`, relevant
Skill/static checks, PowerShell syntax/static checks when a `.ps1` changes,
shared Skill verify/sync consistency, and immutable tag/blob equality when
applicable. Bento frontend full test, full lint, Vite build, LIFF, View As,
and GAS production checks are `NOT RUN` unless changed-file or other evidence
shows runtime impact. A skipped check is not a PASS.

## Fast-path eligibility and escalation

Select `FAST` only when every gate below passes:

- repository roots, manifest, declared paths, and the start-state ledger are
  valid and complete;
- there is no target collision, unrelated changed file, or unowned change;
- the complete scope is `GOVERNANCE_ONLY` with no runtime-impact evidence;
- no high-risk signal exists;
- release/tag sequence and canonical/consumer repository boundaries are
  valid;
- deterministic governance tools are available;
- capability probe output contains no required `UNKNOWN`; and
- prior verification contains no mismatch, unresolved classification, or
  `UNKNOWN_ATTRIBUTION`.

Record every gate as `PASS` or `FAIL`. If any gate fails, record the exact
reason and escalate from `FAST` to `STANDARD`, or to `HIGH_RISK` when
high-risk evidence is present. Escalation never bypasses authority,
collision protection, immutable-tag rules, or pre-existing-change
preservation.

## Capability and profile handoff

The completion handoff must report the selected profile and depth, the
changed-file and risk summary, every fast-path gate and result, and the
exact read-only capability probe command, exit status, and concise output.
It must list scoped checks that ran and profile-excluded checks as `NOT RUN`
with their reasons, and include the escalation reason whenever `FAST` was
not eligible. Use `tools/get-toolchain-capabilities.ps1` for deterministic
capability discovery; it reports capability only and does not run test,
lint, build, release, or deployment commands. On Windows, declared `npm`
commands must select `npm.cmd` when available without trying `npm.ps1`
first. Missing optional `python` or `py` must be reported once as
`UNAVAILABLE`, with no trial execution.

For `GOVERNANCE_ONLY` / `FAST`, profile-excluded runtime checks may be
compressed into one handoff line, for example: `Profile-excluded runtime
checks: NOT RUN — GOVERNANCE_ONLY/FAST, no runtime-impact evidence
(frontend full test/lint/build, LIFF, View As, GAS production checks).`
This compression applies only to excluded checks; every required check that
ran and every failure still needs its own result and evidence.

## Handoff contract

For every bounded governance or maintenance task, the final handoff must
be self-contained and include these sections:

- `Status / outcome`: state whether the task is complete, blocked, or
  partial, with a concise reason.
- `Changed files`: list changed repository-relative paths, grouped by
  repository; write `none` when there is no diff.
- `Verification evidence`: include one result for every required command
  and manual entry, with exact commands, exit statuses, material evidence,
  limitations, and an attribution label for every failure.
- `Independent review`: report the review status and findings separately
  from automated and manual verification.
- `Pre-existing changes preserved / collisions`: state which pre-existing
  changes were preserved and report direct collisions, or explicitly state
  `none`.
- `Commit status`: report whether each affected repository is committed.
  If an uncommitted diff remains, include at least one suggested
  Conventional Commit title derived from the actual diff. If no diff
  remains, write `no commit needed`. If changes were committed, include the
  actual full commit SHA and commit message.
- `Tag status / release ref`: when applicable, report the tag or release
  ref, resolved source commit, and whether a new immutable local tag was
  created; otherwise write `not applicable`.
- `Push status`: explicitly state whether commits or tags were pushed.
- `Deploy status`: explicitly state whether anything was deployed.
- `Remaining follow-up / debt`: list unresolved verification, release or
  sync limitations, baseline debt, and other bounded follow-up; write
  `none` when there is no remaining item.

When a task spans canonical and consumer repositories, report each
repository's commit boundary separately. Provide a separate suggested
commit title for every repository that still has uncommitted changes.

The completion handoff is a reporting contract only. It does not authorize
mutation, commit, tag creation, push, or deploy; authority remains defined
by the applicable repository `AGENTS.md` and the current user request.

Suggested titles are recommendations only. Verification never performs
`git add`, `git commit`, or `git push`.

## Output

Report one result per required command and one result per manual entry,
followed by evidence, attribution, reviewer status, and limitations. Keep
automated and manual verification separate. An absent result is not a
passing result.
