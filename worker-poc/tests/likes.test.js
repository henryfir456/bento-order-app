import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const call = async (database, path, profile = {}) => {
  const response = await handleFormalRequest(
    request(path, { method: 'POST', token: profile.token || 'token-user' }),
    { DB: database },
    {
      fetchImpl: profileFetch(profile),
      now: new Date('2026-09-08T00:00:00.000Z')
    }
  );
  return { response, body: await response.json() };
};

const databaseWithUsers = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1' });
  seedUser(database, { lineUserId: 'user-2' });
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  return database;
};

test('like toggle is actor-bound and opens/closes only the like-created vendor', async () => {
  const database = databaseWithUsers();
  const first = await call(
    database,
    '/api/calendar/2026-09-10/like',
    { token: 'user-token', lineUserId: 'user-1', displayName: 'User' }
  );
  assert.equal(first.response.status, 200);
  assert.equal(first.body.isLiked, true);
  assert.equal(first.body.totalLikes, 1);
  assert.equal(database.get("SELECT vendor, vendor_source FROM calendar_settings WHERE order_date = '2026-09-10'").vendor, '蔡老師');
  assert.equal(database.get("SELECT vendor_source FROM calendar_settings WHERE order_date = '2026-09-10'").vendor_source, 'LIKE_DEFAULT');

  const second = await call(
    database,
    '/api/calendar/2026-09-10/like',
    { token: 'user-token', lineUserId: 'user-1', displayName: 'User' }
  );
  assert.equal(second.body.isLiked, false);
  assert.equal(second.body.totalLikes, 0);
  assert.equal(database.get("SELECT vendor FROM calendar_settings WHERE order_date = '2026-09-10'").vendor, '');

  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-09-11', 'Vendor A', 'B')
  `);
  await call(database, '/api/calendar/2026-09-11/like', {
    token: 'user-token', lineUserId: 'user-1', displayName: 'User'
  });
  await call(database, '/api/calendar/2026-09-11/like', {
    token: 'user-token', lineUserId: 'user-1', displayName: 'User'
  });
  assert.equal(database.get("SELECT vendor FROM calendar_settings WHERE order_date = '2026-09-11'").vendor, 'Vendor A');
});

test('View As cannot redirect the like mutation', async () => {
  const database = databaseWithUsers();
  const result = await call(
    database,
    '/api/calendar/2026-09-10/like?viewAs=user-2',
    { token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin' }
  );
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, 'VIEW_AS_FORBIDDEN');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM likes').count, 0);
});
