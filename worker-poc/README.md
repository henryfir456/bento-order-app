# Bento API Cloudflare Worker POC

This directory is the existing isolated `bento-api-poc` Worker and
`bento-poc` D1 proof of concept. It does not change the React production
frontend, GAS backend, Netlify deployment, or Google Sheets. It does not
implement LINE authentication, access-token handling, View As behavior,
order writes, or balance writes.

## Contract boundaries

The machine-readable authority is
`contracts/bootstrap-contract.json`. The four separate surfaces are:

- `GET /api/bootstrap?userId=<id>`: the production GAS
  `getBootstrapData(..., deferUiData: true)` frontend-observable primary
  contract.
- `GET /api/bootstrap/deferred?userId=<id>`: the production deferred likes
  and announcements contract.
- `GET /api/order-page?userId=<id>&targetDate=<date>`: the production
  `getOrderPageData` side contract for setting, deadline, menu, and active
  order lines.
- GAS `INVALID_ACTION` fallback is documented in the fixture as the legacy
  three-request waterfall. The Worker does not emulate GAS action dispatch.

`/api/users/:id` and `/api/orders?userId=<id>` remain diagnostic POC
endpoints. They are not used for primary bootstrap parity or benchmark
comparison.

Primary bootstrap intentionally does not include likes, active announcements,
menu, deadline, or setting. This matches the current React startup waterfall.
Those fields stay in the deferred/order-page contracts.

## Directory layout

```text
worker-poc/
  contracts/bootstrap-contract.json
  src/contract.js
  src/index.js
  migrations/0000_initial_schema.sql
  migrations/0001_bootstrap_parity.sql
  scripts/benchmark-bootstrap.mjs
  scripts/benchmark-report.mjs
  tests/index.test.js
  tests/contract.test.js
  tests/parity.test.js
  wrangler.jsonc
```

## First-time setup and database ID

Wrangler requires the existing D1 database's non-secret `database_id` in
`wrangler.jsonc`. Do not invent this value. From this directory, install the
pinned CLI and query the existing resource:

```powershell
npm.cmd install
npm.cmd run db:info
npm.cmd run db:list
```

Find the entry whose name is exactly `bento-poc` and copy its `uuid`/database
ID into `database_id`. If Wrangler is not authenticated, use the interactive
login command locally:

```powershell
npm.cmd exec -- wrangler login
npm.cmd run db:info
```

For non-interactive use, set `CLOUDFLARE_API_TOKEN` only in the local process
environment or CI secret store. Never put it in this repository or an
`.env` file tracked by Git.

## Local migrations and tests

`0000_initial_schema.sql` is unchanged. `0001_bootstrap_parity.sql` is an
append-only migration that adds calendar settings, likes, and an order-status
overlay without inserting production data or destructively changing the
initial schema.

Run local migration verification twice, then run Worker tests:

```powershell
npm.cmd run db:migrations:local
npm.cmd run db:migrations:local
npm.cmd test
npm.cmd run verify
```

Local tests use Node's built-in test runner and deterministic fake D1 data.
They verify the four contract surfaces, required keys/types, nullable and
empty behavior, ordering, stable errors, migration guards, and credential
scans. They do not prove remote D1 contents or production traffic.

## Remote migration and deployment

Remote migration and deploy are external writes. Run them only after local
Worker/parity tests and root verification pass, and only against the existing
`bento-poc` resource:

```powershell
npm.cmd run db:migrations:remote
npm.cmd run deploy
```

The package guard refuses remote writes when `wrangler.jsonc` contains an
invalid database ID. After deployment, smoke-test the existing Worker URL
with `/api/health`, `/api/bootstrap`, `/api/bootstrap/deferred`, and
`/api/order-page` using a representative D1 user. Do not route React to the
Worker in this task.

## Serial primary benchmark

The benchmark compares only equivalent primary requests:

- GAS POST `getBootstrapData` with `deferUiData: true`.
- Worker GET `/api/bootstrap`.

It does not initialize LIFF or include login time. It records one cold-ish
first request separately, then at least 30 serial warm requests (default 50).
It reports elapsed latency, P50, P95, min, max, mean, payload bytes, HTTP
status/error counts, GAS response timing, and Worker `Server-Timing` values
when available. It performs a live primary semantic comparison before warm
sampling; a mismatch stops the benchmark.

Set values only in the local PowerShell process. `GAS_ACCESS_TOKEN` is a
sensitive LINE access token and must never be committed or written to the
benchmark JSON:

```powershell
$env:GAS_API_URL = $env:VITE_GAS_API_URL
$env:WORKER_BOOTSTRAP_URL = 'https://<existing-worker-host>/api/bootstrap'
$env:BENCH_USER_ID = '<same-logical-user-in-both-datasets>'
$env:GAS_ACCESS_TOKEN = '<set-locally-only>'
$env:BENCH_TARGET_DATE = '2026-09-10'
$env:BENCH_ITERATIONS = '50'
$env:BENCH_JSON_OUT = Join-Path $env:TEMP 'bento-bootstrap-benchmark.json'
$env:BENCH_MARKDOWN_OUT = Join-Path $env:TEMP 'bento-bootstrap-benchmark.md'

npm.cmd run benchmark
npm.cmd run benchmark:report -- $env:BENCH_JSON_OUT
```

The benchmark runs the local migration gate twice and the Worker/parity test
gate before making network requests. If `GAS_ACCESS_TOKEN` is unavailable,
implementation and local verification can still be completed, but the live
benchmark stops at that external-input gate and no speed conclusion is valid.

## Intentional differences

The fixture records the differences that are not frontend parity defects:

- GAS authenticates a LINE access token; this read-only Worker contract uses
  a query `userId`.
- GAS normally returns JSON error envelopes through the web-app transport;
  Worker uses explicit HTTP error statuses.
- GAS timing includes LINE/Apps Script stages; Worker timing includes D1 and
  Worker stages.
- The Worker does not emulate the legacy `INVALID_ACTION` action waterfall.
- Diagnostic `/api/users` and `/api/orders` are outside primary parity.
