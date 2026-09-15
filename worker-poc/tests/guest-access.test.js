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

test('valid unknown employee IDs enter explicit provisional onboarding', async () => {
  const database = new SqliteD1();
  const result = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: ' 139653 ' }
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'UNVERIFIED_EMPLOYEE');
  assert.equal(result.body.identityState, 'NEW_PROVISIONAL_EMPLOYEE');
  assert.equal(result.body.verificationStatus, 'UNVERIFIED');
  assert.equal(result.body.employeeId, '139653');
  assert.equal(result.body.user, null);
  assert.deepEqual(result.body.capabilities, [
    'READ_SELF',
    'REGISTER_SELF',
    'WRITE_SELF'
  ]);
  const session = database.get(`
    SELECT user_id, employee_id, status
    FROM employee_guest_sessions
    WHERE token_hash = ?
  `, await import('../src/auth/guestSession.js').then(({ hashGuestToken }) => hashGuestToken(result.body.token)));
  assert.deepEqual({ ...session }, {
    user_id: null,
    employee_id: '139653',
    status: 'UNVERIFIED_EMPLOYEE'
  });

  const me = await call(database, '/api/me', { token: result.body.token });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.registered, false);
  assert.equal(me.body.status, 'UNVERIFIED_EMPLOYEE');
  assert.equal(me.body.identityState, 'NEW_PROVISIONAL_EMPLOYEE');
  assert.equal(me.body.employeeId, '139653');
  assert.equal(me.body.user, null);

  const forbiddenOrder = await call(database, '/api/orders', {
    method: 'POST',
    token: result.body.token,
    headers: { 'Idempotency-Key': 'provisional-order' },
    body: {
      targetDate: '2026-09-08',
      pickupFloor: '1樓',
      items: []
    }
  });
  assert.equal(forbiddenOrder.response.status, 403);
});

test('guest restore reconciles an existing unverified canonical user without attaching or recreating', async () => {
  const database = new SqliteD1();
  const guest = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '139653' }
  });
  const guestToken = guest.body.token;

  seedUser(database, {
    userId: 'reconciled-user-139653',
    employeeId: '139653',
    lineUserId: null,
    displayName: 'Existing provisional employee',
    pickupFloor: '1樓',
    verificationStatus: 'UNVERIFIED'
  });

  const restored = await call(database, '/api/me', { token: guestToken });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.body.authMode, 'employee_guest');
  assert.equal(restored.body.registered, false);
  assert.equal(restored.body.identityState, 'PENDING_VERIFICATION');
  assert.equal(restored.body.status, 'UNVERIFIED_EMPLOYEE');
  assert.equal(restored.body.user.userId, 'reconciled-user-139653');
  assert.equal(restored.body.user.lineUserId, null);
  assert.deepEqual(restored.body.capabilities, [
    'READ_SELF',
    'REGISTER_SELF',
    'WRITE_SELF'
  ]);
  assert.equal(database.get(`
    SELECT user_id FROM employee_guest_sessions WHERE token_hash = ?
  `, await import('../src/auth/guestSession.js').then(({ hashGuestToken }) => hashGuestToken(guestToken))).user_id, null);

  const profileUpdate = await call(database, '/api/me/pickup-floor', {
    method: 'PATCH',
    token: guestToken,
    body: { displayName: 'Reconciled profile', pickupFloor: '9樓' }
  });
  assert.equal(profileUpdate.response.status, 200);
  assert.equal(profileUpdate.body.identityState, 'PENDING_VERIFICATION');
  assert.equal(profileUpdate.body.user.userId, 'reconciled-user-139653');
  assert.equal(profileUpdate.body.user.lineUserId, null);
  assert.equal(profileUpdate.body.user.authSource, 'EMPLOYEE_GUEST');
  assert.equal(profileUpdate.body.user.identityState, 'PENDING_VERIFICATION');
  assert.equal(profileUpdate.body.user.verificationStatus, 'UNVERIFIED');
  assert.equal(profileUpdate.body.user.name, 'Reconciled profile');
  assert.equal(profileUpdate.body.user.floor, '9樓');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);

  const staleCreate = await call(database, '/api/auth/employee-guest/onboarding', {
    method: 'POST',
    token: '',
    headers: { 'X-Employee-Guest-Session': guestToken },
    body: { displayName: 'Should not create', pickupFloor: '1樓' }
  });
  assert.equal(staleCreate.response.status, 409);
  assert.deepEqual(staleCreate.body, { error: 'EMPLOYEE_ONBOARDING_CONFLICT' });
});

test('employee guest provisional onboarding completes without LINE and keeps a null binding', async () => {
  const database = new SqliteD1();
  const login = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '139653' }
  });
  const guestToken = login.body.token;
  const noLineFetch = async () => {
    throw new Error('LINE auth must not be requested for employee guest onboarding.');
  };

  const completion = await call(database, '/api/auth/employee-guest/onboarding', {
    method: 'POST',
    token: '',
    headers: { 'X-Employee-Guest-Session': guestToken },
    body: {
      displayName: 'Guest Provisional',
      pickupFloor: '9樓',
      lineUserId: 'forged-line-id'
    }
  }, { fetchImpl: noLineFetch });

  assert.equal(completion.response.status, 200);
  assert.equal(completion.body.status, 'UNVERIFIED_EMPLOYEE');
  assert.equal(completion.body.identityState, 'PENDING_VERIFICATION');
  assert.equal(completion.body.authMode, 'employee_guest');
  assert.equal(completion.body.verificationStatus, 'UNVERIFIED');
  assert.equal(completion.body.user.employeeId, '139653');
  assert.equal(completion.body.user.displayName, 'Guest Provisional');
  assert.equal(completion.body.user.lineUserId, null);
  assert.equal(completion.body.user.role, 'User');
  assert.equal(completion.body.user.active, true);
  assert.equal(completion.body.user.balance, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);
  assert.deepEqual({
    ...database.get(`
      SELECT user_id, employee_id, status, revoked_at
      FROM employee_guest_sessions
      WHERE token_hash = ?
    `, await import('../src/auth/guestSession.js').then(({ hashGuestToken }) => hashGuestToken(guestToken)))
  }, {
    user_id: completion.body.user.userId,
    employee_id: '139653',
    status: 'UNVERIFIED_EMPLOYEE',
    revoked_at: null
  });

  const replay = await call(database, '/api/auth/employee-guest/onboarding', {
    method: 'POST',
    token: '',
    headers: { 'X-Employee-Guest-Session': guestToken },
    body: { displayName: 'Different Name', pickupFloor: '1樓' }
  }, { fetchImpl: noLineFetch });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.user.userId, completion.body.user.userId);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);
});

test('legacy employee_guest onboarding may project roster verification, not LINE access', async () => {
  const database = new SqliteD1();
  database.run(`
    INSERT INTO employee_roster (roster_id, employee_id, active, provenance, source_ref)
    VALUES ('trusted-139653', '139653', 1, 'TRUSTED_IMPORT', 'roster.csv')
  `);
  const login = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '139653' }
  });
  assert.equal(login.body.status, 'UNVERIFIED_EMPLOYEE');
  assert.equal(login.body.identityState, 'NEW_PROVISIONAL_EMPLOYEE');

  const completion = await call(database, '/api/auth/employee-guest/onboarding', {
    method: 'POST',
    headers: { 'X-Employee-Guest-Session': login.body.token },
    body: { displayName: 'Trusted Guest', pickupFloor: '1樓' }
  });
  assert.equal(completion.response.status, 200);
  assert.equal(completion.body.status, 'VERIFIED');
  assert.equal(completion.body.identityState, 'VERIFIED');
  assert.equal(completion.body.verificationStatus, 'VERIFIED');
  assert.equal(completion.body.user.lineUserId, null);
  assert.equal(completion.body.user.authSource, 'EMPLOYEE_GUEST');
});

test('invalid employee IDs are rejected after trim and uppercase normalization', async () => {
  for (const employeeId of ['', '-ABC12', 'ABC/12', 'ＡＢＣ１２３', 139653]) {
    const result = await call(new SqliteD1(), '/api/auth/employee-guest', {
      method: 'POST',
      body: { employeeId }
    });
    assert.equal(result.response.status, 400, String(employeeId));
    assert.deepEqual(result.body, { error: 'INVALID_EMPLOYEE_ID' });
  }
  const normalized = await call(new SqliteD1(), '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: 'ab12cd' }
  });
  assert.equal(normalized.response.status, 200);
  assert.equal(normalized.body.employeeId, 'AB12CD');
});

test('LINE binding does not attach to an unbound canonical owner without a survivor claim', async () => {
  const database = seedGuestDatabase();
  const lineProfile = profileFetch({
    token: 'line-direct-token',
    lineUserId: 'line-direct-001234',
    displayName: 'Direct LINE'
  });

  const lookup = await call(database, '/api/auth/line-employee-lookup', {
    method: 'POST',
    token: 'line-direct-token',
    body: { employeeId: ' 001234 ' }
  }, { fetchImpl: lineProfile });
  assert.equal(lookup.response.status, 200);
  assert.equal(lookup.body.status, 'FOUND');
  assert.deepEqual(lookup.body.user, {
    employeeId: EMPLOYEE_ID,
    name: 'Guest Admin',
    floor: '1樓',
    defaultFloor: '1樓',
    verificationStatus: 'VERIFIED'
  });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM employee_guest_sessions').count, 0);

  const binding = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: 'line-direct-token',
    body: {
      employeeId: EMPLOYEE_ID,
      lineUserId: 'forged-line-id',
      displayName: 'Ignored for existing employee',
      pickupFloor: '9樓'
    }
  }, { fetchImpl: lineProfile });
  assert.equal(binding.response.status, 409);
  assert.deepEqual(binding.body, { error: 'EMPLOYEE_ID_ALREADY_BOUND' });
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', USER_ID).line_user_id, null);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM employee_guest_sessions').count, 0);
});

test('LINE canonical user without employee ID must bind an employee before application access', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'line-identity-without-employee',
    employeeId: null,
    lineUserId: 'line-unbound-identity',
    displayName: 'LINE-only identity',
    verificationStatus: 'UNVERIFIED'
  });
  const lineProfile = profileFetch({
    token: 'line-unbound-token',
    lineUserId: 'line-unbound-identity',
    displayName: 'LINE-only identity'
  });

  const me = await call(database, '/api/me', {
    token: 'line-unbound-token'
  }, { fetchImpl: lineProfile });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.registered, false);
  assert.equal(me.body.status, 'EMPLOYEE_BIND_REQUIRED');
  assert.equal(me.body.identityState, 'EMPLOYEE_BIND_REQUIRED');
  assert.equal(me.body.authMode, 'line');
  assert.equal(me.body.user.userId, 'line-identity-without-employee');
  assert.equal(me.body.user.employeeId, null);
  assert.deepEqual(me.body.capabilities, [
    'CAN_BIND_EMPLOYEE',
    'CAN_VIEW_SELF_ONBOARDING_STATE'
  ]);

  const binding = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: 'line-unbound-token',
    body: {
      employeeId: ' 139653 ',
      lineUserId: 'forged-line-id',
      displayName: 'Must not overwrite canonical profile',
      pickupFloor: '9樓'
    }
  }, { fetchImpl: lineProfile });
  assert.equal(binding.response.status, 200);
  assert.equal(binding.body.status, 'BOUND');
  assert.equal(binding.body.identityState, 'VERIFIED');
  assert.equal(binding.body.user.userId, 'line-identity-without-employee');
  assert.equal(binding.body.user.employeeId, '139653');
  assert.equal(binding.body.user.lineUserId, 'line-unbound-identity');
  assert.equal(binding.body.user.verificationStatus, 'UNVERIFIED');
  assert.equal(binding.body.user.displayName, 'LINE-only identity');
  assert.equal(binding.body.user.floor, '1樓');
  assert.equal(binding.body.user.balance, 0);
  assert.equal(binding.body.user.role, 'User');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);

  const replay = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: 'line-unbound-token',
    body: { employeeId: '139653' }
  }, { fetchImpl: lineProfile });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.status, 'ALREADY_BOUND');
  assert.equal(replay.body.user.userId, 'line-identity-without-employee');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);

  const refreshed = await call(database, '/api/me', {
    token: 'line-unbound-token'
  }, { fetchImpl: lineProfile });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.identityState, 'VERIFIED');
  assert.equal(refreshed.body.status, 'VERIFIED');
  assert.equal(refreshed.body.user.employeeId, '139653');
  assert.equal(refreshed.body.user.verificationStatus, 'UNVERIFIED');
  assert.deepEqual(refreshed.body.capabilities, [
    'READ_ADMIN_SUMMARY',
    'READ_SELF',
    'REGISTER_SELF',
    'WRITE_SELF'
  ]);
});

test('employee binding fails closed when the requested employee ID belongs to another canonical user', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'line-unbound-conflict-source',
    employeeId: null,
    lineUserId: 'line-conflict-source',
    displayName: 'LINE source'
  });
  seedUser(database, {
    userId: 'employee-139653-owner',
    employeeId: '139653',
    lineUserId: null,
    displayName: 'Existing employee'
  });
  const lineProfile = profileFetch({
    token: 'line-conflict-source-token',
    lineUserId: 'line-conflict-source',
    displayName: 'LINE source'
  });

  const conflict = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: 'line-conflict-source-token',
    body: { employeeId: '139653' }
  }, { fetchImpl: lineProfile });
  assert.equal(conflict.response.status, 409);
  assert.deepEqual(conflict.body, { error: 'EMPLOYEE_ID_ALREADY_BOUND' });
  assert.deepEqual({
    ...database.get(`
      SELECT employee_id, line_user_id
      FROM users WHERE user_id = ?
    `, 'line-unbound-conflict-source')
  }, {
    employee_id: null,
    line_user_id: 'line-conflict-source'
  });
});

test('employee guest credentials cannot use the direct LINE employee-binding endpoint', async () => {
  const database = new SqliteD1();
  const guest = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '139653' }
  });
  const rejected = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: guest.body.token,
    body: { employeeId: '139653' }
  }, {
    fetchImpl: profileFetch({
      token: 'line-token',
      lineUserId: 'line-should-not-authenticate'
    })
  });
  assert.equal(rejected.response.status, 401);
  assert.equal(rejected.body.error, 'TOKEN_INVALID');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 0);
});

test('LINE-authenticated unknown employee onboarding binds server LINE identity without a guest session', async () => {
  const database = new SqliteD1();
  const lineProfile = profileFetch({
    token: 'line-direct-provisional-token',
    lineUserId: 'line-direct-139653',
    displayName: 'Direct Provisional LINE'
  });

  const lookup = await call(database, '/api/auth/line-employee-lookup', {
    method: 'POST',
    token: 'line-direct-provisional-token',
    body: { employeeId: '139653' }
  }, { fetchImpl: lineProfile });
  assert.equal(lookup.response.status, 200);
  assert.equal(lookup.body.status, 'UNVERIFIED_EMPLOYEE');
  assert.equal(lookup.body.identityState, 'NEW_PROVISIONAL_EMPLOYEE');
  assert.equal(lookup.body.user, null);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM employee_guest_sessions').count, 0);

  const binding = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: 'line-direct-provisional-token',
    body: {
      employeeId: '139653',
      lineUserId: 'forged-line-id',
      displayName: 'Employee 139653',
      pickupFloor: '9樓'
    }
  }, { fetchImpl: lineProfile });
  assert.equal(binding.response.status, 200);
  assert.equal(binding.body.status, 'BOUND');
  assert.equal(binding.body.user.employeeId, '139653');
  assert.equal(binding.body.user.lineUserId, 'line-direct-139653');
  assert.equal(binding.body.user.verificationStatus, 'VERIFIED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM employee_guest_sessions').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);
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
  assert.deepEqual(newLogin.body, { error: 'LINE_LOGIN_REQUIRED' });

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

test('SQL-only imported non-LINE canonical user converges through employee guest proof and authenticated LINE bind', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'sql-imported-001234',
    employeeId: EMPLOYEE_ID,
    lineUserId: null,
    displayName: 'Legacy employee 001234',
    pickupFloor: '1樓',
    balance: 0,
    role: 'User',
    verificationStatus: 'UNVERIFIED'
  });
  const lineProfile = profileFetch({
    token: 'sql-import-line-token',
    lineUserId: 'line-sql-import-001234',
    displayName: 'Authenticated employee'
  });

  const directClaim = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: 'sql-import-line-token',
    body: {
      employeeId: EMPLOYEE_ID,
      displayName: 'Must not claim directly',
      pickupFloor: '9樓'
    }
  }, { fetchImpl: lineProfile });
  assert.equal(directClaim.response.status, 409);
  assert.deepEqual(directClaim.body, { error: 'EMPLOYEE_ID_ALREADY_BOUND' });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);

  const firstLogin = await guestLogin(database);
  const secondLogin = await guestLogin(database);
  assert.equal(firstLogin.response.status, 200);
  assert.equal(secondLogin.response.status, 200);
  assert.equal(firstLogin.body.user.userId, 'sql-imported-001234');
  assert.equal(secondLogin.body.user.userId, firstLogin.body.user.userId);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);

  const binding = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'sql-import-line-token',
    headers: { 'X-Employee-Guest-Session': firstLogin.body.token },
    body: {
      displayName: 'Ignored imported display name',
      pickupFloor: '9樓',
      lineUserId: 'forged-line-value'
    }
  }, { fetchImpl: lineProfile });
  assert.equal(binding.response.status, 200);
  assert.equal(binding.body.status, 'BOUND');
  assert.equal(binding.body.user.userId, 'sql-imported-001234');
  assert.equal(binding.body.user.lineUserId, 'line-sql-import-001234');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);

  const replay = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'sql-import-line-token',
    headers: { 'X-Employee-Guest-Session': firstLogin.body.token },
    body: { displayName: 'Replay', pickupFloor: '1樓' }
  }, { fetchImpl: lineProfile });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.status, 'ALREADY_BOUND');
  assert.equal(replay.body.user.userId, 'sql-imported-001234');

  const employeeAfterBind = await guestLogin(database);
  assert.equal(employeeAfterBind.response.status, 409);
  assert.deepEqual(employeeAfterBind.body, { error: 'LINE_LOGIN_REQUIRED' });
});

test('legacy guest-to-LINE binding creates a registered canonical user without roster gating', async () => {
  const database = new SqliteD1();
  const guest = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '139653' }
  });
  const lineProfile = profileFetch({
    token: 'line-provisional-token',
    lineUserId: 'line-139653',
    displayName: 'LINE Provisional'
  });
  const binding = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'line-provisional-token',
    headers: { 'X-Employee-Guest-Session': guest.body.token },
    body: {
      displayName: 'Employee 139653',
      pickupFloor: '9樓',
      lineUserId: 'forged-line-value'
    }
  }, { fetchImpl: lineProfile });

  assert.equal(binding.response.status, 200);
  assert.equal(binding.body.status, 'BOUND');
  assert.equal(binding.body.verificationStatus, 'VERIFIED');
  assert.equal(binding.body.user.employeeId, '139653');
  assert.equal(binding.body.user.lineUserId, 'line-139653');
  assert.equal(binding.body.user.balance, 0);
  assert.equal(binding.body.user.role, 'User');
  assert.equal(binding.body.user.verificationStatus, 'VERIFIED');
  const canonical = database.get(`
    SELECT user_id, employee_id, line_user_id, display_name, pickup_floor,
           balance, role, active, verification_status
    FROM users WHERE employee_id = ?
  `, '139653');
  assert.deepEqual({ ...canonical }, {
    user_id: binding.body.user.userId,
    employee_id: '139653',
    line_user_id: 'line-139653',
    display_name: 'Employee 139653',
    pickup_floor: '9樓',
    balance: 0,
    role: 'User',
    active: 1,
    verification_status: 'VERIFIED'
  });

  const replay = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'line-provisional-token',
    headers: { 'X-Employee-Guest-Session': guest.body.token },
    body: { displayName: 'Different Name', pickupFloor: '1樓' }
  }, { fetchImpl: lineProfile });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.status, 'ALREADY_BOUND');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);

  const lineMe = await call(database, '/api/me', {
    token: 'line-provisional-token'
  }, { fetchImpl: lineProfile });
  assert.equal(lineMe.response.status, 200);
  assert.equal(lineMe.body.registered, true);
  assert.equal(lineMe.body.status, 'VERIFIED');
  assert.equal(lineMe.body.identityState, 'VERIFIED');
  assert.deepEqual(lineMe.body.capabilities, [
    'READ_ADMIN_SUMMARY',
    'READ_SELF',
    'REGISTER_SELF',
    'WRITE_SELF'
  ]);

  const readable = await call(database, '/api/orders/map', {
    token: 'line-provisional-token'
  }, { fetchImpl: lineProfile });
  assert.notEqual(readable.response.status, 403);

  const profileUpdate = await call(database, '/api/me/pickup-floor', {
    method: 'PATCH',
    token: 'line-provisional-token',
    body: { displayName: 'Updated Employee 139653', pickupFloor: '1樓' }
  }, { fetchImpl: lineProfile });
  assert.equal(profileUpdate.response.status, 200);
  assert.equal(profileUpdate.body.status, 'VERIFIED');
  assert.equal(profileUpdate.body.verificationStatus, 'VERIFIED');
  assert.equal(profileUpdate.body.user.name, 'Updated Employee 139653');
  assert.equal(profileUpdate.body.user.floor, '1樓');

  const refreshed = await call(database, '/api/me', {
    token: 'line-provisional-token'
  }, { fetchImpl: lineProfile });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.body.registered, true);
  assert.equal(refreshed.body.status, 'VERIFIED');
  assert.equal(refreshed.body.user.name, 'Updated Employee 139653');
  assert.equal(refreshed.body.user.floor, '1樓');
  assert.equal(refreshed.body.user.verificationStatus, 'VERIFIED');

  const employeeOnly = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '139653' }
  });
  assert.equal(employeeOnly.response.status, 409);
  assert.deepEqual(employeeOnly.body, { error: 'LINE_LOGIN_REQUIRED' });
});
