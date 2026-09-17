import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getCustomerMenu } from '../src/domain/menu.js';
import { runAutomaticDailyOpening } from '../src/domain/automaticOpening.js';
import { handleFormalRequest } from '../src/formalWorker.js';
import { profileFetch, request, seedMenuVersion, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-09-17T01:00:00.000Z');
const USER_ID = 'user-921';
const LINE_USER_ID = 'line-user-921';
const LINE_TOKEN = 'line-token-921';

const taipeiMidnight = (dateOnly) => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return Date.UTC(year, month - 1, day) - (8 * 60 * 60 * 1000);
};

const call = async (database, path, options = {}) => {
  const response = await handleFormalRequest(
    request(path, { token: LINE_TOKEN, ...options }),
    { DB: database },
    {
      now: options.now || NOW,
      fetchImpl: profileFetch({
        token: LINE_TOKEN,
        lineUserId: LINE_USER_ID,
        displayName: '9/21 User'
      })
    }
  );
  return { response, body: await response.json() };
};

const seed921Database = async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: USER_ID,
    employeeId: '009921',
    lineUserId: LINE_USER_ID,
    displayName: '9/21 User',
    pickupFloor: '1樓',
    balance: 250
  });
  seedMenuVersion(database, {
    menuVersionId: 'he-shi-baseline-921',
    vendor: '禾拾',
    effectiveDate: '2026-09-01'
  });
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name,
      price, enabled, note, image_url, source_order
    ) VALUES ('he-shi-h1-921', 'he-shi-baseline-921', 'H1', 'BASE', '禾拾便當', 100, 1, '', '', 1)
  `);
  database.run(`
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, enabled, image_url, note, display_order,
      source_kind, source_table, source_record_id, identity_schema_version
    ) VALUES (
      'he-shi-change-921', '2026-09-17', '禾拾', 'H1', 'BASE',
      '禾拾便當（當週）', 105, 1, '', '', 1,
      'admin', 'test', 'he-shi-change-921', 2
    )
  `);

  const opening = await runAutomaticDailyOpening(database, taipeiMidnight('2026-09-17'));
  assert.deepEqual(opening, {
    status: 'OPENED',
    businessDate: '2026-09-17',
    targetDate: '2026-09-21',
    vendor: '禾拾'
  });
  return database;
};

test('9/21 automatic opening and normalized menu bootstrap preserve safe order mutation', async () => {
  const database = await seed921Database();
  const page = await call(database, '/api/order-page?targetDate=2026-09-21');
  assert.equal(page.response.status, 200);
  assert.equal(page.body.setting.order_date, '2026-09-21');
  assert.equal(page.body.setting.vendor, '禾拾');
  assert.equal(page.body.menu.length, 1);
  assert.equal(page.body.menu[0].item_name, '禾拾便當（當週）');

  // This is the same server-projected payload shape the frontend submits.
  const item = page.body.menu[0];
  const first = await call(database, '/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'order-921-first' },
    body: {
      targetDate: '2026-09-21',
      pickupFloor: '1樓',
      items: [{ menu_item_id: item.menu_item_id, quantity: 1 }]
    }
  });
  assert.equal(first.response.status, 200);
  assert.equal(first.body.newBalance, 145);

  const refreshedPage = await call(database, '/api/order-page?targetDate=2026-09-21');
  assert.equal(refreshedPage.response.status, 200);
  assert.equal(refreshedPage.body.myOrder.orderId, first.body.orderId);
  assert.equal(refreshedPage.body.myOrder.items[0].selection_key, item.selection_key);

  const replacement = await call(database, '/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'order-921-replacement' },
    body: {
      targetDate: '2026-09-21',
      pickupFloor: '9樓',
      items: [{ menu_item_id: refreshedPage.body.menu[0].menu_item_id, quantity: 1 }]
    }
  });
  assert.equal(replacement.response.status, 200);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM orders WHERE user_id = ? AND order_date = ? AND status = 'ACTIVE'",
    USER_ID,
    '2026-09-21'
  ).count, 1);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM orders WHERE user_id = ? AND order_date = ? AND status = 'CANCELLED'",
    USER_ID,
    '2026-09-21'
  ).count, 1);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM balance_ledger WHERE user_id = ? AND type = 'REFUND'",
    USER_ID
  ).count, 1);
  assert.equal(database.get('SELECT balance FROM users WHERE user_id = ?', USER_ID).balance, 145);
});

test('9/21 active-order conflict guard remains enforced when replacement is disabled', async () => {
  const database = await seed921Database();
  const menu = await getCustomerMenu(database, { vendor: '禾拾', targetDate: '2026-09-21' });
  const body = {
    targetDate: '2026-09-21',
    pickupFloor: '1樓',
    items: [{ menu_item_id: menu[0].menu_item_id, quantity: 1 }]
  };
  const first = await call(database, '/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'order-921-guard-first' },
    body
  });
  assert.equal(first.response.status, 200);

  const rejectedReplacement = await call(database, '/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'order-921-guard-no-replace' },
    body: { ...body, replaceExisting: false }
  });
  assert.equal(rejectedReplacement.response.status, 409);
  assert.equal(rejectedReplacement.body.error, 'ORDER_ALREADY_ACTIVE');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders WHERE status = \'ACTIVE\'').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 1);
});
