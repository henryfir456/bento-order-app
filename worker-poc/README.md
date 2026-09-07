# Bento API Cloudflare Worker POC

This directory is an isolated proof of concept for the existing Cloudflare
resources:

- Worker: `bento-api-poc`
- D1 database: `bento-poc`
- Worker binding: `env.DB`

It does not change the React production frontend, GAS production backend,
Netlify deployment, or Google Sheets. The POC is read-only and does not
implement LINE authentication, access tokens, View As, order writes, or
balance writes.

## Directory layout

```text
worker-poc/
  src/index.js
  migrations/0000_initial_schema.sql
  tests/index.test.js
  wrangler.jsonc
  package.json
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
ID into the `database_id` field in `wrangler.jsonc`, replacing only
`<SET_FROM_WRANGLER_D1_INFO>`. If Wrangler is not authenticated, run the
interactive login command locally:

```powershell
npm.cmd exec -- wrangler login
npm.cmd run db:info
```

For a non-interactive environment, set `CLOUDFLARE_API_TOKEN` only in the
local process environment or CI secret store. Never put the token in this
repository, `.env` files tracked by Git, or this README.

The Dashboard alternative is Cloudflare Dashboard → D1 → `bento-poc` →
database details → copy the database ID. No Dashboard schema setup is
needed; the checked-in migration is the schema authority.

## Local development

Run the migration against the local D1 state, then start the Worker:

```powershell
npm.cmd run db:migrations:local
npm.cmd run dev
```

Wrangler stores local D1 state under `.wrangler/`, which is ignored by Git.
The local endpoint is normally `http://localhost:8787`.

## API

```text
GET /api/health
GET /api/users/:lineUserId
GET /api/orders?userId=<id>
GET /api/bootstrap?userId=<id>
```

The verified response shapes are:

- `/api/health`: `{ "ok": true, "database": true, "users": <number> }`.
- `/api/users/:lineUserId`: the public user object with
  `line_user_id`, `display_name`, `pickup_floor`, `balance`, and `role`.
- `/api/orders`: `{ "orders": [...] }`; missing `userId` is HTTP 400 with
  `{ "error": "USER_ID_REQUIRED" }`.
- `/api/bootstrap`: `{ "user": {}, "orders": [], "settings": {},
  "announcements": [], "menu": [] }`.

An unknown user returns HTTP 404 with `{ "error": "USER_NOT_FOUND" }`.

## Migration commands

The migration is tracked by Wrangler's D1 migration table and uses guarded
`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements. Run
it from this directory; do not manually create schema in the Dashboard:

```powershell
# local D1 only
npm.cmd run db:migrations:local

# existing remote D1; intentionally not run by this task
npm.cmd run db:migrations:remote
```

The remote command is a write operation. Review the remote schema and
migration status before using it. The script refuses to continue unless
`database_id` has been replaced with a valid UUID.

## Deploy

Deployment is intentionally not performed in this task. The deploy script
also refuses the placeholder `database_id`. After local tests, remote
migration review, exact UUID configuration, and explicit authorization to
deploy, use:

```powershell
npm.cmd run deploy
```

## Tests and verification

The tests use Node's built-in test runner and a deterministic fake D1 adapter;
they do not require Cloudflare credentials:

```powershell
npm.cmd test
npm.cmd run verify
```

For repository-level verification, run the unchanged root checks from the
repository root:

```powershell
node --test tests/strict-identity-ledger.test.cjs
npm.cmd run lint
npm.cmd run build
```

Local tests do not prove real Cloudflare authentication, remote D1 state,
Worker deployment, or production traffic.

## GAS + Sheets vs Worker + D1 bootstrap comparison

After both sides contain equivalent rows for the same user, compare the same
five logical outputs: `user`, `orders`, `settings`, `announcements`, and
`menu`. Keep the dataset, region, network conditions, and request shape
constant. Record at least 30 cold-start and 30 warm samples for each backend,
then report median, p95, response bytes, and error count separately.

For the Worker, call `/api/bootstrap?userId=...` directly and record client
elapsed time plus `Content-Length` (or downloaded byte count). For GAS, call
the existing bootstrap POST with the normal production authentication flow
and use its existing bootstrap timing observability alongside client elapsed
time. Do not route the production frontend to the POC just to benchmark it.
Interpret cold starts, geographic placement, and authentication overhead
separately; only compare the data/bootstrap portion on an equivalent basis.
