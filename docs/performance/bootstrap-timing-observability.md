# Bootstrap timing observability

Phase 3 adds a single correlation id to the existing startup flow. A normal
registered-user waterfall is:

```text
BOOT_START
LIFF_INIT_START -> LIFF_INIT_END / LIFF_INIT_MS
BOOTSTRAP_REQUEST_START -> BOOTSTRAP_REQUEST_END / BOOTSTRAP_NETWORK_MS
backend: LINE_PROFILE_MS, USER_LOOKUP_MS, SETTINGS_MS, LIKES_MS,
         ANNOUNCEMENTS_MS, ORDERS_MS, CALENDAR_MS, BOOTSTRAP_TOTAL_MS
BOOTSTRAP_STATE_READY / STATE_APPLY_MS
BOOT_READY / BOOT_TOTAL_MS
```

## Log format

Frontend lines use the fixed prefix and an allowlisted JSON payload:

```text
[PERF][BOOT][BOOT-1760000000000-a1b2c3] frontend {"milestone":"BOOT_START"}
[PERF][BOOT][BOOT-1760000000000-a1b2c3] frontend {"metric":"LIFF_INIT_MS","durationMs":123.4}
[PERF][BOOT][BOOT-1760000000000-a1b2c3] frontend {"status":"success","fallback":false,"metric":"BOOT_TOTAL_MS","durationMs":1180.0}
```

Backend lines use the same id:

```text
[PERF][BOOT][BOOT-1760000000000-a1b2c3] backend {"status":"success","metric":"ORDERS_MS","durationMs":180}
```

Frontend milestones are `BOOT_START`, `LIFF_INIT_START`, `LIFF_INIT_END`,
`BOOTSTRAP_REQUEST_START`, `BOOTSTRAP_REQUEST_END`,
`BOOTSTRAP_STATE_READY`, and `BOOT_READY`. Frontend metrics are
`LIFF_INIT_MS`, `BOOTSTRAP_NETWORK_MS`, `STATE_APPLY_MS`, and
`BOOT_TOTAL_MS`. Backend metrics are `BOOTSTRAP_TOTAL_MS`, `LINE_PROFILE_MS`,
`USER_LOOKUP_MS`, `SETTINGS_MS`, `LIKES_MS`, `ANNOUNCEMENTS_MS`, `ORDERS_MS`,
and `CALENDAR_MS`.

`success` means the existing bootstrap completed and the existing UI state was
committed. `error` means LIFF, token, LINE Profile, request, Sheet, calendar,
or backend handling did not produce a usable bootstrap. `fallback` means the
existing `INVALID_ACTION` compatibility branch ran; it is not a new retry or
request path.

Timing lines must not contain an access token, `Authorization`, LINE user id,
display name, API response payload, raw LINE response, exception message, or
exception stack. The id is only a correlation value and does not replace
authenticated identity or View As identity.

The older uncorrelated frontend `[PERF]` diagnostics are DEV-only. In
production, startup performance output is limited to the allowlisted
`[PERF][BOOT]` lines shown above.

## Capture workflow

1. Open the deployed LIFF app in Chrome DevTools.
2. In Console, filter for `[PERF][BOOT]`.
3. Reload or start a new session and copy one `BOOT-...` id from the frontend
   lines.
4. Open the Google Apps Script project’s Executions view and filter the log for
   that same boot id.
5. Compare frontend `BOOTSTRAP_NETWORK_MS` with backend
   `BOOTSTRAP_TOTAL_MS`, then inspect the backend stage metrics to identify the
   slowest existing boundary.
6. Save the frontend and backend lines together when handing off a Phase 4
   optimization candidate.

The local test harness verifies the response and log contracts but cannot
verify real LIFF authentication, View As behavior, deployed GAS execution
logs, or the production API contract. Those remain manual evidence items.
