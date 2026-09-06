# Bootstrap Timing Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add correlated, safe Phase 3 bootstrap timing observability across the React/LIFF frontend and GAS backend without adding runtime work beyond clock and log operations.

**Architecture:** Centralize the frontend production-safe allowlist in a pure timing logger and the backend allowlist in a GAS utility helper. Thread one generated `bootId` through the existing bootstrap POST and response, and use the existing App state commit boundary plus GAS `finally` timing block to emit milestones and metrics.

**Tech Stack:** React 19, Vite, browser `performance.now()`, Google Apps Script JavaScript, Node test runner, Oxlint.

**Spec:** `docs/superpowers/specs/2026-09-06-bootstrap-timing-observability-design.md`

## Global Constraints

- Production frontend timing payloads may contain only `bootId` via the fixed prefix, `status`, `fallback`, `milestone`, `metric`, and `durationMs`; no auth, identity, response, or exception data.
- Preserve authenticated identity, View As identity, effective identity, LIFF authentication, access-token, GAS authorization, and Google Sheets contracts.
- Do not add any API request, retry, Sheet read, cache access, React state, or other observable side effect for instrumentation.
- Preserve the existing `INVALID_ACTION` legacy fallback and mark it as `status=fallback` with the original boot id.
- Backend performance metrics are `BOOTSTRAP_TOTAL_MS`, `LINE_PROFILE_MS`, `USER_LOOKUP_MS`, `SETTINGS_MS`, `LIKES_MS`, `ANNOUNCEMENTS_MS`, `ORDERS_MS`, and `CALENDAR_MS`.
- Frontend milestones are `BOOT_START`, `LIFF_INIT_START`, `LIFF_INIT_END`, `BOOTSTRAP_REQUEST_START`, `BOOTSTRAP_REQUEST_END`, `BOOTSTRAP_STATE_READY`, and `BOOT_READY`.
- Frontend metrics are `LIFF_INIT_MS`, `BOOTSTRAP_NETWORK_MS`, `STATE_APPLY_MS`, and `BOOT_TOTAL_MS`.
- Status values are exactly `success`, `error`, and `fallback`.
- Do not commit, push, deploy, or modify external services unless the user explicitly requests it.

---

### Task 1: Add the frontend correlated timing logger

**Files:**
- Create: `src/observability/bootTiming.js`
- Modify: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- Produces `createBootId()`, `getPerformanceNow()`, and `createBootTimingLogger(bootId, logger)`.
- `createBootTimingLogger` returns `{ milestone(name), metric(name, durationMs, status, fallback) }`.
- The logger emits `[PERF][BOOT][<bootId>] frontend <JSON>` through `logger.info` and ignores unknown names or logger failures.

- [ ] **Step 1: Add failing logger contract tests**

Add a Node test that dynamically imports `src/observability/bootTiming.js`, captures `logger.info` calls, and asserts the exact allowlist behavior:

```js
test('frontend boot timing logger emits only the Phase 3 allowlist', async () => {
  const { createBootTimingLogger } = await import(pathToFileURL(
    path.join(__dirname, '..', 'src', 'observability', 'bootTiming.js')
  ).href);
  const lines = [];
  const timing = createBootTimingLogger('BOOT-20260906-abc123', {
    info(message) {
      lines.push(message);
    }
  });

  timing.milestone('BOOT_START');
  timing.metric('LIFF_INIT_MS', 12.345, 'success', false);
  timing.milestone('NOT_ALLOWED');
  timing.metric('SECRET_MS', 99, 'success', false);

  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\\[PERF\\]\\[BOOT\\]\\[BOOT-20260906-abc123\\] frontend /);
  assert.deepEqual(JSON.parse(lines[0].split(' frontend ')[1]), { milestone: 'BOOT_START' });
  assert.deepEqual(JSON.parse(lines[1].split(' frontend ')[1]), {
    status: 'success',
    fallback: false,
    metric: 'LIFF_INIT_MS',
    durationMs: 12.3
  });
  assert.doesNotMatch(lines.join('\\n'), /accessToken|Authorization|userId|displayName|response|Error|stack/i);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/strict-identity-ledger.test.cjs`

Expected: FAIL because `src/observability/bootTiming.js` does not yet exist.

- [ ] **Step 3: Implement the allowlisted logger**

Implement the module with these exact rules:

```js
const MILESTONES = new Set([
  'BOOT_START', 'LIFF_INIT_START', 'LIFF_INIT_END',
  'BOOTSTRAP_REQUEST_START', 'BOOTSTRAP_REQUEST_END',
  'BOOTSTRAP_STATE_READY', 'BOOT_READY'
]);
const METRICS = new Set([
  'LIFF_INIT_MS', 'BOOTSTRAP_NETWORK_MS', 'STATE_APPLY_MS', 'BOOT_TOTAL_MS'
]);
const STATUSES = new Set(['success', 'error', 'fallback']);
```

Round finite durations to one decimal place, copy only allowlisted properties
into the JSON object, and wrap `logger.info` in a `try/catch` with no error
logging. Generate ids with `Date.now()` and six lower-case base36 characters.

- [ ] **Step 4: Re-run the focused test**

Run: `node --test tests/strict-identity-ledger.test.cjs`

Expected: PASS for the new logger test and PASS for the unchanged baseline tests.

### Task 2: Instrument the App bootstrap waterfall

**Files:**
- Modify: `src/App.jsx:1-375`
- Modify: `src/api/mockGasApi.js:1-75`
- Modify: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- `initLiffAndFetchData` creates one boot id per invocation and passes it to the existing `getBootstrapData` POST.
- `fetchBootstrapData(accessToken, bootId)` adds only `{ bootId }` to the existing request payload.
- A ref-backed render record contains `{ bootId, startedAt, stateApplyStartedAt, status, fallback }` and is consumed once by a post-commit effect.

- [ ] **Step 1: Add failing source-contract assertions**

Extend the frontend bootstrap source test to assert `createBootId`, the seven milestone names, the four metric names, `bootId` in the bootstrap payload, and a post-commit `BOOT_READY` path. Keep the existing assertions that only `INVALID_ACTION` enters legacy startup and that the normal branch does not call the legacy calendar/orders requests.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/strict-identity-ledger.test.cjs`

Expected: FAIL on the newly asserted timing wiring.

- [ ] **Step 3: Wire the timing module into App**

Import `createBootId`, `getPerformanceNow`, and `createBootTimingLogger`. Replace only the bootstrap-specific top-level timing calls with the new logger while retaining the existing independent timings used by non-bootstrap actions.

At startup, emit `BOOT_START`; around `authClient.init()` emit `LIFF_INIT_START`, `LIFF_INIT_END`, and `LIFF_INIT_MS`; around the existing bootstrap plus legacy fallback request emit `BOOTSTRAP_REQUEST_START`, `BOOTSTRAP_REQUEST_END`, and `BOOTSTRAP_NETWORK_MS`. Do not add a fetch or alter the fallback condition.

After the existing identity/calendar/order state setters, store the render record in a ref. Add an effect that waits for the existing non-loading auth state commit, emits `BOOTSTRAP_STATE_READY`, `STATE_APPLY_MS`, `BOOT_READY`, and `BOOT_TOTAL_MS`, then clears the ref. Error and auth-required exits emit the final error metric in the existing `finally` path. Mark a legacy fallback with `status='fallback'` and `fallback=true`; mark registered and unregistered normal results with `status='success'`.

- [ ] **Step 4: Update the mock bootstrap response without changing mock identity fixtures**

In `createMockGasApi().post`, return a shallow copy of `getMockIdentityResponse(mockUser)` with `bootId: payload.bootId` for `getBootstrapData`. Leave `getMockIdentityResponse` itself unchanged so its existing identity-shape test remains valid.

- [ ] **Step 5: Run focused tests and lint**

Run: `node --test tests/strict-identity-ledger.test.cjs`

Expected: PASS with no new failures.

Run: `npm.cmd run lint`

Expected: exit 0; existing warnings may remain, but no new error is permitted.

### Task 3: Add correlated GAS bootstrap timing and response propagation

**Files:**
- Modify: `gas/Utils.gs:77-105`
- Modify: `gas/Bootstrap.gs:1-100`
- Modify: `gas/Code.gs:38-65`
- Modify: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- Produces `resolveBootId(rawBootId)` and `logBootstrapTiming(bootId, metric, elapsedMs, status)` in `gas/Utils.gs`.
- `getBootstrapData(accessToken, targetDateStr, bootId)` returns the same response fields as before plus top-level `bootId`.
- `doPost` passes the request boot id into bootstrap and attaches it to safe bootstrap errors.

- [ ] **Step 1: Add failing GAS contract tests**

Extend the bootstrap tests with these assertions:

```js
const result = JSON.parse(output.text);
assert.equal(result.bootId, 'BOOT-20260906-abc123');
const perfLines = gas.__logs.filter(line => line.includes('[PERF][BOOT][BOOT-20260906-abc123] backend'));
assert.ok(perfLines.some(line => line.includes('"metric":"LINE_PROFILE_MS"')));
assert.ok(perfLines.some(line => line.includes('"metric":"USER_LOOKUP_MS"')));
assert.ok(perfLines.some(line => line.includes('"metric":"ORDERS_MS"')));
assert.ok(perfLines.some(line => line.includes('"metric":"BOOTSTRAP_TOTAL_MS"')));
assert.doesNotMatch(perfLines.join('\\n'), /access-token|user-id|LINE Profile Name|Authorization/i);
```

Add an invalid-token test that posts `{ action: 'getBootstrapData', accessToken: 'secret-token', bootId: 'BOOT-20260906-error1' }`, asserts the safe LINE error plus the same top-level boot id, and asserts the backend timing lines use `status: "error"` without the secret.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/strict-identity-ledger.test.cjs`

Expected: FAIL because the current GAS response has no boot id and emits uncorrelated `[PERF]` lines.

- [ ] **Step 3: Implement safe GAS correlation helpers**

In `gas/Utils.gs`, validate the generated shape before using an id in a log prefix, generate a replacement using `Date.now()` and a sanitized `Utilities.getUuid()` fragment when needed, and serialize only these keys: `status`, `fallback` when supplied, `milestone` when supplied, `metric`, and rounded `durationMs`. Use the existing `console.info`/`console.log` fallback chain so the test harness and Apps Script execution log both capture the line.

- [ ] **Step 4: Instrument the existing Bootstrap boundaries**

Pass the resolved boot id into `getBootstrapData`. Measure the existing `getLineProfile`, Users lookup, Settings read, Likes read, Announcements helper, Orders read/map, and Calendar computation boundaries. In the existing `finally`, derive `success` from the final result and log the eight allowlisted metrics with `status='success'` or `status='error'`. Keep zero for stages that did not start and keep all existing Sheet reads exactly once.

- [ ] **Step 5: Propagate the id through `doPost`**

For `getBootstrapData`, resolve `data.bootId`, call `getBootstrapData(data.accessToken, data.targetDate, resolvedBootId)`, and ensure the catch path returns `identityError(code)` plus the same top-level `bootId`. Do not add the field to unrelated action responses.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/strict-identity-ledger.test.cjs`

Expected: PASS, including secret-redaction and one-read bootstrap tests.

### Task 4: Document capture and verify the complete contract

**Files:**
- Create: `docs/performance/bootstrap-timing-observability.md`
- Modify: `tests/strict-identity-ledger.test.cjs`

**Interfaces:**
- Documentation names the exact log prefixes, allowlists, timing model, capture workflow, and verification limitations.
- Tests provide local evidence only; real LIFF, View As, and production GAS remain manual/not verified.

- [ ] **Step 1: Add the operator capture document**

Document the waterfall in this exact order:

```text
BOOT_START
LIFF_INIT_START -> LIFF_INIT_END / LIFF_INIT_MS
BOOTSTRAP_REQUEST_START -> BOOTSTRAP_REQUEST_END / BOOTSTRAP_NETWORK_MS
backend: LINE_PROFILE_MS, USER_LOOKUP_MS, SETTINGS_MS, LIKES_MS,
         ANNOUNCEMENTS_MS, ORDERS_MS, CALENDAR_MS, BOOTSTRAP_TOTAL_MS
BOOTSTRAP_STATE_READY / STATE_APPLY_MS
BOOT_READY / BOOT_TOTAL_MS
```

Include one safe frontend example, one safe backend example, Chrome Console
filter instructions, GAS Execution log correlation by boot id, and the exact
meaning of `success`, `error`, and `fallback`. Explicitly state that no token,
Authorization value, LINE user id, display name, payload, or raw exception is
expected in these lines.

- [ ] **Step 2: Add contract tests for mock parity and instrumentation invariants**

Assert the mock `getBootstrapData` response echoes the supplied boot id. Add
source assertions that `getBootstrapData` is called once with `bootId`, that
the normal startup branch still applies `identity.calendar` and
`identity.ordersMap`, and that instrumentation does not introduce another
`gasPost`/`gasGet` call in the bootstrap path.

- [ ] **Step 3: Run the full required verification**

Run: `node --test tests/strict-identity-ledger.test.cjs`

Expected: exit 0 with all tests passing.

Run: `npm.cmd run lint`

Expected: exit 0; record any existing warnings separately.

Run: `npm.cmd run build`

Expected: exit 0 with Vite producing the production bundle.

- [ ] **Step 4: Run read-only diff checks and review the changed-file ledger**

Run: `git diff --check`

Expected: exit 0 with no whitespace errors.

Run: `git status --short` and `git diff --stat`

Expected: only the Phase 3 source, test, and documentation files are changed;
pre-existing changes remain preserved (the start state is clean).

- [ ] **Step 5: Report manual verification separately**

Report `NOT VERIFIED` for real LIFF authentication, View As and identity flow,
and GAS deployment/production contract unless external evidence is supplied.
Do not claim production timing capture from local tests.
