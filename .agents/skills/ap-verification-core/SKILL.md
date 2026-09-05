---
name: ap-verification-core
description: Execute and report repository verification declared by agent.yaml, including evidence-based baseline attribution and a separate defect-first review handoff.
metadata:
  version: "0.1.1"
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

## Handoff contract

The final verification handoff should include:

- one result for every required command and manual entry;
- exact commands, exit statuses, material evidence, and limitations;
- attribution labels for every failure;
- independent-review status and findings as a separate section;
- scope or baseline-debt follow-up items; and
- one suggested Conventional Commit title derived from the actual diff,
  or multiple titles when the diff contains multiple bounded changes.

Suggested titles are recommendations only. Verification never performs
`git add`, `git commit`, or `git push`.

## Output

Report one result per required command and one result per manual entry,
followed by evidence, attribution, reviewer status, and limitations. Keep
automated and manual verification separate. An absent result is not a
passing result.
