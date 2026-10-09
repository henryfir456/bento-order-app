# Issue #32: bounded authentication startup

## Evidence and limits

Reported incident: Android LINE first open remains at `資料處理中...` until
the page is closed and reopened. No device trace is available, so the exact
incident cause remains **NOT VERIFIED**. No LIFF endpoint/configuration change
is inferred from this report.

On baseline main `2d636a2`, executable tests running the actual App closures
and effects reproduced four failures: a permanently pending bootstrap stays
AUTH_LOADING; a return event during loading is lost; online recovery cannot
retry before LIFF exposes logged-in state; stored bind intent initiates an
automatic redirect. These are demonstrated source defects, not proof of the
Android incident's exact event sequence.

## Repair

- LIFF init has a 15-second deadline, shared concurrent initialization, and
  cache ownership. Timed-out attempts are evicted; late settlement cannot
  clear a newer attempt's cache.
- Worker requests have a 15-second deadline covering fetch and the entire
  body. Responses are buffered inside that deadline, so caller JSON/clone
  reads cannot wait on a stalled remote body. Cancellation also races shims
  that ignore AbortSignal.
- App boot has a 60-second total deadline. Force retry supersedes previous
  ownership. Each awaited production boot step and explicit guest/LINE entry
  checks ownership before changing state or local session credentials.
- Visible pageshow/focus/visibilitychange and online events coalesce during
  loading, then drain once. A persistent throttle timer drains events within
  its window using the latest callback. Registered/onboarding states do not
  repeatedly bootstrap or redirect on ordinary background returns.
- Explicit employee credentials remain preferred. Automatic recovery never
  calls Worker-path login/redirect. Binding intent is consumed before POST;
  ambiguous binding failures require explicit action rather than automatic
  POST replay. Server binding uniqueness and authorization remain unchanged.
- Formal Worker LINE profile verification has an 8-second fetch/body deadline
  and returns `503 LINE_PROFILE_TIMEOUT`, with no identity granted on timeout.
- Failure UI provides `重新連線`, preserving the selected credential and
  avoiding a forced OAuth redirect for an already logged-in user.

## Automated evidence

`tests/auth-startup-recovery.test.cjs` uses fake timers/deferred promises and
executes App's real orchestration/effects with deterministic hook storage.
The harness omits JSX/React DOM rendering; it is not a browser or real LIFF
emulator. `worker-poc/tests/line-profile-timeout.test.js` checks fetch/body
timeouts, fail-closed status, abort, and recovery.

Coverage includes duplicate init/boot, timeout/retry, late resolve/reject,
OAuth and background returns during loading, network recovery, throttle drain,
explicit guest/LINE switching, restored guest preference, binding POST
non-replay, effect cleanup/replay, stale guest rejection, and a defensive
session-invalid event. The defensive event test is injected: actual store
clears emit `guest-session-cleared`, and the current expiration reader usually
removes invalid storage before its invalid-notification check. It does not
assert that an API 401 emits `guest-session-invalid`.

Required root commands remain `node --test tests/strict-identity-ledger.test.cjs`,
`npm.cmd run lint`, `npm.cmd run build`. Additional root UI/auth and full Worker
tests are run for this change. Neither root nor Worker declares a typecheck
script: typecheck is **NOT RUN**, not a fabricated PASS.

Final automated results (Windows / Node v24.20.0):

| Check | Status | Evidence |
| --- | --- | --- |
| `node --test tests/strict-identity-ledger.test.cjs` | PASS, exit 0 | 90 tests: 87 pass, 3 existing skips |
| `npm.cmd run lint` | PASS, exit 0 | 10 existing warnings; no errors |
| `npm.cmd run build` | PASS, exit 0 | Vite production build; existing bundle-size warning |
| `npm.cmd run test:auth-recovery` / equivalent direct node command | PASS, exit 0 | 22 tests; actual App orchestration, fake timers and deferred responses |
| Worker identity/auth subset | PASS, exit 0 | 85 tests including two LINE fetch/body timeout cases |
| Additional root tests (all `tests/*.test.cjs` except required suite) | FAIL, exit 1; PRE_EXISTING_FAILURE | 111 tests: 109 pass, 2 unchanged cancel-flow source assertions fail |
| `npm.cmd test` in `worker-poc` | FAIL, exit 1; PRE_EXISTING_FAILURE | 463 tests: 456 pass, 7 unchanged formal-cleanup fixture failures |
| `git diff --check` | PASS, exit 0 | No whitespace errors |
| Independent auth/identity review | PASS | Final incremental review: no blocking findings |

The 22 new frontend cases and two new Worker cases all pass. Before the
ownership extension, the two new stale-binding/onboarding tests failed, then
passed with selection guards. The new Worker tests are registered in both
`test` and `test:formal`; the root suite is available as `test:auth-recovery`.

Baseline attribution uses an isolated `git archive` of main
`2d636a2c6a2f908bb7adc286e6e32d06f099138d` in the approved temporary directory,
with the same Node runtime. Its root tests reproduced the two failures at
`cancel-flow.test.cjs:115` and `:120`; both production submit/cancel handlers
remain byte-for-byte identical to main. The assertions expect a direct
`delegatedOrderUser?.userId` condition, while main already uses the equivalent
`isDelegatedOrder` variable. No financial code or those assertions were changed.
Other outdated release assertions were updated to validate the requested new
release while retaining historical entries and the existing Unreleased entry.

The isolated main `formal-cleanup.test.js` run reproduced the same seven
failures (11 tests: 4 pass, 7 fail), at lines 302, 341, 358, 382, 397, 421 and 481.
The local SQLite fixture reports three `sqlite_sequence` rows against the
frozen reviewed cleanup baseline of two. Cleanup scripts, tests and schema are
unchanged; they are outside startup recovery. No cleanup or D1 data mutation
was used to address this baseline debt. Full-suite commands remain FAIL;
required gates and changed-contract checks PASS with pre-existing baseline
failures recorded separately.

Verification profile: **IDENTITY_AUTH_HIGH_RISK / HIGH_RISK**. FAST is excluded
because identity/concurrency/runtime behavior changes. Start state was clean,
declared schema 2 and exact skill versions/paths were valid, and there were no
scope collisions. `tools/get-toolchain-capabilities.ps1` is absent; its probe
is NOT RUN. Read-only `Get-Command` confirmed Node, npm.cmd and Git; Node is
v24.20.0, rg and gh are unavailable. Verification uses available native tools
and the GitHub connector. No GAS-only suite is added as a production gate.

## Delivery boundary and production smoke

Deploy only the formal Worker `bento-api-poc`, with formal entry
`worker-poc/src/formalWorker.js` and D1 `bento-formal`, UUID
`e75bc185-afb5-4a5d-abc9-81bd79525cff`, from the resulting main revision.
No schema migration, data import/repair, or production D1 writes are part of
this task. Post-deploy verification is bounded to deployment/version metadata,
GET `/api/health`, unauthenticated protected GETs, and OPTIONS as appropriate.
Record actual SHA/PR/version/health evidence in the delivery handoff.

Frontend source is modified, tested and merged. **Frontend deployment is
explicitly excluded by the user**. A Worker deployment does not make these UI
changes active on the hosted frontend. Keep Issue #32 open pending real-device
acceptance and report the UI delivery boundary separately.

## Android LINE acceptance: NOT VERIFIED

After the user makes the frontend revision available through their own delivery
process, test with an approved existing account without binding or modifying
production business data:

1. First open via Android LINE; record stage and time to ready. Do not capture
   tokens, OAuth query values, LINE user IDs or user/account payloads.
2. Complete OAuth return; pageshow/focus/visible should recover without closing
   the WebView. Verify an already authenticated user is not redirected again.
3. Interrupt the network during LIFF/init and bootstrap; confirm bounded error,
   reconnect, and online recovery. Repeat with slow response bodies.
4. Background/foreground during startup; repeat rapid focus/pageshow/visible
   events. Confirm one effective boot and no repeated binding POST.
5. Compare with forced close/reopen. Verify employee entry remains selected
   when LINE is authenticated and switching to LINE selects only LINE locally.
6. Verify existing identity and read-only View As behavior with approved test
   identities. Binding uniqueness/mutation flows require a separately approved
   disposable fixture; do not use production data for negative-path testing.
