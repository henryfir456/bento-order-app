import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const call = async (database, path, options, profile) => {
  const response = await handleFormalRequest(
    request(path, options),
    { DB: database },
    { fetchImpl: profileFetch(profile), now: new Date('2026-09-08T00:00:00.000Z') }
  );
  return { response, body: await response.json() };
};

test('role assignment is Admin-only, validates formal roles, and is audited', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  seedUser(database, { lineUserId: 'user-1', role: 'User' });
  const changed = await call(
    database,
    '/api/admin/users/user-1/role',
    { method: 'PUT', token: 'admin-token', body: { role: 'ProxyAdmin' } },
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  assert.equal(changed.response.status, 200);
  assert.equal(changed.body.user.role, 'ProxyAdmin');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ROLE_UPDATED'").count, 1);

  const invalid = await call(
    database,
    '/api/admin/users/user-1/role',
    { method: 'PUT', token: 'admin-token', body: { role: 'Owner' } },
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'ROLE_INVALID');

  const nonAdmin = await call(
    database,
    '/api/admin/users/user-1/role',
    { method: 'PUT', token: 'user-token', body: { role: 'Admin' } },
    { token: 'user-token', lineUserId: 'user-1' }
  );
  assert.equal(nonAdmin.response.status, 403);
});
