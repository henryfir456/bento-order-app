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
  assert.match(header, /^d1-probe;dur=\d+\.\d, line;desc="1";dur=\d+\.\d, total;dur=\d+\.\d, d1-rows;desc="\d+ rows\/\d+ queries"$/);
  assert.doesNotMatch(header, /user-1|token|Synthetic/);
  assert.equal(response.headers.get('Timing-Allow-Origin'), 'https://stirring-pony-3571ac.netlify.app');
});

test('health and unauthenticated errors still carry a total duration', async () => {
  const database = seededDatabase();
  const health = await handleFormalRequest(new Request('https://formal.test/api/health'), { DB: database });
  assert.match(health.headers.get('Server-Timing'), /^total;dur=\d+\.\d(, d1-rows;desc="\d+ rows\/\d+ queries")?$/);
  const denied = await handleFormalRequest(
    new Request('https://formal.test/api/me'),
    { DB: database },
    { fetchImpl: profileFetch(), now: NOW }
  );
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('Server-Timing'), /^d1-probe;dur=\d+\.\d, total;dur=\d+\.\d, d1-rows;desc="\d+ rows\/\d+ queries"$/);
});

class SlowProbeD1 extends RecordingD1 {
  events = [];
  failProbe = false;

  prepare(sql) {
    const statement = super.prepare(sql);
    if (!sql.includes('SELECT 1 AS ready')) return statement;
    return {
      first: async () => {
        this.events.push('probe:start');
        await new Promise((resolve) => setTimeout(resolve, 30));
        this.events.push('probe:end');
        if (this.failProbe) throw new Error('D1 down');
        return statement.first();
      }
    };
  }
}

const recordingProfileFetch = (database, options) => {
  const inner = profileFetch(options);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    database.events.push('line:start');
    await new Promise((resolve) => setTimeout(resolve, 30));
    return inner(url, init);
  };
  return { fetchImpl, calls };
};

test('LINE verification starts while the D1 probe is still running', async () => {
  const database = new SlowProbeD1();
  seedUser(database, { lineUserId: 'user-1', displayName: 'Synthetic Buyer' });
  const { fetchImpl, calls } = recordingProfileFetch(database, { token: 'token-user', lineUserId: 'user-1' });
  const response = await handleFormalRequest(
    request('/api/me', { token: 'token-user' }),
    { DB: database },
    { fetchImpl, now: NOW }
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1, 'the prefetched profile is reused, not fetched twice');
  assert.ok(
    database.events.indexOf('line:start') < database.events.indexOf('probe:end'),
    `events: ${database.events.join(', ')}`
  );
});

test('a failed D1 probe still answers 503 even after LINE verification started', async () => {
  const database = new SlowProbeD1();
  database.failProbe = true;
  const { fetchImpl } = recordingProfileFetch(database, { token: 'token-user', lineUserId: 'user-1' });
  const response = await handleFormalRequest(
    request('/api/me', { token: 'token-user' }),
    { DB: database },
    { fetchImpl, now: NOW }
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'DATABASE_UNAVAILABLE');
});

test('a rejected LINE token is still unauthorized when prefetched', async () => {
  const database = new SlowProbeD1();
  seedUser(database, { lineUserId: 'user-1', displayName: 'Synthetic Buyer' });
  const { fetchImpl } = recordingProfileFetch(database, { token: 'other-token', lineUserId: 'user-1' });
  const response = await handleFormalRequest(
    request('/api/me', { token: 'token-user' }),
    { DB: database },
    { fetchImpl, now: NOW }
  );
  assert.equal(response.status, 401);
});

test('employee guest tokens never call LINE', async () => {
  const database = new SlowProbeD1();
  const { fetchImpl, calls } = recordingProfileFetch(database, {});
  const response = await handleFormalRequest(
    request('/api/me', { token: 'eg_unknown-session' }),
    { DB: database },
    { fetchImpl, now: NOW }
  );
  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});
