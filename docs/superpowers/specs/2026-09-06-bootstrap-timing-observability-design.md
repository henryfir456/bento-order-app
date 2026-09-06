# Bootstrap Timing Observability Design

## Goal

Add Phase 3 bootstrap timing observability to the Bento Order System so one
startup can be correlated across the React frontend and Google Apps Script
backend with a shared `bootId`, without changing the number of API requests,
Sheet reads, identity semantics, or business responses beyond the documented
top-level `bootId` field on `getBootstrapData` responses.

## Scope and non-goals

In scope:

- Generate one `BOOT-<timestamp>-<short random>` identifier per App startup.
- Log the approved frontend milestones and duration metrics with
  `performance.now()`.
- Send the same `bootId` in the existing `getBootstrapData` POST and return it
  at the top level of every bootstrap response, including safe errors.
- Log backend bootstrap stages at existing LINE, Users, Settings, Likes,
  Announcements, Orders, and Calendar boundaries with `Date.now()`.
- Make success, unregistered, legacy fallback, LIFF failure, network failure,
  backend exception, and LINE Profile error paths observable.
- Keep production frontend logs restricted to the explicit allowlist and keep
  auth/debug diagnostics under the existing DEV-only or safe logging policy.
- Add static and contract tests plus capture documentation.

Out of scope:

- Any new request, retry, Sheet read, cache, API endpoint, authentication
  behavior, View As behavior, calendar behavior, order behavior, or deployment.
- Logging access tokens, Authorization headers, LINE identifiers, display
  names, raw API bodies, response payloads, or raw exception text/stack traces.
- Optimizing the measured stages. Phase 3 measures; Phase 4 may act on the
  captured data.

## Existing context

`src/App.jsx` already uses `performance.now()` for several independent
diagnostic timings and calls `getBootstrapData` before its legacy
`getUserInfo`/calendar/orders fallback. `gas/Bootstrap.gs` already reads the
startup Sheets once and has per-stage elapsed variables, while `gas/Utils.gs`
has an uncorrelated `[PERF]` logger. Phase 3 will centralize only the new
correlated log shape and leave unrelated diagnostics intact.

## Frontend design

Create a small `src/observability/bootTiming.js` module with these public
responsibilities:

- `createBootId()` returns `BOOT-${Date.now()}-${six lower-case base36 chars}`.
- `getPerformanceNow()` returns `performance.now()` when available and
  otherwise `Date.now()`.
- `createBootTimingLogger(bootId, logger = console)` exposes `milestone(name)`
  and `metric(name, durationMs, status, fallback)`. It emits one line only
  when the name is in the allowlist and catches logger failures so
  instrumentation cannot interrupt startup.

The logger emits this grep-friendly format:

```text
[PERF][BOOT][BOOT-...] frontend {"milestone":"BOOT_START"}
[PERF][BOOT][BOOT-...] frontend {"metric":"LIFF_INIT_MS","durationMs":123.4}
[PERF][BOOT][BOOT-...] frontend {"status":"success","fallback":false,"metric":"BOOT_TOTAL_MS","durationMs":1180.0}
```

The only frontend milestones are `BOOT_START`, `LIFF_INIT_START`,
`LIFF_INIT_END`, `BOOTSTRAP_REQUEST_START`, `BOOTSTRAP_REQUEST_END`,
`BOOTSTRAP_STATE_READY`, and `BOOT_READY`. The only frontend metrics are
`LIFF_INIT_MS`, `BOOTSTRAP_NETWORK_MS`, `STATE_APPLY_MS`, and
`BOOT_TOTAL_MS`. The only statuses are `success`, `error`, and `fallback`.
Production payloads contain only `status`, `fallback`, `milestone`, `metric`,
and `durationMs`; `bootId` is carried only in the fixed log prefix.

`App` creates the boot logger at the start of `initLiffAndFetchData`. It logs
`BOOT_START`, wraps the existing LIFF init, and wraps the existing bootstrap
request plus any already-existing legacy fallback request in the network
interval. The POST payload gains only `bootId`.

For a successful or unregistered startup, App stores a render-pending record
in a ref and uses an existing React effect after the state commit to emit
`BOOTSTRAP_STATE_READY`, `STATE_APPLY_MS`, `BOOT_READY`, and `BOOT_TOTAL_MS`.
This measures the existing state/render boundary without adding state or a
request. For auth-required and error exits, the final `BOOT_TOTAL_MS` is
emitted from the existing completion path with `status=error`. A legacy
startup is marked `status=fallback` and `fallback=true` while preserving the
current `INVALID_ACTION` branch and its existing request behavior.

The pre-existing uncorrelated frontend `[PERF]` diagnostics remain available
in DEV only. Production startup performance output is therefore limited to
the new `[PERF][BOOT]` allowlisted lines.

## Backend design

Add a GAS helper in `gas/Utils.gs` that accepts only a validated boot id,
status, metric, and duration, then emits:

```text
[PERF][BOOT][BOOT-...] backend {"status":"success","metric":"ORDERS_MS","durationMs":180}
```

The backend metric allowlist is `BOOTSTRAP_TOTAL_MS`, `LINE_PROFILE_MS`,
`USER_LOOKUP_MS`, `SETTINGS_MS`, `LIKES_MS`, `ANNOUNCEMENTS_MS`, `ORDERS_MS`,
and `CALENDAR_MS`. Invalid or missing ids are replaced by a server-generated
safe id before they reach logs or responses. The helper emits no token,
identity, response, or exception data.

Change `getBootstrapData(accessToken, targetDateStr, bootId)` to measure the
existing boundaries with its current `Date.now()` timers. The function returns
the resolved `bootId` at the top level on registered and unregistered results.
`doPost` resolves the id before dispatch, passes it into bootstrap, and adds it
to safe bootstrap errors caught at the request boundary. Existing data fields
and authentication flow remain unchanged.

The final backend status is `success` for registered and unregistered
bootstrap results and `error` for LINE, Sheet, calendar, or exception failures.
Every stage is logged in the existing `finally` block, so completed and early
error paths retain the elapsed value (zero when a stage did not begin).

## Compatibility and security

- The frontend sends `bootId` as an additive POST field.
- Existing deployments that answer `INVALID_ACTION` still enter the current
  legacy path; frontend logs retain the original boot id and mark the result
  as fallback.
- Mock bootstrap responses echo the supplied boot id for parity without
  changing the standalone mock identity fixture shape.
- `bootId` is a generated correlation identifier, not an identity substitute;
  authenticated identity, View As identity, and effective identity remain
  separate.
- Existing token redaction and safe backend error-code behavior remain in
  force. The new performance logger has no access to auth payloads.
- Instrumentation performs only clock reads, ref writes, and console/GAS log
  writes. It does not call fetch, SpreadsheetApp, or setState to collect data.

## Verification and capture

Automated verification will cover the exact manifest commands: the strict
identity ledger test, lint, and Vite build. Tests will also assert boot id
round-tripping, safe structured log fields, the frontend milestone wiring,
legacy fallback preservation, and absence of secrets in timing logs. Real
LIFF authentication, View As behavior, and GAS production deployment remain
manual evidence items and are not locally verified.

Operators can capture frontend lines in Chrome DevTools Console by filtering
`[PERF][BOOT]`, copy the `bootId`, then filter the GAS Apps Script Execution
log for the same id. The metric lines form the waterfall; compare
`BOOTSTRAP_NETWORK_MS` with backend `BOOTSTRAP_TOTAL_MS` and inspect the stage
metrics before selecting Phase 4 optimization candidates.

## Phase 4 handoff candidates

The measurements will identify whether the next optimization should target
LINE profile latency, Orders Sheet read/indexing, GAS cold start/network,
frontend state/render application, or LIFF/client initialization. No Phase 4
decision is made by this change.
