import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

test('View As changes only the read subject and records actor/target attribution', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  seedUser(database, { lineUserId: 'user-1', balance: 0 });
  const response = await handleFormalRequest(
    request('/api/admin/summary?date=2026-09-08&viewAs=user-1', { token: 'admin-token' }),
    { DB: database },
    {
      fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-1' }),
      now: new Date('2026-09-08T00:00:00.000Z')
    }
  );
  assert.equal(response.status, 200);
  const audit = database.get(`
    SELECT actor_user_id, target_user_id, action
    FROM admin_audit_log
    WHERE action = 'VIEW_AS_ADMIN_SUMMARY'
  `);
  assert.equal(audit.actor_user_id, 'admin-1');
  assert.equal(audit.target_user_id, 'user-1');
  assert.equal(audit.action, 'VIEW_AS_ADMIN_SUMMARY');
});

test('User order-summary access does not grant View As', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', role: 'User' });
  seedUser(database, { lineUserId: 'user-2', role: 'User' });
  const response = await handleFormalRequest(
    request('/api/admin/summary?date=2026-09-08&viewAs=user-2', { token: 'user-token' }),
    { DB: database },
    {
      fetchImpl: profileFetch({ token: 'user-token', lineUserId: 'user-1' }),
      now: new Date('2026-09-08T00:00:00.000Z')
    }
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'VIEW_AS_FORBIDDEN' });
});
