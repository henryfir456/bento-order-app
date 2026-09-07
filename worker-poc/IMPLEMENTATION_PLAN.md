# Bootstrap Contract Parity and Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing `bento-api-poc` Worker expose a production-GAS-equivalent primary bootstrap, separate deferred and order-page contracts, verify parity from a machine-readable fixture, and provide a serial cold/warm benchmark harness.

**Architecture:** Keep the existing Worker and D1 POC as one service. The default `/api/bootstrap` is the GAS primary bootstrap contract; `/api/bootstrap/deferred` and `/api/order-page` model the production follow-up contracts. Existing `/api/users/:id` and `/api/orders` remain diagnostic endpoints and are excluded from primary parity.

**Tech Stack:** Cloudflare Workers modules, D1/SQLite SQL, Wrangler 4.129.0, Node.js built-in `node:test`, PowerShell-compatible Node scripts, JSON fixtures.

**Spec:** Approved implementation design in the conversation; no root-level design/spec file is added so all task changes remain under `worker-poc/**`.

## Global Constraints

- Modify only `worker-poc/**`; do not change React, GAS, Netlify, Google Sheets, root scripts, or `0000_initial_schema.sql`.
- Do not change LIFF identity, View As, production writes, payment/order-write flows, or production routing.
- Do not commit or push.
- Keep the existing Worker/D1 POC resource names and remote deployment; do not create a second POC.
- `/api/bootstrap` compares only to GAS `getBootstrapData` with `deferUiData: true`.
- Deferred likes/announcements stay under `/api/bootstrap/deferred`; menu/deadline stay under `/api/order-page`.
- New migration `0001_bootstrap_parity.sql` is append-only, non-destructive, contains no production data, and is locally testable.
- Benchmark is serial, separates first request from warm samples, never writes access tokens, and cannot claim a speed result until parity passes.

---

### Task 1: Add the canonical contract fixture and shared contract helpers

**Files:**
- Create: `worker-poc/contracts/bootstrap-contract.json`
- Create: `worker-poc/src/contract.js`
- Test: `worker-poc/tests/contract.test.js`

**Interfaces:**
- Fixture exports four named surfaces: `primaryBootstrap`, `deferredBootstrap`, `invalidActionFallback`, and `orderPage`.
- Shared helpers normalize the exact user, calendar event, deadline, orders-map, likes, announcements, menu, and error shapes used by Worker tests.

- [ ] **Step 1: Record the observed GAS shapes in JSON**

Include request inputs, required keys, optional/null fields, date/time formats, ordering rules, representative empty collections, and explicit intentional differences for token authentication, HTTP status, server timing, and Worker query identity.

- [ ] **Step 2: Implement pure response normalizers**

Keep normalization separate from D1 access so parity tests can compare frontend-observable fields without comparing GAS timing numbers or JSON byte ordering.

- [ ] **Step 3: Add fixture contract tests**

Assert all four surfaces have required metadata and that the fixture does not accidentally include deferred fields in the primary contract or menu/deadline fields in the primary contract.

### Task 2: Add the append-only D1 parity migration

**Files:**
- Create: `worker-poc/migrations/0001_bootstrap_parity.sql`
- Modify: `worker-poc/tests/index.test.js`

**Interfaces:**
- Produces `calendar_settings`, `likes`, and `order_status` tables plus indexes needed by primary/deferred/order-page queries.
- Does not edit or repeat `0000_initial_schema.sql`, insert data, or destructively alter existing tables.

- [ ] **Step 1: Write idempotent schema assertions**

Test that the new migration has guarded table/index creation, no insert/update/delete statements, and all required columns/constraints.

- [ ] **Step 2: Add the migration SQL**

Use `calendar_settings(order_date, vendor, mode)`, `likes(order_date, line_user_id, created_at)` with a unique user/date pair, and an `order_status(order_row_id, status)` overlay so existing orders remain active by default without altering the original table.

- [ ] **Step 3: Add local migration verification coverage**

Run the migration through Wrangler locally twice and assert no duplicate-object or destructive-operation failure.

### Task 3: Implement the three Worker contract routes

**Files:**
- Modify: `worker-poc/src/index.js`
- Modify: `worker-poc/tests/index.test.js`

**Interfaces:**
- `GET /api/bootstrap?userId=<id>&targetDate=<date>&bootId=<id>` returns the GAS primary frontend-observable contract.
- `GET /api/bootstrap/deferred?userId=<id>&bootId=<id>` returns likes and announcements only.
- `GET /api/order-page?userId=<id>&targetDate=<date>` returns setting, deadline, menu, and the user's active order shape.
- Existing `/api/users/:id` and `/api/orders?userId=` remain diagnostic/POC endpoints.

- [ ] **Step 1: Add Taipei date/deadline and stable ordering helpers**

Implement `YYYY-MM-DD`, ISO deadline, mode A/B, inclusive active-announcement windows, GAS announcement tie ordering, and source-row-equivalent deterministic D1 ordering.

- [ ] **Step 2: Add primary bootstrap queries and response composition**

Return `success`, `registered`, GAS-shaped `user`, `calendar.events`, empty primary announcements compatibility fields, `ordersMap`, `targetDate`, `bootId`, and safe observability timing. Do not return likes, active announcements, menu, deadline, or the old five-field payload.

- [ ] **Step 3: Add deferred UI queries and response composition**

Return only the deferred GAS semantics: `likes`, `announcements`, singular announcement compatibility, `success`, `registered`, `bootId`, and safe observability timing.

- [ ] **Step 4: Add order-page queries and response composition**

Select the latest menu version for the requested vendor/date, compute the deadline, and return the active user's order lines without putting these fields into primary bootstrap.

- [ ] **Step 5: Add safe errors and method/route guards**

Keep `USER_ID_REQUIRED`, `USER_NOT_FOUND`, `INVALID_DATE`, `METHOD_NOT_ALLOWED`, `NOT_FOUND`, and `INTERNAL_SERVER_ERROR` stable; never expose D1 errors or credentials.

### Task 4: Add contract parity tests

**Files:**
- Create: `worker-poc/tests/parity.test.js`
- Modify: `worker-poc/tests/index.test.js`

**Interfaces:**
- Tests use the canonical fixture and deterministic fake D1 rows.
- Comparisons ignore non-equivalent auth/timing transport details but assert all frontend-observable semantics.

- [ ] **Step 1: Test primary top-level and nested keys**

Assert required keys, absence of deferred/order-page leakage, user field types, calendar event fields, `ordersMap`, `targetDate`, and empty primary announcements behavior.

- [ ] **Step 2: Test deferred and order-page surfaces**

Assert likes map shape, nullable `calendarEvent`, announcement ordering/empty behavior, menu version selection, deadline formats, and active-order behavior.

- [ ] **Step 3: Test representative errors and empty data**

Cover missing user IDs, missing users, empty orders/likes/announcements/menu, malformed date input, and database failure without exposing internal errors.

- [ ] **Step 4: Test intentional differences explicitly**

Keep the fixture list synchronized with the Worker implementation and assert that differences are documented rather than silently tolerated.

### Task 5: Add the serial benchmark harness and reporting

**Files:**
- Create: `worker-poc/scripts/benchmark-bootstrap.mjs`
- Create: `worker-poc/scripts/benchmark-report.mjs`
- Modify: `worker-poc/package.json`
- Modify: `worker-poc/README.md`

**Interfaces:**
- Reads `GAS_API_URL` or `VITE_GAS_API_URL`, `WORKER_BOOTSTRAP_URL`, `BENCH_USER_ID`, `GAS_ACCESS_TOKEN`, `BENCH_ITERATIONS`, `BENCH_TIMEOUT_MS`, and optional output paths from the environment.
- Emits raw JSON with request samples and a Markdown/console summary without request headers, tokens, or response bodies.

- [ ] **Step 1: Implement one request runner per backend**

Use GAS POST `getBootstrapData` with `deferUiData: true` and Worker GET `/api/bootstrap` for the same logical user/date scenario. Measure client request elapsed time, status, error count, payload bytes, and available backend/server timing.

- [ ] **Step 2: Implement cold-ish and warm serial sampling**

Record the first request separately, then run at least 30 warm requests (default 50) with no concurrent requests and no LIFF initialization.

- [ ] **Step 3: Implement statistics and result serialization**

Calculate P50, P95, min, max, mean, payload bytes, status/error count, and GAS-vs-Worker differences. Keep raw samples JSON-readable.

- [ ] **Step 4: Add the parity gate**

Before benchmark execution, call the local parity test command or require a recorded parity PASS marker generated by the same run; refuse to print a speed recommendation when parity fails.

### Task 6: Verify local state and, only when external inputs are available, remote state

**Files:**
- Modify: `worker-poc/README.md`

**Interfaces:**
- Documents the exact Windows PowerShell commands and separates automated, remote, and manual evidence.

- [ ] **Step 1: Run Worker tests, parity tests, and local migration twice**

- [ ] **Step 2: Run root manifest test, lint, and build**

- [ ] **Step 3: If Cloudflare authentication is available, apply the new migration remotely, deploy the existing Worker, and smoke-test `/api/health`, `/api/bootstrap`, `/api/bootstrap/deferred`, and `/api/order-page`**

- [ ] **Step 4: If `GAS_ACCESS_TOKEN` is missing, stop at the external-input gate**

Report the exact required environment variable without writing the token to the repository.

- [ ] **Step 5: Run the benchmark only after parity PASS**

Report `KEEP GAS`, `CONTINUE D1 MIGRATION`, or `INCONCLUSIVE` only from recorded results and limitations.
