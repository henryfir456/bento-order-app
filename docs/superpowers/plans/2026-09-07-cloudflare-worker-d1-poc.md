# Cloudflare Worker + D1 POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an isolated, locally managed Cloudflare Worker + D1 POC that implements the four verified GET endpoints and the expanded five-part bootstrap response.

**Architecture:** Keep all runtime code, migrations, tests, Wrangler configuration, and operational instructions under `worker-poc/`. The Worker uses explicit D1 SQL projections and a read-only route dispatcher; the existing React/Vite frontend, GAS backend, Netlify deployment, and Sheets contract remain untouched.

**Tech Stack:** Cloudflare Workers modules, Wrangler 4.129.0, D1/SQLite SQL, Node.js built-in `node:test`, JSONC.

**Spec:** `docs/superpowers/specs/2026-09-07-cloudflare-worker-d1-poc-design.md`

## Global Constraints

- Only add `worker-poc/**` plus this spec and plan; do not modify React, GAS, Netlify, Google Sheets, or root production scripts.
- Do not put tokens, secrets, credentials, or `.dev.vars` values in Git.
- Do not guess `database_id`; keep the explicit placeholder until the user obtains the existing D1 ID through authenticated Wrangler or Dashboard.
- Do not execute remote D1 migrations, `wrangler deploy`, `git commit`, or `git push` in this task.
- `GET /api/health` returns `{ ok, database, users }`; `/api/users/:lineUserId` returns the verified user object or 404 `USER_NOT_FOUND`; `/api/orders` requires `userId` and returns order lines or 400 `USER_ID_REQUIRED`; `/api/bootstrap` requires `userId` and returns `user`, `orders`, `settings`, `announcements`, and `menu`.
- Use only Node built-ins in tests; no root dependency changes are needed.

---

### Task 1: Create the isolated Worker package and Wrangler boundary

**Files:**
- Create: `worker-poc/package.json`
- Create: `worker-poc/.gitignore`
- Create: `worker-poc/wrangler.jsonc`
- Create: `worker-poc/README.md`
- Create: `worker-poc/scripts/require-database-id.mjs`

**Interfaces:**
- Produces package scripts `dev`, `test`, `db:list`, `db:info`, `db:migrations:local`, `db:migrations:remote`, `deploy`, and `verify`; remote migration and deploy scripts first require a UUID `database_id`.
- Produces Wrangler binding `env.DB` for database name `bento-poc` and migration directory `migrations`.

- [ ] **Step 1: Add package metadata and scripts**

Create a private ESM package with an exact Wrangler version and scripts that
run from the `worker-poc` directory:

```json
{
  "name": "bento-api-poc",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --local",
    "test": "node --test tests/index.test.js",
    "db:list": "wrangler d1 list",
    "db:info": "wrangler d1 info bento-poc",
    "db:migrations:local": "wrangler d1 migrations apply bento-poc --local",
    "db:migrations:remote": "node scripts/require-database-id.mjs && wrangler d1 migrations apply bento-poc --remote",
    "deploy": "node scripts/require-database-id.mjs && wrangler deploy",
    "verify": "npm run test"
  },
  "devDependencies": {
    "wrangler": "4.129.0"
  }
}
```

- [ ] **Step 2: Add local-only ignore rules**

Ignore `node_modules/`, `.wrangler/`, `.dev.vars`, `.dev.vars.*`, `.env`,
and `.env.*`, while allowing a future `.env.example`. This keeps local D1
state and Cloudflare credentials outside version control.

- [ ] **Step 3: Add Wrangler config without inventing the database ID**

Create `wrangler.jsonc` with the Worker name, entrypoint, current
compatibility date, and this binding. The placeholder is intentionally not a
UUID and must be replaced locally after `db:info` or `db:list` returns the
existing resource ID:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "bento-api-poc",
  "main": "src/index.js",
  "compatibility_date": "2026-09-07",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "bento-poc",
      "database_id": "<SET_FROM_WRANGLER_D1_INFO>",
      "migrations_dir": "migrations"
    }
  ]
}
```

- [ ] **Step 4: Document ID retrieval and all operational commands**

In `worker-poc/README.md`, document the Windows-friendly commands from the
package directory:

```powershell
npm.cmd install
npm.cmd run db:info
npm.cmd run db:list
# replace only the placeholder database_id with the uuid for bento-poc
npm.cmd run db:migrations:local
npm.cmd run dev
npm.cmd run db:migrations:remote
npm.cmd run deploy
npm.cmd run verify
```

State that `wrangler login` is the interactive alternative to a local
`CLOUDFLARE_API_TOKEN`, that the token must stay in the local environment,
and that Dashboard lookup is Cloudflare Dashboard → D1 → `bento-poc` →
database ID. Add a guard script that rejects the placeholder before either
the remote migration or deploy command. Explicitly state that this task does
not run the remote or deploy commands.

### Task 2: Add the idempotent D1 schema migration

**Files:**
- Create: `worker-poc/migrations/0000_initial_schema.sql`

**Interfaces:**
- Produces tables `users`, `orders`, `settings`, `announcements`, and `menu`.
- Produces indexes `idx_orders_line_user_id`, `idx_orders_user_order_date`, `idx_announcements_active_window`, and `idx_menu_vendor_date`.

- [ ] **Step 1: Write the guarded schema**

Create one migration with `PRAGMA foreign_keys = ON`, `CREATE TABLE IF NOT EXISTS`
for every table, and `CREATE INDEX IF NOT EXISTS` for every named index. Use
the following columns and constraints:

```sql
CREATE TABLE IF NOT EXISTS users (
  line_user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  pickup_floor TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'User',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  order_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  subtotal REAL NOT NULL CHECK (subtotal >= 0),
  pickup_floor TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS menu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  note TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (menu_date, vendor, item_id)
);
```

- [ ] **Step 2: Add the required indexes**

Append these exact statements. Do not add seed rows or Dashboard-only SQL:

```sql
CREATE INDEX IF NOT EXISTS idx_orders_line_user_id
  ON orders(line_user_id);

CREATE INDEX IF NOT EXISTS idx_orders_user_order_date
  ON orders(line_user_id, order_date);

CREATE INDEX IF NOT EXISTS idx_announcements_active_window
  ON announcements(enabled, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_menu_vendor_date
  ON menu(vendor, menu_date);
```

- [ ] **Step 3: Inspect the migration source**

Run `rg -n "CREATE TABLE|CREATE INDEX|IF NOT EXISTS|bento" migrations` from
`worker-poc` and verify all five tables and four indexes are present before
running any local database command.

### Task 3: Write minimal API and migration tests first

**Files:**
- Create: `worker-poc/tests/index.test.js`

**Interfaces:**
- Consumes: `handleRequest(request, env, { now })` from `worker-poc/src/index.js`.
- Produces test coverage for health, user lookup, order validation/query, bootstrap composition, unknown routes, and migration guards.

- [ ] **Step 1: Add a deterministic fake D1 adapter**

Implement `FakeDB.prepare(sql).bind(...values)` with `first()` and `all()`
methods. It should match the explicit SQL operation names used by the Worker,
return fixture rows, and record SQL strings so tests can assert that the
health count and endpoint projections are used. It must not require a network
or Cloudflare credential.

- [ ] **Step 2: Add endpoint tests with exact contract assertions**

Add Node tests named `health returns database status and user count`,
`user lookup returns the verified public fields`, `missing user returns
USER_NOT_FOUND`, `orders requires userId`, `orders returns numeric order
fields`, and `bootstrap returns user orders settings announcements and menu`.
Use `assert.deepEqual` for the exact error bodies and assert the bootstrap
top-level keys are exactly `['announcements', 'menu', 'orders', 'settings',
'user']` after sorting.

- [ ] **Step 3: Add migration/config source tests**

Read `migrations/0000_initial_schema.sql` and `wrangler.jsonc` as text and
assert each table/index is guarded by `IF NOT EXISTS`, the binding is `DB`,
the database name is `bento-poc`, and no token-like strings occur in tracked
worker files.

- [ ] **Step 4: Run the new tests before implementation**

Run `npm.cmd test` from `worker-poc`. Expected result: the source migration
checks can run, while the API tests fail because `worker-poc/src/index.js`
does not yet export `handleRequest`. Record this as the intentional TDD
red-phase checkpoint; do not weaken the tests.

### Task 4: Implement the read-only Worker API

**Files:**
- Create: `worker-poc/src/index.js`

**Interfaces:**
- Exports `default.fetch(request, env)` for Wrangler.
- Exports `async function handleRequest(request, env, options = {})` for tests.
- Consumes `env.DB` through D1 `prepare().bind().first()/all()`.

- [ ] **Step 1: Add response and normalization helpers**

Implement JSON responses with `Content-Type: application/json`, read-only
CORS headers, stable error bodies, finite-number normalization, and
Asia/Taipei date formatting. Never include raw database errors in a response
or log access tokens/credentials.

- [ ] **Step 2: Add explicit D1 projections**

Implement `getUser`, `getOrders`, `getSettings`, `getAnnouncements`, and
`getMenu` using bound parameters. Use these exact projection lists:

```sql
SELECT line_user_id, display_name, pickup_floor, balance, role
FROM users WHERE line_user_id = ?

SELECT order_id, order_date, vendor, line_user_id, item_id, item_name,
       quantity, unit_price, subtotal, pickup_floor, note, created_at
FROM orders WHERE line_user_id = ?
ORDER BY order_date DESC, created_at DESC

SELECT setting_key, setting_value FROM settings ORDER BY setting_key ASC

SELECT id, title, content, start_date, end_date, enabled
FROM announcements ORDER BY start_date DESC, id ASC

SELECT menu_date, vendor, item_id, item_name, price, note, image_url
FROM menu ORDER BY menu_date ASC, vendor ASC, item_id ASC
```

`getSettings` reduces key/value rows to an object, `getAnnouncements` keeps
only enabled rows whose date window contains the injected/current date and
omits `enabled` from each response item, and `getMenu` returns the explicit
deterministic ordering above.

- [ ] **Step 3: Add route dispatch**

Dispatch only GET requests for `/api/health`, `/api/users/:lineUserId`,
`/api/orders`, and `/api/bootstrap`. Require non-blank `userId` for the last
two routes, return 404 `USER_NOT_FOUND` for missing users, and compose
bootstrap's four independent dataset reads with `Promise.all` after the user
lookup.

- [ ] **Step 4: Run the worker tests**

Run `npm.cmd test` from `worker-poc`. Expected result: PASS for all endpoint,
error, migration, config, and secret-scan assertions.

### Task 5: Verify locally and hand off without external writes

**Files:**
- Modify: none beyond the files listed above

**Interfaces:**
- Consumes all worker package scripts and the root manifest verification commands.
- Produces separate automated/manual verification evidence and a clean scope report.

- [ ] **Step 1: Install the pinned local Wrangler dependency**

From `worker-poc`, run `npm.cmd install`. Confirm the generated dependency
state stays under `worker-poc` and contains no credential files.

- [ ] **Step 2: Apply the migration to local D1 only**

Run `npm.cmd run db:migrations:local`. Then run
`npm.cmd run db:migrations:local` a second time and confirm Wrangler reports
no unapplied migration or otherwise completes without duplicate-table/index
errors. This proves both Wrangler bookkeeping and SQL guards are safe. Do
not run `db:migrations:remote`.

- [ ] **Step 3: Run the worker verification**

Run `npm.cmd run verify` from `worker-poc` and record the exact exit status and
test summary. The worker verification does not claim real Cloudflare runtime
or remote data evidence.

- [ ] **Step 4: Run the repository-required checks**

From the repository root, run exactly the manifest-declared commands with
Windows `npm.cmd` selection where applicable:

```powershell
node --test tests/strict-identity-ledger.test.cjs
npm.cmd run lint
npm.cmd run build
```

Confirm the diff contains no files under `src/`, `gas/`, Netlify config, or
Google Sheets assets.

- [ ] **Step 5: Capture final read-only status**

Run `git diff --check`, `git status --short --branch`,
`git diff --stat`, and `git diff --cached --stat`. Preserve all generated
source changes as an uncommitted working-tree diff per the user's explicit
instruction. Do not tag, commit, push, migrate remote, or deploy.
