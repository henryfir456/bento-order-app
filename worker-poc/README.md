# Bento API Cloudflare Worker

The default Wrangler runtime in this directory is the formal
`src/formalWorker.js` backend with the `migrations-formal` D1 chain. Cloudflare
Worker + D1 is the only active production backend for new capabilities. GAS is
fully retired; its source and adapter remain only as legacy regression
artifacts. The former read-only POC remains available only through
`wrangler-poc.jsonc` and the explicit `dev:poc`/`db:migrations:poc:local`
commands. The POC config is local-only: it uses the distinct
`bento-api-poc-legacy` Worker name, `bento-poc-legacy-local` local D1 name, and
no remote D1 ID. Its remote seed script is fail-closed.

The formal Worker implements LINE token authentication, canonical relational
identity, restricted employee guest sessions, explicit provisional employee
onboarding, conflict-safe LINE binding and provisional claim, Admin identity
binding, View As read isolation, transactional order and balance mutations,
and the formal D1 schema. `verification_status` and `employee_roster` remain
legacy compatibility data; they are not active LINE access gates. The React
production transport is Worker-only; the explicit GAS adapter is not a
production fallback.

## Contract boundaries

The machine-readable legacy parity authority is
`contracts/bootstrap-contract.json`. Its query-user-id surfaces describe the
retained POC only:

- `GET /api/bootstrap?userId=<id>`: the legacy GAS
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

The formal authenticated startup flow is:

1. Send `GET /api/me` with `Authorization: Bearer <LINE access token>`.
2. An active LINE canonical user with an employee ID is immediately
   `registered=true` and proceeds to normal application/bootstrap flow. The
   stored canonical role is authoritative even when the historical
   `verification_status` is `UNVERIFIED`.
3. An active LINE canonical user without an employee ID receives
   `EMPLOYEE_BIND_REQUIRED` and the binding prompt. Submit only the normalized
   employee ID to `POST /api/auth/line-employee-bind`. The Worker resolves the
   LINE identity from the token, performs normal binding, same-survivor
   idempotence, or the guarded atomic provisional claim. A non-claimable owner
   returns `409 {"error":"EMPLOYEE_ID_ALREADY_BOUND"}`. No roster match or
   client claim flag is used.
4. A LINE identity without an existing canonical row may use the same direct
   binding endpoint; an unknown valid employee ID creates a normal registered
   LINE canonical row with the existing schema compatibility defaults. The
   active frontend does not use the old lookup/confirmation review path.
5. When no LINE authentication context is available, an unbound active
   employee may instead send `POST /api/auth/employee-guest` with a string
   `{ "employeeId": "001234" }`. The returned credential is opaque and
   self-only. A valid but unmapped textual ID remains an employee_guest
   provisional session with no canonical application access.
6. The legacy guest-to-LINE `POST /api/auth/line-bind` path remains bounded to
   the two-credential guest compatibility flow. It never grants Admin
   capability from a stored guest role and never uses roster verification as
   an active access gate.
7. After a registered LINE binding, send `GET /api/bootstrap` and then
   `GET /api/bootstrap/deferred?bootId=<same caller boot id>` with the LINE
   Bearer token. The formal response echoes that boot ID exactly.

The formal Worker ignores client-supplied user IDs, employee IDs, roles,
balances, and display names for identity and keeps authenticated actor,
optional read-only View As subject, and mutation actor separate. `user_id` is
the relational owner in orders, ledger, audit, likes, status history, and
idempotency rows; `employee_id` is the textual business key and retains
leading zeroes.

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
  migrations-formal/0002_canonical_identity_rekey.sql
  migrations-formal/0003_provisional_employee_identity.sql
  migrations-formal/0004_employee_roster_verification_source.sql
  docs/canonical-identity-guest-access.md
  docs/remote-import-readiness.md
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

Find the entry whose name is exactly `bento-formal` and verify that its UUID is
`e75bc185-afb5-4a5d-abc9-81bd79525cff`. The active formal config already
contains this non-secret database ID; do not replace it with another resource.
If Wrangler is not authenticated, use the interactive
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
`migrations-formal/0000_formal_initial_schema.sql`,
`migrations-formal/0001_balance_integrity_primitives.sql`, and the one-time
`migrations-formal/0002_canonical_identity_rekey.sql`, followed by
`migrations-formal/0003_provisional_employee_identity.sql` and
`migrations-formal/0004_employee_roster_verification_source.sql`. It does not
import workbook data. Raw migrations 0002, 0003, and 0004 are forward-only; D1's
migration history prevents them from being applied twice. For legacy POC
inspection, use the explicit POC migration command instead.

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

## Remote formal Worker CORS for local frontend

The formal Worker keeps the production Netlify origin as a default CORS
boundary and always allows the two stable local development origins:
`http://localhost:5173` and `http://127.0.0.1:5173`. This does not depend on
`CORS_MODE` or deploy-time runtime variables. Every other unknown origin is
denied.

For the local development topology, run only the React/Vite frontend at
`http://localhost:5173` and keep the ignored `.env.development` pointed at the
remote formal Worker. Do not change `VITE_WORKER_API_URL` to
`http://127.0.0.1:8787`; no local Wrangler Worker or local D1 is required.

The existing strict dynamic Pinggy origin class is always allowed:
`https://<valid-label>.run.pinggy-free.link`. It does not depend on
`CORS_MODE` or deploy-time runtime variables. The existing `run.pinggy.link`
and other `pinggy-free.link` forms remain covered by the same strict validator.
`CORS_MODE=remote-test` remains available only for non-production testing that
needs extra exact origins. Extra local or tunnel origins must use the existing
exact-origin list:

```dotenv
CORS_MODE=remote-test
DEV_ALLOWED_ORIGINS=https://<exact-extra-origin>
```

`DEV_ALLOWED_ORIGINS` is read only in explicit `local` or `remote-test` modes.
Each entry must be a complete exact HTTP(S) origin; wildcard strings, domain
suffixes, paths, malformed values, and arbitrary origins are rejected. The
response echoes the validated request origin and never uses
`Access-Control-Allow-Origin: *`. The committed `wrangler.jsonc` must omit
`CORS_MODE`; production still retains the stable localhost policy while
the validated dynamic Pinggy policy is always active.

After an authorized backend deploy, run the read-only CORS smoke against the
deployed Worker. It requires both preflight and actual unauthenticated
responses to be browser-readable:

```powershell
$env:BENTO_WORKER_BASE_URL = 'https://bento-api-poc.<account>.workers.dev'
$env:BENTO_PINGGY_ORIGIN = 'https://<current-label>.run.pinggy-free.link'
npm.cmd run smoke:cors
```

The repository has no separate committed test/staging Wrangler environment.
From `worker-poc`, enable remote-test on the non-production Worker only when
testing extra exact origins, while preserving existing remote variables:

```powershell
npm.cmd exec -- wrangler deploy --var CORS_MODE:remote-test --keep-vars
```

Do not run that command for the production Worker. The command deploys the
current Worker source and runtime variable; the remote Worker must be deployed
before the new CORS behavior is available to the local frontend.

Keep the existing `VITE_LIFF_ID`, `VITE_GAS_API_URL`, and remote
`VITE_WORKER_API_URL` values unchanged.

## Formal production replacement import

The formal replacement workflow treats `便當系統設定.xlsx` as the reviewed
source of production business data. It preserves Wrangler's `d1_migrations`
metadata, clears formal business and disposable runtime tables in foreign-key
dependency order, inserts only accepted importer records, preserves
quarantine rows and opening-balance policy statuses, and never fabricates
historical ledger entries. The legacy `bento-api-poc-legacy` target remains
local-only and is not part of this workflow.

The current approved replacement explicitly excludes only
`ORD-1788326205642` and `ORD-1788415593733` as disposable test data. Their
source rows and authorization reason are recorded in the review artifact;
there is no timestamp, prefix, or generic duplicate-order exclusion rule.

Create a local readiness artifact without changing any database. The identity
foundation gate is expected to be `READY`; the legacy import gate is expected
to be `BLOCKED` because the Users sheet has no `employee_id`. This dry-run
must not emit a replacement SQL file. Use a new output path that does not
overwrite an existing local artifact:

```powershell
npm.cmd run import:production:dry-run -- `
  --input "..\gas\便當系統設定.xlsx" `
  --output ".local-imports/bento-formal-canonical-identity-readiness.json" `
  --sql-output ".local-imports/bento-formal-canonical-identity.sql" `
  --target bento-formal `
  --database-id e75bc185-afb5-4a5d-abc9-81bd79525cff `
  --config wrangler.jsonc
```

The artifact records both readiness gates, the target UUID, source SHA-256
fingerprint, importer version, exact identity status/counts, financial
evidence and unexplained offsets, accepted/quarantined/warning counts,
preserved and cleared tables, expected post-import counts, legacy import
blockers, and the exact later destructive command. Review the artifact before
any replacement authorization. Dry-run, local stage, and future replacement
share the same identity mapping, validation, reconciliation, and
persistence-planner path.

The future authorized remote command is:

```powershell
npm.cmd run import:production:replace -- `
  --input "..\gas\便當系統設定.xlsx" `
  --identity-map ".local-imports/employee-identity-map.json" `
  --target bento-formal `
  --database-id e75bc185-afb5-4a5d-abc9-81bd79525cff `
  --reviewed-artifact ".local-imports/bento-formal-canonical-identity-readiness.json" `
  --sql-output ".local-imports/bento-formal-canonical-identity-replacement.sql" `
  --confirm-production-replace `
  --remote `
  --config wrangler.jsonc
```

This command is destructive remote D1 mutation and is not part of local
verification. It performs a read-only duplicate-source preflight before
submitting the reviewed multi-statement replacement SQL. The in-process local
replacement uses D1 `batch()` atomicity; Wrangler's SQL execution path does
not support SQL `BEGIN`/`COMMIT`, so remote execution must be followed by the
read-only reconciliation checks in `docs/remote-import-readiness.md`. It
refuses the wrong
target, wrong or missing UUID, missing confirmation, missing or mismatched
review artifact, already-applied source fingerprint, accepted historical
ledger rows, or an active config whose D1 binding does not match the expected
formal UUID. It also refuses a missing or conflicting exact employee mapping;
it never derives `employee_id` from a name or LINE ID.

For local destructive simulation, use the same reviewed SQL with Wrangler's
local D1 target only:

```powershell
npm.cmd run db:migrations:local
npm.cmd exec -- wrangler d1 execute bento-formal --local --file ".local-imports/bento-formal-replacement.sql" --yes
```

The local simulation must seed disposable rows first and verify that those
rows disappear while `d1_migrations`, accepted workbook rows, quarantine
records, negative balances, and opening-balance policy statuses remain
correct.

## Formal remote migration and deployment

Remote migration and deploy are external writes. Run migrations only after
the implementation, local Worker/security tests, compatibility checks, root
verification, and a fresh backup pass. Apply and verify 0002, 0003, and 0004
in order. Only the later separately authorized deployment activates
the new Worker source:

```powershell
npm.cmd run db:migrations:remote
npm.cmd run deploy
```

The package guard refuses remote writes when `wrangler.jsonc` contains an
invalid database ID. This task does not deploy. After a separately
authorized formal deployment, smoke-test `/api/me`, the employee guest and
LINE onboarding contracts, `/api/bootstrap`,
`/api/bootstrap/deferred?bootId=...`, and `/api/order-page` with a
representative Bearer token. The local Vite topology intentionally keeps
`.env.development` pointed at the remote formal Worker and does not require a
local Worker or local D1.

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
