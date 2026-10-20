import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from './helpers/formal-fixtures.js';
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

test('role assignment cannot race an invalid employee repair', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'admin-race-synthetic', role: 'Admin' });
  seedUser(database, {
    userId: 'user-race-synthetic',
    employeeId: 'SYNTHETIC-EMPLOYEE-RACE',
    displayName: '合成競態使用者',
    role: 'User'
  });
  const originalBatch = database.batch.bind(database);
  database.batch = async (statements) => {
    database.run(
      "UPDATE users SET active = 0, invalid_reason = 'INVALID_EMPLOYEE_ID', updated_at = ? WHERE user_id = ?",
      '2026-10-17T04:00:00.000Z',
      'user-race-synthetic'
    );
    return originalBatch(statements);
  };

  const result = await call(
    database,
    '/api/admin/users/user-race-synthetic/role',
    { method: 'PUT', token: 'admin-race-token', body: { role: 'Admin' } },
    { token: 'admin-race-token', lineUserId: 'admin-race-synthetic' }
  );
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, 'INVALID_EMPLOYEE_ID');
  assert.equal(database.get('SELECT role FROM users WHERE user_id = ?', 'user-race-synthetic').role, 'User');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ROLE_UPDATED'").count, 0);
});
