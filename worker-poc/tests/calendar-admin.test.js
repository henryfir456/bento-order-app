import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { callOrderRoute, ORDER_DATE, seedOrderDatabase, userProfile } from './helpers/order-fixtures.js';

const call = async (database, path, options = {}, profile = {}) => {
  const response = await handleFormalRequest(
    request(path, options),
    { DB: database },
    {
      fetchImpl: profileFetch(profile),
      now: new Date('2026-09-08T00:00:00.000Z')
    }
  );
  return { response, body: await response.json() };
};

const databaseWithActors = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  seedUser(database, { lineUserId: 'proxy-1', role: 'ProxyAdmin' });
  seedUser(database, { lineUserId: 'user-1' });
  return database;
};

test('admin calendar upsert requires explicit mode, preserves blank vendor, and audits the actor', async () => {
  const database = databaseWithActors();
  const saved = await call(database, '/api/admin/calendar/2026-09-10', {
    method: 'PUT',
    token: 'admin-token',
    body: { vendor: '', mode: 'A' }
  }, { token: 'admin-token', lineUserId: 'admin-1' });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.setting.vendor, '');
  assert.equal(database.get("SELECT vendor_source FROM calendar_settings WHERE order_date = '2026-09-10'").vendor_source, 'CONFIGURED');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'CALENDAR_SETTING_UPDATED'").count, 1);

  const missingMode = await call(database, '/api/admin/calendar/2026-09-11', {
    method: 'PUT',
    token: 'admin-token',
    body: { vendor: 'Vendor A' }
  }, { token: 'admin-token', lineUserId: 'admin-1' });
  assert.equal(missingMode.response.status, 400);
  assert.equal(missingMode.body.error, 'CALENDAR_MODE_REQUIRED');

  const proxy = await call(database, '/api/admin/calendar/2026-09-12', {
    method: 'PUT',
    token: 'proxy-token',
    body: { vendor: 'Vendor A', mode: 'A', adminUserId: 'admin-1', role: 'Admin' }
  }, { token: 'proxy-token', lineUserId: 'proxy-1' });
  assert.equal(proxy.response.status, 200);
  assert.equal(proxy.body.setting.vendor, 'Vendor A');
  assert.equal(database.get("SELECT actor_user_id FROM admin_audit_log WHERE action = 'CALENDAR_SETTING_UPDATED' ORDER BY rowid DESC LIMIT 1").actor_user_id, 'proxy-1');

  const user = await call(database, '/api/admin/calendar/2026-09-13', {
    method: 'PUT',
    token: 'user-token',
    body: { vendor: 'Vendor A', mode: 'A', adminUserId: 'admin-1', role: 'Admin' }
  }, { token: 'user-token', lineUserId: 'user-1' });
  assert.equal(user.response.status, 403);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM calendar_settings WHERE order_date = '2026-09-13'").count, 0);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'CALENDAR_SETTING_UPDATED' AND actor_user_id = 'user-1'").count, 0);
});

test('calendar setting rejects unauthenticated requests before any mutation', async () => {
  const database = databaseWithActors();
  const response = await handleFormalRequest(
    new Request('https://formal.test/api/admin/calendar/2026-09-10', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor: 'Vendor A', mode: 'A' })
    }),
    { DB: database },
    { fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-1' }) }
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'AUTH_REQUIRED' });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM calendar_settings').count, 0);
});


test('admin group cancellation after cutoff cancels every active order and refunds exactly once', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const createOrder = (profile, key) => callOrderRoute(
    database,
    '/api/orders',
    {
      method: 'POST',
      body: {
        targetDate: ORDER_DATE,
        pickupFloor: profile.lineUserId === 'user-2' ? '9樓' : '1樓',
        items: [{ menu_item_id: 'menu-a', quantity: 1 }]
      },
      headers: { 'Idempotency-Key': key }
    },
    profile
  );

  const first = await createOrder(userProfile('user-1', 'token-user-1'), 'group-cancel-user-1');
  const second = await createOrder(userProfile('user-2', 'token-user-2'), 'group-cancel-user-2');
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);

  const closeRequest = () => handleFormalRequest(
    request(`/api/admin/calendar/${ORDER_DATE}`, {
      method: 'PUT',
      token: 'admin-token',
      body: { vendor: '', mode: 'A' }
    }),
    { DB: database },
    {
      fetchImpl: profileFetch({
        token: 'admin-token',
        lineUserId: 'admin-1',
        displayName: 'Admin One'
      }),
      now: new Date('2026-09-08T02:30:00.000Z')
    }
  );

  const closed = await closeRequest();
  const body = await closed.json();
  assert.equal(closed.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.cancellationSummary, {
    userCount: 2,
    orderCount: 2,
    totalQuantity: 2,
    totalAmount: 160
  });
  assert.equal(database.get(
    "SELECT vendor FROM calendar_settings WHERE order_date = ?",
    ORDER_DATE
  ).vendor, '');
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM orders WHERE order_date = ? AND status = 'CANCELLED'",
    ORDER_DATE
  ).count, 2);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'"
  ).count, 2);
  assert.equal(database.get(
    "SELECT balance FROM users WHERE user_id = 'user-1'"
  ).balance, 100);
  assert.equal(database.get(
    "SELECT balance FROM users WHERE user_id = 'user-2'"
  ).balance, 0);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM order_status_history WHERE reason = 'GROUP_CANCELLED'"
  ).count, 2);

  const repeated = await closeRequest();
  const repeatedBody = await repeated.json();
  assert.equal(repeated.status, 200);
  assert.equal(repeatedBody.cancellationSummary.orderCount, 0);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'"
  ).count, 2);
});

test('admin can close a group with no active orders', async () => {
  const database = databaseWithActors();
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-09-10', 'Vendor A', 'A')
  `);

  const result = await call(database, '/api/admin/calendar/2026-09-10', {
    method: 'PUT',
    token: 'admin-token',
    body: { vendor: '', mode: 'A' }
  }, { token: 'admin-token', lineUserId: 'admin-1' });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.setting.vendor, '');
  assert.equal(result.body.cancellationSummary.orderCount, 0);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'"
  ).count, 0);
});
