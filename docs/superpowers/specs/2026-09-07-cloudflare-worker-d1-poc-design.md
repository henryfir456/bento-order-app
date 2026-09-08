# Cloudflare Worker + D1 POC Design

> Historical POC specification. The formal Worker is now the default runtime
> through `worker-poc/wrangler.jsonc`; the retained POC is local-only through
> `worker-poc/wrangler-poc.jsonc`. Do not use the remote migration/deploy
> examples in this historical document.

**Date:** 2026-09-07

**Status:** Approved for implementation in the current task.

## Goal

Formally bring the existing `bento-api-poc` Cloudflare Worker and
`bento-poc` D1 proof of concept into this repository as an isolated,
locally versioned subsystem. The POC must support local Wrangler development,
repeatable D1 migrations, minimal API tests, and an explicit deploy command
without changing the React production frontend, GAS production backend,
Netlify deployment, or Google Sheets.

## Scope and boundaries

The only runtime files added by this change live under `worker-poc/`. The
Worker is a read-only POC for the four already verified GET endpoints. It is
not wired into the React frontend and does not replace or call the GAS
backend. It does not introduce LINE authentication, access-token handling,
View As behavior, writes, order submission, balance mutations, or Google
Sheets synchronization.

The current remote Worker source is not present in the repository. The POC
contract below is therefore the authoritative reconstructed contract for the
local implementation. The existing remote D1 `database_id` is intentionally
not guessed; it is a non-secret configuration value that must be obtained
with authenticated Wrangler or the Cloudflare Dashboard before remote
migrations or deploy.

## API contract

All responses are JSON. Successful responses use HTTP 200.

### `GET /api/health`

```json
{
  "ok": true,
  "database": true,
  "users": 0
}
```

`users` is the number of rows in `users`. A database failure returns HTTP
503 with `{ "ok": false, "database": false, "users": 0 }` and the stable
error code `DATABASE_UNAVAILABLE`.

### `GET /api/users/:lineUserId`

The successful response contains only the verified public user fields:

```json
{
  "line_user_id": "U-example",
  "display_name": "Example User",
  "pickup_floor": "1F",
  "balance": 100,
  "role": "User"
}
```

If no row matches, return HTTP 404:

```json
{ "error": "USER_NOT_FOUND" }
```

### `GET /api/orders?userId=<id>`

The `userId` query value is mapped to `orders.line_user_id`. A missing or
blank value returns HTTP 400:

```json
{ "error": "USER_ID_REQUIRED" }
```

Success returns all order line rows for that user, ordered by
`order_date DESC` and `created_at DESC`:

```json
{
  "orders": [
    {
      "order_id": "order-001",
      "order_date": "2026-09-10",
      "vendor": "Example Bento",
      "line_user_id": "U-example",
      "item_id": "A01",
      "item_name": "Chicken Bento",
      "quantity": 1,
      "unit_price": 80,
      "subtotal": 80,
      "pickup_floor": "1F",
      "note": "No onions",
      "created_at": "2026-09-07 01:00:00"
    }
  ]
}
```

### `GET /api/bootstrap?userId=<id>`

The same `USER_ID_REQUIRED` 400 response applies when `userId` is missing or
blank. A missing user returns the same 404 `USER_NOT_FOUND` response as the
user endpoint. A successful response has exactly these top-level fields:

```json
{
  "user": {},
  "orders": [],
  "settings": {},
  "announcements": [],
  "menu": []
}
```

The Worker first resolves the user, then reads the user orders and the three
shared datasets in parallel. `settings` is a key/value object whose values
are stored as strings. `announcements` contains enabled announcements whose
inclusive `start_date`/`end_date` window contains the current Asia/Taipei
date; the response omits the internal `enabled` column. `menu` contains all
menu rows, including their version date and vendor, so the POC payload is
self-describing. These choices keep the requested object/array shapes
stable while preserving enough source data for later frontend integration.

## Data model

The first migration creates these tables:

- `users`: `line_user_id` primary key, `display_name`, `pickup_floor`, numeric
  `balance`, `role`, and audit timestamps.
- `orders`: an auto-increment row id plus the exact order-line fields used by
  the API, a foreign key to `users.line_user_id`, and a defaulted `created_at`.
- `settings`: key/value rows keyed by `setting_key` with an update timestamp.
- `announcements`: id, title, content, inclusive date window, enabled flag,
  and creation timestamp.
- `menu`: versioned rows keyed by `(menu_date, vendor, item_id)`, with item
  name, numeric price, note, image URL, and creation timestamp.

The migration also creates these indexes:

- `idx_orders_line_user_id` on `orders(line_user_id)`.
- `idx_orders_user_order_date` on `orders(line_user_id, order_date)`.
- `idx_announcements_active_window` on
  `announcements(enabled, start_date, end_date)`.
- `idx_menu_vendor_date` on `menu(vendor, menu_date)`.

The API selects explicit columns rather than exposing internal row ids or
future schema additions. Numeric output fields are normalized to finite
numbers at the response boundary.

## Migration strategy

`worker-poc/migrations/0000_initial_schema.sql` is the only schema authority
for this POC. Every table and index uses `IF NOT EXISTS`, and Wrangler's
`d1_migrations` bookkeeping prevents an already applied migration from being
applied again. No schema is created manually in the Dashboard and no seed
data is embedded in the migration.

The Wrangler config uses `migrations_dir: "migrations"` and binds `DB` to
`database_name: "bento-poc"`. Because the current database ID was not
available without Cloudflare authentication, the checked-in config carries a
clearly marked non-secret placeholder. The README gives the exact
`wrangler d1 info bento-poc` / `wrangler d1 list` and Dashboard steps to
replace it before any remote command. Both the remote migration and deploy
scripts refuse to continue until the configured value is a UUID. No remote
migration or deploy is part of this task.

## Runtime and error handling

`worker-poc/src/index.js` exports the normal module Worker object and an
exported `handleRequest` function for tests. It accepts only GET requests for
the POC routes, returns a stable 404 for unknown paths, 405 for other
methods, and never returns database error text, stack traces, access tokens,
or credentials. CORS headers are limited to the read-only POC response
surface and do not alter any production frontend configuration.

The request handler receives an injectable clock option only for deterministic
tests. Production calls use the current Asia/Taipei date for announcement
filtering.

## Verification and non-goals

The worker package has its own Node built-in tests and a `verify` script that
checks API behavior and migration/config source invariants without requiring
Cloudflare credentials. The repository-required root `test`, `lint`, and
`build` commands remain unchanged and are run separately because the POC is
isolated from production code.

Real Cloudflare authentication, remote D1 migration, Worker deployment, and
production traffic are manual/external evidence. They are not claimed as
verified by local tests, and deployment is explicitly not performed in this
task.

## Follow-up performance comparison

After the POC has a locally reproducible dataset, compare GAS + Sheets with
Worker + D1 using the same user and equivalent rows. Measure cold and warm
requests separately, record total client-observed latency and response byte
size, and capture server-side stage timings where available. Compare the
same five logical bootstrap outputs (`user`, `orders`, `settings`,
`announcements`, `menu`) rather than comparing unrelated frontend work. Run
at least 30 samples per condition, report median and p95, and note that GAS
and Worker deployments have different cold-start and geographic execution
characteristics.
