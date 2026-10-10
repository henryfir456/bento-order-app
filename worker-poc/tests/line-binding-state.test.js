import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleFormalRequest } from '../src/formalWorker.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-09-17T01:00:00Z');
const call = async (db, path, opts = {}, runtime = {}) => {
  const res = await handleFormalRequest(request(path, opts), { DB: db }, { now: NOW, fetchImpl: profileFetch({ token: 'line-token', lineUserId: 'bound-line' }), ...runtime });
  return { status: res.status, body: await res.json() };
};

for (const bound of [true, false]) {
  test(`employee identity/login/bootstrap expose persisted lineBound=${bound} without the LINE ID or elevation`, async () => {
    const db = new SqliteD1(); seedUser(db, { userId: 'canonical', employeeId: '001234', displayName: 'Test', lineUserId: bound ? 'bound-line' : null });
    const login = await call(db, '/api/auth/employee-guest', { method: 'POST', body: { employeeId: '001234' } });
    assert.equal(login.status, 201); assert.equal(login.body.user.lineBound, bound);
    assert.equal(login.body.user.lineUserId, null);
    for (const path of ['/api/me', '/api/bootstrap']) {
      const result = await call(db, path, { token: login.body.token });
      assert.equal(result.status, 200); assert.equal(result.body.user.lineBound, bound);
      assert.equal(result.body.lineBound, bound); assert.equal(result.body.authMode, 'employee_guest');
      assert.equal(result.body.user.lineUserId, null); assert.ok(!JSON.stringify(result.body).includes('bound-line'));
      assert.equal(result.body.user.role, 'User');
      for (const capability of ['ADMIN_TOP_UP', 'VIEW_AS', 'DELEGATE_ORDER', 'ADMIN_ROLE']) {
        assert.ok(!result.body.capabilities.includes(capability));
      }
    }
    for (const path of ['/api/admin/members/balances', '/api/me?viewAsUserId=other']) assert.equal((await call(db, path, { token: login.body.token })).status, 403);
    assert.equal(db.get('SELECT line_user_id FROM users WHERE user_id = ?', 'canonical').line_user_id, bound ? 'bound-line' : null);
  });
}

test('Issue #1 permanent LINE-first binding, replay and second login return the same canonical bound identity', async () => {
  const db = new SqliteD1(); seedUser(db, { userId: 'canonical', employeeId: '001234', displayName: 'Test', lineUserId: null });
  const before = await call(db, '/api/me', { token: 'line-token' });
  assert.equal(before.body.registered, false); assert.equal(before.body.lineBound, false);
  const bound = await call(db, '/api/auth/line-employee-bind', { method: 'POST', token: 'line-token', body: { employeeId: '001234' } });
  assert.equal(bound.status, 200); assert.equal(bound.body.authMode, 'line'); assert.equal(bound.body.user.lineBound, true);
  assert.equal(db.get('SELECT line_user_id FROM users WHERE user_id = ?', 'canonical').line_user_id, 'bound-line');
  const replay = await call(db, '/api/auth/line-employee-bind', { method: 'POST', token: 'line-token', body: { employeeId: '001234' } });
  assert.equal(replay.body.status, 'ALREADY_BOUND'); assert.equal(replay.body.user.lineBound, true);
  for (const path of ['/api/me', '/api/bootstrap']) {
    const result = await call(db, path, { token: 'line-token' });
    assert.equal(result.body.user.userId, 'canonical'); assert.equal(result.body.authMode, 'line'); assert.equal(result.body.user.lineBound, true);
  }
  assert.equal(db.get('SELECT COUNT(*) AS n FROM users').n, 1);
});

test('registered LINE/employee sessions agree on binding while employee stays guest and conflicts preserve ownership', async () => {
  const db = new SqliteD1(); seedUser(db, { userId: 'canonical', employeeId: '001234', lineUserId: 'bound-line' });
  const guest = await call(db, '/api/auth/employee-guest', { method: 'POST', body: { employeeId: '001234' } });
  const line = await call(db, '/api/me', { token: 'line-token' });
  const employee = await call(db, '/api/me', { token: guest.body.token });
  assert.equal(employee.body.user.userId, line.body.user.userId);
  assert.equal(employee.body.user.lineBound, true); assert.equal(line.body.user.lineBound, true);
  assert.equal(employee.body.authMode, 'employee_guest'); assert.equal(line.body.authMode, 'line');
  const conflicting = await call(db, '/api/auth/line-bind', { method: 'POST', token: 'other-token', headers: { 'X-Employee-Guest-Session': guest.body.token } },
    { fetchImpl: profileFetch({ token: 'other-token', lineUserId: 'other-line' }) });
  assert.equal(conflicting.status, 409);
  assert.equal(db.get('SELECT line_user_id FROM users WHERE user_id = ?', 'canonical').line_user_id, 'bound-line');
});

test('an existing employee session reads a later canonical binding without acquiring LINE privileges', async () => {
  const db = new SqliteD1(); seedUser(db, { userId: 'canonical', employeeId: '001234', displayName: 'Test', lineUserId: null });
  const guest = await call(db, '/api/auth/employee-guest', { method: 'POST', body: { employeeId: '001234' } });
  assert.equal(guest.body.user.lineBound, false);
  assert.equal((await call(db, '/api/auth/line-employee-bind', { method: 'POST', token: 'line-token', body: { employeeId: '001234' } })).status, 200);
  const after = await call(db, '/api/me', { token: guest.body.token });
  assert.equal(after.body.user.lineBound, true); assert.equal(after.body.user.lineUserId, null);
  assert.equal(after.body.authMode, 'employee_guest'); assert.equal(after.body.user.role, 'User');
  assert.deepEqual(after.body.capabilities, guest.body.capabilities);
});

test('View As bootstrap projects subject binding separately from authenticated actor mode/binding', async () => {
  const db = new SqliteD1();
  seedUser(db, { userId: 'admin', employeeId: '000001', displayName: 'Admin', lineUserId: 'bound-line', role: 'Admin' });
  seedUser(db, { userId: 'subject', employeeId: '001234', displayName: 'Subject', lineUserId: null });
  const result = await call(db, '/api/bootstrap?viewAsUserId=subject', { token: 'line-token' });
  assert.equal(result.status, 200); assert.equal(result.body.authMode, 'line'); assert.equal(result.body.lineBound, true);
  assert.equal(result.body.user.userId, 'subject'); assert.equal(result.body.user.lineBound, false);
});
