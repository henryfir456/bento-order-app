---
name: ap-verification-core
description: Execute and report repository verification declared by agent.yaml, distinguishing PASS, FAIL, NOT RUN, and NOT VERIFIED while preserving evidence and never treating manifest commands as authorization.
metadata:
  version: "0.1.0"
---

# ap-verification-core

Use this skill after safe preflight and after the relevant change is
complete enough to verify.

## Procedure

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
5. Classify each result exactly as:
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
8. Do not deploy production, modify external services, commit, or push as
   part of verification.

## Output

Report one result per required command and one result per manual entry,
followed by the evidence and limitations. An absent result is not a
passing result.
