import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { profileFetch, request, seedMenuVersion, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-09-07T01:00:00.000Z');
const EMPLOYEE_ID = '001234';
const USER_ID = 'employee-user-001234';

const call = async (database, path, options = {}, runtime = {}) => {
  const response = await handleFormalRequest(
    request(path, options),
    { DB: database },
    {
      now: runtime.now || NOW,
      fetchImpl: runtime.fetchImpl || profileFetch()
    }
  );
  return { response, body: await response.json() };
};

const guestLogin = (database) => call(
  database,
  '/api/auth/employee-guest',
  { method: 'POST', body: { employeeId: EMPLOYEE_ID } }
);

const seedGuestDatabase = () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: USER_ID,
    employeeId: EMPLOYEE_ID,
    lineUserId: null,
    displayName: 'Guest Admin',
    pickupFloor: '1樓',
    balance: 100,
    role: 'Admin'
  });
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-09-08', 'Vendor A', 'A')
  `);
  seedMenuVersion(database, {
    menuVersionId: 'guest-version',
    vendor: 'Vendor A',
    effectiveDate: '2026-09-01'
  });
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, source_order
    ) VALUES ('guest-menu', 'guest-version', 'G01', 'Guest Bento', 80, 1, 1)
  `);
  return database;
};

test('unbound active employee can use a restricted guest session for self-service ordering', async () => {
  const database = seedGuestDatabase();
  const invalid = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: 1234 }
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'INVALID_EMPLOYEE_ID');

  const login = await guestLogin(database);
  assert.equal(login.response.status, 201);
  assert.equal(login.body.authMode, 'employee_guest');
  assert.equal(login.body.user.userId, USER_ID);
  assert.equal(login.body.user.employeeId, EMPLOYEE_ID);
  assert.equal(login.body.user.lineUserId, null);
  assert.deepEqual(login.body.capabilities, ['READ_SELF', 'REGISTER_SELF', 'WRITE_SELF']);
  const guestToken = login.body.token;

  const me = await call(database, '/api/me', { token: guestToken });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.authMode, 'employee_guest');
  assert.equal(me.body.user.userId, USER_ID);
  assert.deepEqual(me.body.capabilities, ['READ_SELF', 'REGISTER_SELF', 'WRITE_SELF']);

  const forbiddenSummary = await call(
    database,
    '/api/admin/summary?date=2026-09-08',
    { token: guestToken }
  );
  assert.equal(forbiddenSummary.response.status, 403);
  const forbiddenTopUp = await call(database, '/api/admin/balances/top-up', {
    method: 'POST',
    token: guestToken,
    headers: { 'Idempotency-Key': 'guest-top-up' },
    body: { targetUserId: USER_ID, amount: 10 }
  });
  assert.equal(forbiddenTopUp.response.status, 403);

  const order = await call(database, '/api/orders', {
    method: 'POST',
    token: guestToken,
    headers: { 'Idempotency-Key': 'guest-order' },
    body: {
      userId: 'forged-user',
      targetDate: '2026-09-08',
      pickupFloor: '1樓',
      items: [{ menu_item_id: 'guest-menu', quantity: 1 }]
    }
  });
  assert.equal(order.response.status, 200);
  assert.equal(database.get('SELECT user_id FROM orders WHERE order_id = ?', order.body.orderId).user_id, USER_ID);
  assert.equal(database.get('SELECT created_auth_mode FROM orders WHERE order_id = ?', order.body.orderId).created_auth_mode, 'employee_guest');

  const history = await call(database, '/api/me/balance/history?month=2026-09', {
    token: guestToken
  });
  assert.equal(history.response.status, 200);
  assert.equal(history.body.openingBalance, 100);
  assert.equal(history.body.closingBalance, 20);

  const cancelled = await call(database, `/api/orders/${order.body.orderId}/cancel`, {
    method: 'POST',
    token: guestToken,
    headers: { 'Idempotency-Key': 'guest-cancel' }
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(database.get('SELECT status FROM orders WHERE order_id = ?', order.body.orderId).status, 'CANCELLED');
  assert.equal(database.get('SELECT balance FROM users WHERE user_id = ?', USER_ID).balance, 100);
});

test('missing employee guest ID returns a business 404 instead of a generic 500', async () => {
  const result = await call(new SqliteD1(), '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '139653' }
  });

  assert.equal(result.response.status, 404);
  assert.deepEqual(result.body, { error: 'EMPLOYEE_NOT_FOUND' });
});

test('LINE binding is canonical, idempotent, conflict-safe, and revokes every old guest session', async () => {
  const database = seedGuestDatabase();
  const firstLogin = await guestLogin(database);
  const secondLogin = await guestLogin(database);
  const firstToken = firstLogin.body.token;
  const secondToken = secondLogin.body.token;
  const lineProfile = profileFetch({
    token: 'line-token',
    lineUserId: 'line-001234',
    displayName: 'Bound LINE'
  });

  const binding = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'line-token',
    headers: { 'X-Employee-Guest-Session': firstToken }
  }, { fetchImpl: lineProfile });
  assert.equal(binding.response.status, 200);
  assert.equal(binding.body.status, 'BOUND');
  assert.equal(binding.body.user.userId, USER_ID);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);
  assert.deepEqual({
    ...database.get('SELECT user_id, employee_id, line_user_id FROM users WHERE user_id = ?', USER_ID)
  }, {
    user_id: USER_ID,
    employee_id: EMPLOYEE_ID,
    line_user_id: 'line-001234'
  });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM employee_guest_sessions WHERE revoked_at IS NOT NULL').count, 2);

  for (const token of [firstToken, secondToken]) {
    const stale = await call(database, '/api/me', { token });
    assert.equal(stale.response.status, 401);
    assert.equal(stale.body.error, 'GUEST_SESSION_INVALID');
  }

  const lineMe = await call(database, '/api/me', {
    token: 'line-token'
  }, { fetchImpl: lineProfile });
  assert.equal(lineMe.response.status, 200);
  assert.equal(lineMe.body.authMode, 'line');
  assert.equal(lineMe.body.user.userId, USER_ID);

  const replay = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'line-token',
    headers: { 'X-Employee-Guest-Session': firstToken }
  }, { fetchImpl: lineProfile });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.status, 'ALREADY_BOUND');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);

  const newLogin = await guestLogin(database);
  assert.equal(newLogin.response.status, 409);
  assert.equal(newLogin.body.error, 'EMPLOYEE_ALREADY_LINE_BOUND');

  const conflictDatabase = seedGuestDatabase();
  seedUser(conflictDatabase, {
    userId: 'other-user',
    employeeId: '009999',
    lineUserId: 'line-taken',
    displayName: 'Other employee'
  });
  const conflictLogin = await guestLogin(conflictDatabase);
  const conflict = await call(conflictDatabase, '/api/auth/line-bind', {
    method: 'POST',
    token: 'line-conflict-token',
    headers: { 'X-Employee-Guest-Session': conflictLogin.body.token }
  }, {
    fetchImpl: profileFetch({ token: 'line-conflict-token', lineUserId: 'line-taken' })
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error, 'LINE_ALREADY_BOUND');
  assert.equal(conflictDatabase.get('SELECT line_user_id FROM users WHERE user_id = ?', USER_ID).line_user_id, null);
  assert.equal(conflictDatabase.get('SELECT revoked_at FROM employee_guest_sessions WHERE user_id = ?', USER_ID).revoked_at, null);
});
