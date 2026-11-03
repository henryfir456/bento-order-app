import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest, profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-09-08T04:00:00.000Z');

const call = async (database, path, who, options = {}) => {
  const response = await handleFormalRequest(
    request(path, { ...options, token: `${who}-token` }),
    { DB: database },
    { fetchImpl: profileFetch({ token: `${who}-token`, lineUserId: who, displayName: who }), now: NOW }
  );
  return { response, body: await response.json() };
};

const seedOrder = (database, id, { user = 'user-1', by = 'proxy-1', date = '2026-09-07', amount = 100, status = 'ACTIVE' } = {}) => {
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'v', '1樓', ?, ?, ?, 'line', ?, ?)
  `, id, user, user, date, amount, status, by, `${date}T03:00:00.000Z`, `${date}T03:00:00.000Z`);
};

const seed = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 0 });
  seedUser(database, { lineUserId: 'user-2', balance: 0 });
  seedUser(database, { lineUserId: 'user-3', balance: 0 });
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  seedUser(database, { lineUserId: 'proxy-1', role: 'ProxyAdmin', balance: 50 });
  seedOrder(database, 'o1', { amount: 100 });
  seedOrder(database, 'o2', { user: 'user-2', amount: 80 });
  seedOrder(database, 'o3', { user: 'user-3', amount: 999, status: 'CANCELLED' });
  seedOrder(database, 'o4', { user: 'proxy-1', amount: 70 });
  seedOrder(database, 'o5', { amount: 60, date: '2026-09-06' });
  return database;
};

const file = (database, date = '2026-09-07') => call(database, '/api/me/reimbursements', 'proxy-1', {
  method: 'POST', body: { orderDate: date, note: 'n' }
});

test('preview and request sum every active order of the day, including the requester own', async () => {
  const database = seed();
  const preview = await call(database, '/api/me/reimbursements/preview?date=2026-09-07', 'proxy-1');
  assert.equal(preview.body.amount, 250);
  assert.equal(preview.body.orderCount, 3);
  const created = await file(database);
  assert.equal(created.response.status, 200);
  assert.equal(created.body.request.amount, 250);
  assert.equal(created.body.request.status, 'PENDING');
  assert.equal(database.get("SELECT COUNT(*) AS c FROM user_notifications WHERE kind = 'REIMBURSEMENT_REQUESTED' AND user_id = 'admin-1'").c, 1);
  const dup = await file(database);
  assert.equal(dup.response.status, 409);
  assert.match(JSON.stringify(dup.body), /REIMBURSEMENT_ALREADY_REQUESTED/);
});

test('plain users and Admin cannot request; future date and empty day rejected', async () => {
  const database = seed();
  assert.equal((await call(database, '/api/me/reimbursements', 'user-1', { method: 'POST', body: { orderDate: '2026-09-07' } })).response.status, 403);
  assert.equal((await call(database, '/api/me/reimbursements', 'admin-1', { method: 'POST', body: { orderDate: '2026-09-07' } })).response.status, 403);
  assert.equal((await file(database, '2026-09-30')).response.status, 400);
  assert.equal((await file(database, '2026-09-01')).response.status, 409);
});

test('only Admin can list and decide', async () => {
  const database = seed();
  const created = await file(database);
  const id = created.body.request.requestId;
  assert.equal((await call(database, '/api/admin/reimbursements', 'proxy-1')).response.status, 403);
  assert.equal((await call(database, `/api/admin/reimbursements/${id}/approve`, 'proxy-1', { method: 'POST', body: {} })).response.status, 403);
  const list = await call(database, '/api/admin/reimbursements?status=PENDING', 'admin-1');
  assert.equal(list.body.requests.length, 1);
  assert.equal(list.body.requests[0].orders.length, 3);
});

test('approve credits balance once and is not repeatable', async () => {
  const database = seed();
  const id = (await file(database)).body.request.requestId;
  const first = await call(database, `/api/admin/reimbursements/${id}/approve`, 'admin-1', { method: 'POST', body: {} });
  assert.equal(first.response.status, 200);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'proxy-1'").balance, 300);
  const second = await call(database, `/api/admin/reimbursements/${id}/approve`, 'admin-1', { method: 'POST', body: {} });
  assert.equal(second.response.status, 409);
  const reject = await call(database, `/api/admin/reimbursements/${id}/reject`, 'admin-1', { method: 'POST', body: {} });
  assert.equal(reject.response.status, 409);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'proxy-1'").balance, 300);
  assert.equal(database.get("SELECT COUNT(*) AS c FROM balance_ledger WHERE type = 'TOPUP' AND user_id = 'proxy-1'").c, 1);
  assert.equal(database.get("SELECT amount FROM balance_ledger WHERE type = 'TOPUP' AND user_id = 'proxy-1'").amount, 250);
  assert.equal(database.get("SELECT COUNT(*) AS c FROM user_notifications WHERE kind = 'REIMBURSEMENT_REVIEWED' AND user_id = 'proxy-1'").c, 1);
  assert.equal((await file(database)).response.status, 409);
});

test('reject keeps balance, notifies, and allows re-requesting', async () => {
  const database = seed();
  const id = (await file(database)).body.request.requestId;
  const rejected = await call(database, `/api/admin/reimbursements/${id}/reject`, 'admin-1', { method: 'POST', body: { note: '重複' } });
  assert.equal(rejected.response.status, 200);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'proxy-1'").balance, 50);
  assert.equal(database.get("SELECT COUNT(*) AS c FROM user_notifications WHERE kind = 'REIMBURSEMENT_REVIEWED' AND user_id = 'proxy-1'").c, 1);
  assert.equal((await file(database)).response.status, 200);
});

test('only one open request per date across requesters; rejected date can be refiled by another', async () => {
  const database = seed();
  seedUser(database, { lineUserId: 'proxy-2', role: 'ProxyAdmin' });
  const first = await file(database);
  assert.equal(first.response.status, 200);
  const other = await call(database, '/api/me/reimbursements', 'proxy-2', {
    method: 'POST', body: { orderDate: '2026-09-07' }
  });
  assert.equal(other.response.status, 409);
  await call(database, `/api/admin/reimbursements/${first.body.request.requestId}/reject`, 'admin-1', { method: 'POST', body: {} });
  const refiled = await call(database, '/api/me/reimbursements', 'proxy-2', {
    method: 'POST', body: { orderDate: '2026-09-07' }
  });
  assert.equal(refiled.response.status, 200);
  assert.equal(refiled.body.request.amount, 250);
});
