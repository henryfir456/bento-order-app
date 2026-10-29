import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteD1 } from './helpers/formal-db.js';
import { handleFormalRequest, profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { LOGIN_FAILURE_LIMIT, LOGIN_WINDOW_MS } from '../src/auth/loginThrottle.js';

const NOW = new Date('2026-10-20T00:00:00.000Z');

const login = async (database, employeeId, { ip = '203.0.113.9', now = NOW } = {}) => {
  const response = await handleFormalRequest(
    request('/api/auth/employee-guest', {
      method: 'POST',
      body: { employeeId },
      headers: { 'CF-Connecting-IP': ip }
    }),
    { DB: database },
    { fetchImpl: profileFetch({ token: 't', lineUserId: 'x', displayName: 'x' }), now }
  );
  return { status: response.status, body: await response.json() };
};

test('repeated unknown employee IDs from one address are throttled', async () => {
  const database = new SqliteD1();
  for (let i = 0; i < LOGIN_FAILURE_LIMIT; i += 1) {
    const result = await login(database, `E9${String(i).padStart(5, '0')}`);
    assert.equal(result.status, 200);
  }
  const blocked = await login(database, 'E900099');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, 'LOGIN_RATE_LIMITED');

  const otherAddress = await login(database, 'E900099', { ip: '203.0.113.10' });
  assert.equal(otherAddress.status, 200);

  const later = new Date(NOW.getTime() + LOGIN_WINDOW_MS + 1000);
  assert.equal((await login(database, 'E900099', { now: later })).status, 200);
});

test('successful logins of known employees are not counted', async () => {
  const database = new SqliteD1();
  seedUser(database, { userId: 'throttle-user', lineUserId: 'throttle-line', employeeId: 'E100001', role: 'User' });
  for (let i = 0; i < LOGIN_FAILURE_LIMIT + 3; i += 1) {
    const result = await login(database, 'E100001');
    assert.equal(result.status, 201);
  }
});
