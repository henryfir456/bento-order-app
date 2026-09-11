# Bento API Cloudflare Worker

The default Wrangler runtime in this directory is the formal
`src/formalWorker.js` backend with the `migrations-formal` D1 chain. It does
not change the React production frontend, GAS backend, Netlify deployment, or
Google Sheets. The former read-only POC remains available only through
`wrangler-poc.jsonc` and the explicit `dev:poc`/`db:migrations:poc:local`
commands. The POC config is local-only: it uses the distinct
`bento-api-poc-legacy` Worker name, `bento-poc-legacy-local` local D1 name, and
no remote D1 ID. Its remote seed script is fail-closed.

The formal Worker implements LINE token authentication, canonical relational
identity, restricted employee guest sessions, explicit provisional employee
onboarding, conflict-safe LINE binding, View As read isolation, transactional
order and balance mutations, and the formal D1 schema. React remains
GAS-bound in production until the separate transport and cutover slice is
authorized.

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

The formal authenticated startup flow is:

1. Send `GET /api/me` with `Authorization: Bearer <LINE access token>`.
2. If `registered` is `false`, LINE authentication has succeeded but the LINE
   identity is not bound. Show the separate employee-identity lookup path:
   `POST /api/auth/line-employee-lookup` with the normalized employee ID.
   An existing unbound employee is shown for explicit confirmation, then
   `POST /api/auth/line-employee-bind` performs the server-side binding.
   An unknown valid six-character ID enters onboarding; completion uses the
   same direct LINE-authenticated bind path and creates an `UNVERIFIED`
   canonical user. This LINE-authenticated path never creates an employee
   guest session.
3. When no LINE authentication context is available, an unbound active
   employee may instead send
   `POST /api/auth/employee-guest` with a string `{ "employeeId": "001234" }`.
   A known active employee with no LINE binding receives an opaque, expiring
   `VERIFIED` session with self-service permissions. Any employee ID already
   bound to LINE receives HTTP 409 `{"error":"LINE_LOGIN_REQUIRED"}`.
   A valid but unmapped six-character ID receives HTTP 200 with an opaque
   `UNVERIFIED_EMPLOYEE` onboarding session; it receives no canonical user,
   balance, or application-data capability.
4. For the no-LINE fallback flow, send `POST /api/auth/line-bind` with the
   server-verified LINE Bearer token and `X-Employee-Guest-Session`. A known
   employee requires explicit confirmation. An unknown employee must also
   submit only a display name and pickup floor; the Worker creates a
   canonical `User` row with `role = User`, `active = 1`, `balance = 0`, and
   `verification_status = UNVERIFIED`. The session and LINE binding are
   collision-safe and the guest session is revoked after binding.
5. `UNVERIFIED` principals resolve through `/api/me` and may only use the
   central onboarding capabilities `CAN_VIEW_SELF_ONBOARDING_STATE`,
   `CAN_COMPLETE_PROFILE`, and `CAN_BIND_LINE`. They cannot access calendar,
   balances, orders, administration, View As, or another user's data.
6. After a verified LINE binding, send `GET /api/bootstrap` with the LINE
   Bearer token.
7. Send `GET /api/bootstrap/deferred?bootId=<same caller boot id>` for likes
   and announcements. The formal response echoes that boot ID exactly.

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
`migrations-formal/0003_provisional_employee_identity.sql`. It does not
import workbook data. Raw migrations 0002 and 0003 are forward-only; D1's
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

The formal Worker keeps the production Netlify origin as its default CORS
boundary. With no `CORS_MODE`, it allows only
`https://stirring-pony-3571ac.netlify.app`; `http://localhost:5173` and every
other unknown origin are denied.

For the local development topology, run only the React/Vite frontend at
`http://localhost:5173` and keep the ignored `.env.development` pointed at the
remote formal Worker. Do not change `VITE_WORKER_API_URL` to
`http://127.0.0.1:8787`; no local Wrangler Worker or local D1 is required.

The non-production remote Worker must explicitly set the non-secret runtime
variable `CORS_MODE=remote-test`. This mode adds the exact local origin
`http://localhost:5173` while retaining the production Netlify origin. It also
allows HTTPS origins with a single dynamic subdomain under
`pinggy-free.link` (including the `*.run.pinggy-free.link` form used by
Pinggy). Extra local or tunnel origins must use the existing exact-origin list:

```dotenv
CORS_MODE=remote-test
DEV_ALLOWED_ORIGINS=https://<exact-id>.run.pinggy-free.link
```

`DEV_ALLOWED_ORIGINS` is read only in explicit `local` or `remote-test` modes.
Each entry must be a complete exact HTTP(S) origin; wildcard strings, domain
suffixes, paths, malformed values, and arbitrary origins are rejected. The
response echoes the validated request origin and never uses
`Access-Control-Allow-Origin: *`. The committed `wrangler.jsonc` must omit
`CORS_MODE` so production remains on the Netlify-only default.

The repository has no separate committed test/staging Wrangler environment.
From `worker-poc`, enable remote-test on the non-production Worker while
preserving existing remote variables:

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
verification, and a fresh backup pass. Apply and verify 0002 before applying
and verifying 0003. Only the later separately authorized deployment activates
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
