import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { CORS_HEADERS, PRODUCTION_FRONTEND_ORIGIN } from '../src/http/response.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { request, seedUser } from './helpers/formal-fixtures.js';

const writesTracked = (database) => {
  const writes = [];
  const prepare = database.prepare.bind(database);
  database.prepare = (sql) => {
    if (/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) writes.push(sql);
    return prepare(sql);
  };
  return writes;
};

test('GET /api/health is public and preserves the existing liveness shape', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'health-user' });
  const writes = writesTracked(database);

  const response = await handleFormalRequest(
    request('/api/health', { token: '' }),
    { DB: database }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    database: true,
    users: 1
  });
  assert.deepEqual(writes, []);
});

test('OPTIONS /api/health keeps the formal CORS preflight contract', async () => {
  const response = await handleFormalRequest(
    request('/api/health', {
      method: 'OPTIONS',
      token: '',
      headers: {
        Origin: PRODUCTION_FRONTEND_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization'
      }
    }),
    {}
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_FRONTEND_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), CORS_HEADERS['Access-Control-Allow-Headers']);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), CORS_HEADERS['Access-Control-Allow-Methods']);
  assert.equal(response.headers.get('Vary'), 'Origin');
});

test('GET /api/me remains protected without authentication', async () => {
  const response = await handleFormalRequest(
    request('/api/me', { token: '' }),
    { DB: new SqliteD1() }
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'AUTH_REQUIRED' });
});

test('Admin menu preview remains protected without authentication', async () => {
  const response = await handleFormalRequest(
    request('/api/admin/menu/preview?vendor=蔡老師&targetDate=2026-09-16', { token: '' }),
    { DB: new SqliteD1() }
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'AUTH_REQUIRED' });
});
