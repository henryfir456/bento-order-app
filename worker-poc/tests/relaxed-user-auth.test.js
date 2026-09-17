import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGuestSession } from '../src/auth/guestSession.js';
import { handleFormalRequest } from '../src/formalWorker.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-09-17T01:00:00.000Z');

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

const seedNormalUser = ({
  userId,
  employeeId,
  lineUserId = null,
  displayName = 'Normal User',
  pickupFloor = '1樓'
}) => {
  const database = new SqliteD1();
  seedUser(database, {
    userId,
    employeeId,
    lineUserId,
    displayName,
    pickupFloor,
    role: 'User',
    verificationStatus: 'VERIFIED'
  });
  return database;
};

test('normal User can use LINE-only login and retains canonical identity', async () => {
  const database = seedNormalUser({
    userId: 'user-line-only',
    employeeId: '001001',
    lineUserId: 'line-user-only'
  });
  const result = await call(database, '/api/me', {
    token: 'line-token'
  }, {
    fetchImpl: profileFetch({
      token: 'line-token',
      lineUserId: 'line-user-only',
      displayName: 'LINE User'
    })
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.registered, true);
  assert.equal(result.body.authMode, 'line');
  assert.equal(result.body.user.userId, 'user-line-only');
  assert.equal(result.body.user.role, 'User');
});

test('normal User can use employee-only login and order against the same canonical user', async () => {
  const database = seedNormalUser({
    userId: 'user-employee-only',
    employeeId: '001002'
  });
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-09-18', 'Vendor A', 'A')
  `);
  const login = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '001002' }
  });

  assert.equal(login.response.status, 201);
  assert.equal(login.body.user.userId, 'user-employee-only');
  assert.equal(login.body.registered, true);

  const me = await call(database, '/api/me', { token: login.body.token });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.registered, true);
  assert.equal(me.body.user.userId, 'user-employee-only');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);
});

test('normal User with existing LINE binding can still employee-login without changing ownership', async () => {
  const database = seedNormalUser({
    userId: 'user-alternate-login',
    employeeId: '001003',
    lineUserId: 'line-existing-001003'
  });
  const login = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '001003' }
  });

  assert.equal(login.response.status, 201);
  assert.equal(login.body.user.userId, 'user-alternate-login');
  assert.equal(login.body.registered, true);
  const me = await call(database, '/api/me', { token: login.body.token });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.userId, 'user-alternate-login');
  assert.equal(database.get(
    'SELECT line_user_id FROM users WHERE user_id = ?',
    'user-alternate-login'
  ).line_user_id, 'line-existing-001003');
});

test('LINE employee resolution returns the existing normal canonical User on ownership conflict', async () => {
  const database = seedNormalUser({
    userId: 'user-target-001004',
    employeeId: '001004',
    lineUserId: 'line-owned-elsewhere'
  });
  seedUser(database, {
    userId: 'user-current-line',
    employeeId: '001005',
    lineUserId: 'line-current-session',
    displayName: 'Current LINE owner',
    pickupFloor: '9樓',
    role: 'User'
  });
  const lineProfile = profileFetch({
    token: 'line-session-token',
    lineUserId: 'line-current-session',
    displayName: 'Current LINE owner'
  });

  const lookup = await call(database, '/api/auth/line-employee-lookup', {
    method: 'POST',
    token: 'line-session-token',
    body: { employeeId: '001004' }
  }, { fetchImpl: lineProfile });
  assert.equal(lookup.response.status, 200);
  assert.equal(lookup.body.status, 'FOUND');
  assert.equal(lookup.body.user.employeeId, '001004');

  const resolution = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: 'line-session-token',
    body: { employeeId: '001004' }
  }, { fetchImpl: lineProfile });
  assert.equal(resolution.response.status, 200);
  assert.equal(resolution.body.status, 'RESOLVED');
  assert.equal(resolution.body.resolution, 'EMPLOYEE_SESSION');
  assert.equal(resolution.body.ownershipChanged, false);
  assert.equal(resolution.body.authMode, 'employee_guest');
  assert.equal(resolution.body.user.userId, 'user-target-001004');

  const me = await call(database, '/api/me', { token: resolution.body.token });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.registered, true);
  assert.equal(me.body.user.userId, 'user-target-001004');
  assert.deepEqual({
    ...database.get('SELECT line_user_id FROM users WHERE user_id = ?', 'user-target-001004')
  }, { line_user_id: 'line-owned-elsewhere' });
  assert.deepEqual({
    ...database.get('SELECT line_user_id FROM users WHERE user_id = ?', 'user-current-line')
  }, { line_user_id: 'line-current-session' });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 2);
});

for (const role of ['Admin', 'ProxyAdmin']) {
  test(`${role} employee-only login cannot obtain an elevated principal`, async () => {
    const database = seedNormalUser({
      userId: `elevated-${role.toLowerCase()}`,
      employeeId: role === 'Admin' ? '009001' : '009002',
      displayName: `${role} employee`
    });
    database.run(
      'UPDATE users SET role = ? WHERE user_id = ?',
      role,
      `elevated-${role.toLowerCase()}`
    );

    const login = await call(database, '/api/auth/employee-guest', {
      method: 'POST',
      body: { employeeId: role === 'Admin' ? '009001' : '009002' }
    });
    assert.equal(login.response.status, 403);
    assert.equal(login.body.error, 'ADMIN_LINE_AUTH_REQUIRED');
  });
}

test('legacy elevated employee_guest session is fail-closed and cannot bootstrap admin capabilities', async () => {
  for (const role of ['Admin', 'ProxyAdmin']) {
    const database = seedNormalUser({
      userId: `legacy-${role.toLowerCase()}`,
      employeeId: role === 'Admin' ? '009011' : '009012',
      displayName: `${role} legacy session`
    });
    database.run(
      'UPDATE users SET role = ? WHERE user_id = ?',
      role,
      `legacy-${role.toLowerCase()}`
    );
    const session = await createGuestSession(database, {
      userId: `legacy-${role.toLowerCase()}`,
      employeeId: role === 'Admin' ? '009011' : '009012',
      status: 'VERIFIED',
      clock: NOW
    });

    const me = await call(database, '/api/me', { token: session.token });
    assert.equal(me.response.status, 403);
    assert.equal(me.body.error, 'ADMIN_LINE_AUTH_REQUIRED');

    const bootstrap = await call(database, '/api/bootstrap', { token: session.token });
    assert.equal(bootstrap.response.status, 403);
    const summary = await call(database, '/api/admin/summary?date=2026-09-18', {
      token: session.token
    });
    assert.equal(summary.response.status, 403);
  }
});
