import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteD1 } from './helpers/formal-db.js';
import { handleFormalRequest, profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const NOW = new Date('2026-10-22T02:00:00.000Z');

class RecordingD1 extends SqliteD1 {
  statements = [];

  prepare(sql) {
    this.statements.push(sql);
    return super.prepare(sql);
  }
}

const seededDatabase = () => {
  const database = new RecordingD1();
  seedUser(database, { lineUserId: 'user-1', displayName: 'Synthetic Buyer' });
  database.statements = [];
  return database;
};

test('LINE token requests skip the employee guest session read', async () => {
  const database = seededDatabase();
  const response = await handleFormalRequest(
    request('/api/me', { token: 'token-user' }),
    { DB: database },
    { fetchImpl: profileFetch({ token: 'token-user', lineUserId: 'user-1' }), now: NOW }
  );
  assert.equal(response.status, 200);
  assert.ok(
    database.statements.every((sql) => !sql.includes('employee_guest_sessions')),
    'a LINE access token can never match an employee guest session'
  );
});

test('employee guest tokens still read their session', async () => {
  const database = seededDatabase();
  const response = await handleFormalRequest(
    request('/api/me', { token: 'eg_unknown-session' }),
    { DB: database },
    { fetchImpl: profileFetch(), now: NOW }
  );
  assert.equal(response.status, 401);
  assert.ok(database.statements.some((sql) => sql.includes('employee_guest_sessions')));
});

test('responses report durations only through Server-Timing', async () => {
  const database = seededDatabase();
  const response = await handleFormalRequest(
    request('/api/me', {
      token: 'token-user',
      headers: { Origin: 'https://stirring-pony-3571ac.netlify.app' }
    }),
    { DB: database },
    { fetchImpl: profileFetch({ token: 'token-user', lineUserId: 'user-1' }), now: NOW }
  );
  assert.equal(response.status, 200);
  const header = response.headers.get('Server-Timing');
  assert.match(header, /^d1-probe;dur=\d+\.\d, line;desc="1";dur=\d+\.\d, total;dur=\d+\.\d$/);
  assert.doesNotMatch(header, /user-1|token|Synthetic/);
  assert.equal(response.headers.get('Timing-Allow-Origin'), 'https://stirring-pony-3571ac.netlify.app');
});

test('health and unauthenticated errors still carry a total duration', async () => {
  const database = seededDatabase();
  const health = await handleFormalRequest(new Request('https://formal.test/api/health'), { DB: database });
  assert.match(health.headers.get('Server-Timing'), /^total;dur=\d+\.\d$/);
  const denied = await handleFormalRequest(
    new Request('https://formal.test/api/me'),
    { DB: database },
    { fetchImpl: profileFetch(), now: NOW }
  );
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('Server-Timing'), /^d1-probe;dur=\d+\.\d, total;dur=\d+\.\d$/);
});
