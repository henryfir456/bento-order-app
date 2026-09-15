# Automatic Daily Group Opening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an idempotent Cloudflare Cron-triggered Worker opening for the second following Taiwan business day.

**Architecture:** `formalWorker.js` will expose `scheduled(controller, env)` and delegate to a focused automatic-opening domain module. That module will convert the scheduled epoch to an Asia/Taipei date, calculate the target weekday, and call a shared calendar-setting persistence helper extracted from `setCalendarSetting`; the helper will use a conditional SQLite upsert so an existing nonblank vendor is never overwritten.

**Tech Stack:** Cloudflare Worker, D1/SQLite, JavaScript ES modules, Node built-in test runner, Wrangler JSONC.

**Spec:** `docs/superpowers/specs/2026-09-15-automatic-daily-group-opening-design.md`

## Global Constraints

- Cron expression is exactly `0 16 * * *` because Cloudflare cron is UTC and Taipei midnight is UTC 16:00.
- The scheduled date comes from `controller.scheduledTime`, not the current process clock.
- Monday-Friday runs target the second following Monday-Friday date; Saturday/Sunday runs do nothing.
- Only the canonical vendor `禾拾` is automatically opened, using mode `B` already required by the normal Admin path.
- The actual D1 write must be conditional and atomic; no prior-SELECT plus unconditional upsert is sufficient.
- Existing manual `vendor_source` semantics, authentication, frontend behavior, menu/version/image behavior, historical data, and audit actor semantics remain unchanged.
- No migration, remote D1 mutation, deploy, commit, or push is performed.

---

### Task 1: Add and test the Taipei business-day calculation

**Files:**
- Create: `worker-poc/src/domain/businessDays.js`
- Test: `worker-poc/tests/automatic-opening.test.js`

**Interfaces:**
- Produces `secondFollowingBusinessDay(dateOnly)` returning a `YYYY-MM-DD` target or `null` for weekends.
- Produces `scheduledBusinessDates(scheduledTime)` returning `{ businessDate, targetDate }` using the existing `getTaipeiDate` and `resolveClock` helpers.

- [ ] **Step 1: Write the failing date tests**

```js
test('second following business day mappings', () => {
  assert.equal(secondFollowingBusinessDay('2026-09-14'), '2026-09-16');
  assert.equal(secondFollowingBusinessDay('2026-09-15'), '2026-09-17');
  assert.equal(secondFollowingBusinessDay('2026-09-16'), '2026-09-18');
  assert.equal(secondFollowingBusinessDay('2026-09-17'), '2026-09-21');
  assert.equal(secondFollowingBusinessDay('2026-09-18'), '2026-09-22');
  assert.equal(secondFollowingBusinessDay('2026-09-19'), null);
  assert.equal(secondFollowingBusinessDay('2026-09-20'), null);
});

test('scheduled time is converted to the explicit Taipei calendar date', () => {
  assert.deepEqual(
    scheduledBusinessDates(new Date('2026-09-07T15:59:59.999Z')),
    { businessDate: '2026-09-07', targetDate: '2026-09-09' }
  );
  assert.deepEqual(
    scheduledBusinessDates(new Date('2026-09-07T16:00:00.000Z')),
    { businessDate: '2026-09-08', targetDate: '2026-09-10' }
  );
});

test('business-day calculation crosses month and year boundaries', () => {
  assert.equal(secondFollowingBusinessDay('2026-12-31'), '2027-01-04');
  assert.equal(secondFollowingBusinessDay('2027-01-29'), '2027-02-02');
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node.exe --test worker-poc/tests/automatic-opening.test.js`

Expected: FAIL because `businessDays.js` and the scheduled behavior do not yet exist.

- [ ] **Step 3: Implement the pure helper**

Use UTC-midnight date arithmetic so date-only values do not depend on the
machine timezone:

```js
import { getTaipeiDate, isDateOnly } from './deadlines.js';
import { resolveClock } from '../db/transactions.js';

const weekday = (date) => date.getUTCDay();
const nextDate = (date) => new Date(Date.UTC(
  date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1
));
const formatDate = (date) => date.toISOString().slice(0, 10);

export const secondFollowingBusinessDay = (dateOnly) => {
  if (!isDateOnly(dateOnly)) return null;
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (weekday(date) === 0 || weekday(date) === 6) return null;
  let count = 0;
  while (count < 2) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (weekday(date) !== 0 && weekday(date) !== 6) count += 1;
  }
  return formatDate(date);
};

export const scheduledBusinessDates = (scheduledTime) => {
  const businessDate = getTaipeiDate(resolveClock(scheduledTime));
  return { businessDate, targetDate: secondFollowingBusinessDay(businessDate) };
};
```

Remove any unused helper introduced by the implementation and keep the
exported contract limited to these two functions.

- [ ] **Step 4: Run the date tests**

Run: `node.exe --test worker-poc/tests/automatic-opening.test.js`

Expected: the date mapping, midnight boundary, and month/year boundary tests pass; later persistence tests may still fail until Task 2 is complete.

### Task 2: Extract shared calendar persistence and add the atomic automatic opening

**Files:**
- Modify: `worker-poc/src/routes/calendar.js`
- Create: `worker-poc/src/domain/automaticOpening.js`
- Test: `worker-poc/tests/automatic-opening.test.js`

**Interfaces:**
- Produces `persistCalendarSetting(database, input, clock)` as the shared transactional write used by both manual and scheduled opening.
- Produces `runAutomaticDailyOpening(database, scheduledTime)` returning an outcome with `status`, `businessDate`, `targetDate`, and (when opened) `vendor`.

- [ ] **Step 1: Add failing persistence/outcome tests**

```js
test('missing target group creates 禾拾 exactly once and uses existing mode B', async () => {
  const database = new SqliteD1();
  const first = await runAutomaticDailyOpening(database, Date.parse('2026-09-14T16:00:00.000Z'));
  const second = await runAutomaticDailyOpening(database, Date.parse('2026-09-14T16:00:00.000Z'));

  assert.deepEqual(first, {
    status: 'OPENED', businessDate: '2026-09-15', targetDate: '2026-09-17', vendor: '禾拾'
  });
  assert.equal(second.status, 'SKIP_ALREADY_OPEN');
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM calendar_settings WHERE order_date = '2026-09-17'"
  ).count, 1);
  assert.deepEqual({ ...database.get(
    "SELECT vendor, mode, vendor_source, updated_by_user_id, updated_by_auth_mode FROM calendar_settings WHERE order_date = '2026-09-17'"
  ) }, {
    vendor: '禾拾', mode: 'B', vendor_source: 'CONFIGURED',
    updated_by_user_id: null, updated_by_auth_mode: null
  });
});

test('existing manual or automatic target group is never overwritten', async () => {
  const database = new SqliteD1();
  database.run(
    "INSERT INTO calendar_settings (order_date, vendor, mode) VALUES ('2026-09-17', 'Manual Vendor', 'A')"
  );
  const result = await runAutomaticDailyOpening(database, Date.parse('2026-09-14T16:00:00.000Z'));
  assert.equal(result.status, 'SKIP_ALREADY_OPEN');
  assert.deepEqual(database.get(
    "SELECT vendor, mode FROM calendar_settings WHERE order_date = '2026-09-17'"
  ), { vendor: 'Manual Vendor', mode: 'A' });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node.exe --test worker-poc/tests/automatic-opening.test.js`

Expected: FAIL because no automatic opening domain function exists.

- [ ] **Step 3: Implement shared persistence with a conditional upsert**

Refactor the existing `setCalendarSetting` body so manual calls and the new
automatic call both use one helper. Keep manual validation and `assertCan`
outside the helper. For the automatic case, the write must use this shape:

```sql
INSERT INTO calendar_settings (
  order_date, vendor, mode, vendor_source, updated_by_user_id,
  created_at, updated_at
)
VALUES (?, ?, ?, 'CONFIGURED', NULL, ?, ?)
ON CONFLICT(order_date) DO UPDATE SET
  vendor = excluded.vendor,
  mode = excluded.mode,
  vendor_source = 'CONFIGURED',
  updated_by_user_id = NULL,
  updated_at = excluded.updated_at
WHERE length(trim(calendar_settings.vendor)) = 0
```

Execute this statement through `runMutationBatch`, inspect its result change
count, and only report `OPENED` when exactly one row was inserted or updated.
If the change count is zero, read the current setting for logging/result
context and report `SKIP_ALREADY_OPEN`; never issue an unconditional retry.
Manual persistence continues to upsert unconditionally and append the
existing `CALENDAR_SETTING_UPDATED` audit event with the authenticated actor.

- [ ] **Step 4: Implement the automatic domain service**

`runAutomaticDailyOpening` will call `scheduledBusinessDates`, return a
weekend no-op before any D1 write, and otherwise call the shared persistence
helper with `vendor: CANONICAL_HE_SHI_VENDOR`, `mode: 'B'`, and the scheduled
timestamp as the clock. Use the existing `normalizeMenuVendor` constant and
do not read or write menu tables.

- [ ] **Step 5: Add concurrent invocation coverage**

Call `Promise.all` with two `runAutomaticDailyOpening` calls for the same
scheduled time against the same `SqliteD1` instance. Assert that the database
has one target row, both outcomes are limited to `OPENED` and
`SKIP_ALREADY_OPEN`, and no vendor other than `禾拾` is stored.

- [ ] **Step 6: Run the focused test**

Run: `node.exe --test worker-poc/tests/automatic-opening.test.js`

Expected: all date, conditional-write, exactly-once, existing-assignment,
concurrency, weekend, and mode/provenance assertions pass.

### Task 3: Wire the Cloudflare scheduled entry point, logging, configuration, and regression set

**Files:**
- Modify: `worker-poc/src/formalWorker.js`
- Modify: `worker-poc/wrangler.jsonc`
- Modify: `worker-poc/tests/automatic-opening.test.js`
- Modify: `worker-poc/tests/runtime-config.test.js`
- Modify: `worker-poc/package.json`

**Interfaces:**
- `formalWorker.js` default export gains `scheduled(controller, env)` while retaining the existing `fetch` export unchanged.
- `handleScheduled(controller, env, { logger } = {})` logs structured automatic-opening outcomes and returns the domain outcome for tests.

- [ ] **Step 1: Add failing handler/config/logging tests**

```js
test('scheduled handler logs a structured automatic opening outcome', async () => {
  const database = new SqliteD1();
  const lines = [];
  const result = await handleScheduled(
    { scheduledTime: Date.parse('2026-09-14T16:00:00.000Z') },
    { DB: database },
    { logger: { log: (line) => lines.push(line) } }
  );
  assert.equal(result.status, 'OPENED');
  assert.deepEqual(JSON.parse(lines[0]), {
    event: 'automatic_daily_group_opening',
    source: 'automatic_daily_cron',
    status: 'OPENED',
    businessDate: '2026-09-15',
    targetDate: '2026-09-17',
    vendor: '禾拾'
  });
});

test('formal Wrangler config schedules only the formal Worker at Taipei midnight', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.triggers?.crons, ['0 16 * * *']);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node.exe --test worker-poc/tests/automatic-opening.test.js worker-poc/tests/runtime-config.test.js`

Expected: FAIL because the scheduled entry point, structured logger, and cron configuration are not yet present.

- [ ] **Step 3: Wire the scheduled entry point and structured logs**

Add `handleScheduled` and export it for tests. The default Worker object will
delegate its `scheduled(controller, env)` method to `handleScheduled`. Log one
JSON object per invocation with `event`, `source`, `status`, `businessDate`,
`targetDate`, and `vendor` when present. Weekend runs must log a no-op status
without calling D1. Preserve `fetch` and all request/auth behavior byte-for-
byte except for the required import/export additions.

- [ ] **Step 4: Add the exact formal Wrangler trigger**

Add this top-level JSONC property to `worker-poc/wrangler.jsonc`:

```json
"triggers": {
  "crons": ["0 16 * * *"]
}
```

Do not add the trigger to the legacy local-only POC config.

- [ ] **Step 5: Register the focused Worker test in the existing Worker test scripts and runtime assertions**

Add `tests/automatic-opening.test.js` to the explicit test file lists in
`worker-poc/package.json`, and assert the formal config trigger in
`worker-poc/tests/runtime-config.test.js`. Do not change frontend scripts.

- [ ] **Step 6: Run focused regression tests**

Run: `node.exe --test worker-poc/tests/automatic-opening.test.js worker-poc/tests/calendar-admin.test.js worker-poc/tests/runtime-config.test.js worker-poc/tests/formal-schema.test.js`

Expected: PASS with the new scheduled behavior and existing calendar/schema/config behavior intact.

### Task 4: Run governed verification and inspect the final diff

**Files:**
- Verify: all changed files in `worker-poc/` and the two uncommitted design/plan documents.

- [ ] **Step 1: Run the repository-declared test command**

Run: `node.exe --test tests/strict-identity-ledger.test.cjs`

Expected: the same three baseline failures remain attributable to the pre-existing baseline, with no new failure from this Worker-only change.

- [ ] **Step 2: Run repository-declared lint and build**

Run: `npm.cmd run lint`

Expected: exit 0 with only the captured existing warnings.

Run: `npm.cmd run build`

Expected: exit 0; the frontend build remains behaviorally unchanged.

- [ ] **Step 3: Run the complete formal Worker test script**

Run: `npm.cmd test --prefix worker-poc`

Expected: exit 0 with the new automatic-opening tests included.

- [ ] **Step 4: Inspect scope and diff integrity**

Run: `git diff --check; git status --short; git diff --stat; git diff -- worker-poc/src/formalWorker.js worker-poc/src/routes/calendar.js worker-poc/src/domain/businessDays.js worker-poc/src/domain/automaticOpening.js worker-poc/wrangler.jsonc worker-poc/tests/automatic-opening.test.js worker-poc/tests/runtime-config.test.js worker-poc/package.json`

Expected: only requested Worker/config/test/docs files are changed; no
migration file, frontend file, remote D1 artifact, commit, or deployment is
present.
