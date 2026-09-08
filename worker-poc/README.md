# Bento API Cloudflare Worker

The default Wrangler runtime in this directory is the formal
`src/formalWorker.js` backend with the `migrations-formal` D1 chain. It does
not change the React production frontend, GAS backend, Netlify deployment, or
Google Sheets. The former read-only POC remains available only through
`wrangler-poc.jsonc` and the explicit `dev:poc`/`db:migrations:poc:local`
commands. The POC config is local-only: it uses the distinct
`bento-api-poc-legacy` Worker name, `bento-poc-legacy-local` local D1 name, and
no remote D1 ID. Its remote seed script is fail-closed.

The formal Worker implements LINE token authentication, canonical identity,
View As read isolation, transactional order and balance mutations, and the
formal D1 schema. React remains GAS-bound until the separate transport and
cutover slice is authorized.

## Contract boundaries

The machine-readable legacy parity authority is
`contracts/bootstrap-contract.json`. Its query-user-id surfaces describe the
retained POC only:

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

The formal startup flow is:

1. Send `GET /api/me` with `Authorization: Bearer <LINE access token>`.
2. If `registered` is `false`, render registration using the token-derived
   `lineUserId` and `displayName`; `/api/me` does not create a D1 row.
3. Send `POST /api/register` with the validated `pickupFloor`.
4. After registration, send `GET /api/bootstrap` with the same Bearer token.
5. Send `GET /api/bootstrap/deferred?bootId=<same caller boot id>` for likes
   and announcements. The formal response echoes that boot ID exactly.

The formal Worker ignores client-supplied user IDs for identity and keeps
authenticated actor, optional read-only View As subject, and mutation actor
separate.

Primary bootstrap intentionally does not include likes, active announcements,
menu, deadline, or setting. This matches the current React startup waterfall.
Those fields stay in the deferred/order-page contracts.

## Directory layout

```text
worker-poc/
  contracts/bootstrap-contract.json
  src/contract.js
  src/formalWorker.js
  src/index.js                         # retained legacy POC runtime
  migrations-formal/0000_formal_initial_schema.sql
  migrations-formal/0001_balance_integrity_primitives.sql
  migrations/                            # retained legacy POC chain
  scripts/benchmark-bootstrap.mjs
  scripts/benchmark-report.mjs
  tests/index.test.js
  tests/contract.test.js
  tests/parity.test.js
  wrangler.jsonc
  wrangler-poc.jsonc                    # explicit legacy POC config
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

The default local migration command applies the formal chain
`migrations-formal/0000_formal_initial_schema.sql` and
`migrations-formal/0001_balance_integrity_primitives.sql`. It does not import
workbook data. For legacy POC inspection, use the explicit POC migration
command instead.

Run local migration verification twice, then run Worker tests:

```powershell
npm.cmd run db:migrations:local
npm.cmd run db:migrations:local
npm.cmd test
npm.cmd run verify
```

The retained POC can be started or migrated only explicitly:

```powershell
npm.cmd run dev:poc
npm.cmd run db:migrations:poc:local
```

Local tests use Node's built-in test runner and deterministic fake D1 data.
They verify the four contract surfaces, required keys/types, nullable and
empty behavior, ordering, stable errors, migration guards, and credential
scans. They do not prove remote D1 contents or production traffic.

## Formal remote migration and deployment

Remote migration and deploy are external writes. Run them only after local
Worker/parity tests and root verification pass, and only against the existing
`bento-poc` resource:

```powershell
npm.cmd run db:migrations:remote
npm.cmd run deploy
```

The package guard refuses remote writes when `wrangler.jsonc` contains an
invalid database ID. After a separately authorized formal deployment, smoke-
test `/api/me`, `/api/bootstrap`, `/api/bootstrap/deferred?bootId=...`, and
`/api/order-page` with a representative Bearer token. Do not route React to
the Worker in this slice.

There is intentionally no remote migration, deploy, or seed command for the
legacy POC. `wrangler-poc.jsonc` omits `database_id`, and
`scripts/seed-parity-poc.mjs` refuses before starting Wrangler. Use only the
explicit `--local` POC commands for isolated verification.

## Legacy POC serial primary benchmark

This is a legacy POC parity benchmark, not formal Worker verification. It
compares only equivalent primary requests:

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
$env:POC_WORKER_BOOTSTRAP_URL = 'https://<legacy-poc-worker-host>/api/bootstrap'
$env:BENCH_USER_ID = '<same-logical-user-in-both-datasets>'
$env:GAS_ACCESS_TOKEN = '<set-locally-only>'
$env:BENCH_TARGET_DATE = '2026-09-10'
$env:BENCH_ITERATIONS = '50'
$env:BENCH_JSON_OUT = Join-Path $env:TEMP 'bento-bootstrap-benchmark.json'
$env:BENCH_MARKDOWN_OUT = Join-Path $env:TEMP 'bento-bootstrap-benchmark.md'

npm.cmd run benchmark:poc
npm.cmd run benchmark:report -- $env:BENCH_JSON_OUT
```

The POC benchmark runs the local POC migration gate twice and the POC
Worker/parity test gate before making network requests. If
`GAS_ACCESS_TOKEN` is unavailable,
implementation and local verification can still be completed, but the live
benchmark stops at that external-input gate and no speed conclusion is valid.

## Intentional differences

The fixture records the differences that are not frontend parity defects:

- The retained POC diagnostic contract uses a query `userId`; the formal
  Worker authenticates a LINE access token and resolves identity from D1.
- GAS normally returns JSON error envelopes through the web-app transport;
  Worker uses explicit HTTP error statuses.
- GAS timing includes LINE/Apps Script stages; Worker timing includes D1 and
  Worker stages.
- The Worker does not emulate the legacy `INVALID_ACTION` action waterfall.
- Diagnostic `/api/users` and `/api/orders` are outside primary parity.
