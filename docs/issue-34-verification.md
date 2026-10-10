# Issue #34 verification — v0.15.15

Date: 2026-10-10. Base: `a71d9bfa90d76093e74c6a8d58d4f89cb0b0436f`.
Profile: `IDENTITY_AUTH_HIGH_RISK` / `HIGH_RISK`.
Manifest schema 2 and exact repository-declared preflight/verification skills validated.
Initial working tree was clean; no pre-existing changes or collisions.

## Diagnosis and scope

- Issue #1's permanent LINE-first binding already exists on main; this task preserves its conditional writes, readback, uniqueness and conflict behavior.
- Issue #34 has separate reproducible projection/session defects: Header inferred binding from employee login mode; Worker responses lacked explicit canonical `lineBound`; successful LINE-first binding retained an older guest credential; real expired/rejected guest notifications did not clear the registered UI.
- Member `authSource` is a projection, not a reliable current-channel or binding label. Header/member cards now share explicit bound/unbound/unknown semantics; registered guest binding is offered only for confirmed unbound state.
- Registered foreground reads are bounded to 15 seconds across headers/body, coalesced, and owned by selection/credential. They never replay binding or redirect. Reads preserve newer profile/financial values and valid View As; authentication/role/eligibility changes revoke protected UI state.
- Employee sessions expose binding as a boolean without the persisted LINE identifier and retain guest permissions. No schema, production D1, binding mutation implementation, or legacy GAS changes.
- Reported Windows local LINE failure has no platform trace/screenshot available here. The reproduced session defects are evidence; LIFF endpoint/local-origin/SDK platform behavior remains a hypothesis, not a proven incident cause.

## Automated verification

| Command | Exit | Result / evidence |
| --- | --- | --- |
| `node --test tests/strict-identity-ledger.test.cjs` | 0 | PASS: 90 total, 87 pass, 3 skip |
| `npm.cmd run lint` | 0 | PASS: existing warnings; no new hook warning |
| `npm.cmd run build` | 0 | PASS: Vite build; bundle-size advisory |
| `node --test tests/line-binding-state.test.cjs tests/auth-startup-recovery.test.cjs worker-poc/tests/line-binding-state.test.js` | 0 | PASS: 50/50 (22 new UI/session cases, 6 new Worker cases, 22 existing startup cases) |
| `node --test` with every `tests/*.test.cjs` path | 1 | FAIL / PRE_EXISTING_FAILURE: 223 total, 218 pass, 2 fail, 3 skip |
| `npm.cmd test` in `worker-poc` | 1 | FAIL / PRE_EXISTING_FAILURE: 469 total, 462 pass, 7 fail |
| `git diff --check` | 0 | PASS |
| typecheck | — | NOT RUN: neither package declares a typecheck script |
| `tools/get-toolchain-capabilities.ps1` | — | NOT RUN: probe absent; Node/npm/Git availability independently confirmed |

Required verification ran in declared strict → lint → build order. New failing tests were executed first: 13/13 failed on the unchanged implementation before fixes. Subsequent review added timeout, mutation-readback, typed API 401, missing/throwing token, role revocation, live guest projection and View As cases.

Root baseline captured before source mutation: 201 total / 196 pass / same 2 fail / 3 skip. Failures are `tests/cancel-flow.test.cjs:115,120`, stale regex expectations for the delegated condition; cancellation behavior is outside this diff.

Worker baseline captured before source mutation: 463 total / 456 pass / same 7 fail. Failures are `tests/formal-cleanup.test.js:302,341,358,382,397,421,481`, fixture inventory expectations versus SQLite metadata. Cleanup code/fixtures are unchanged. An additional exact `/api/me` assertion initially failed because the new contract adds `lineBound:false`; its expectation was updated and the failure removed. Neither full-suite command is reported as fully green.

Local logs are retained in Windows TEMP as `bento-issue34-{root-baseline,worker-baseline,red-tests,strict,lint,build,targeted-final,root-final,worker-final}.log`.

## Independent review

PASS: independent auth reviewer found no blocking issue after fixes and re-review. Reproduced findings were addressed with code and tests: old refresh overwriting new balance/profile, typed 401 leaving stale UI, absent/throwing token, and role revocation retaining View As. Reviewer did not write files or call production services. Same model-family review; no diversity claim.

## Manual / external verification and delivery boundary

- Real LIFF authentication, Windows external/local LINE OAuth, Android LINE: NOT VERIFIED.
- Real View As and identity flow: NOT VERIFIED; local actor/subject fixtures PASS.
- Worker deployment and remote D1 production contract: NOT VERIFIED; not performed by explicit instruction.
- Frontend deployment: NOT RUN by standing instruction.
- Merge-to-main is authorized; formal Worker and frontend deployment are expressly excluded for this task. Local build/merged code does not prove the UI/API change is live. Issue #34 remains open pending platform acceptance/deployment evidence.
- No production users, bindings, orders, topups or ledger data were modified. Only disposable local SQLite fixtures exercise mutations.
- Remaining follow-up: real Windows/Android LINE acceptance, deliberately excluded deployment, and unrelated baseline test debt.
