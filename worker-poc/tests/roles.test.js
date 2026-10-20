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
  seedUser(database, {
    userId: 'vendor-role-target',
    employeeId: 'SYNTHETIC-VENDOR-ROLE-TARGET',
    lineUserId: 'vendor-role-target-line',
    displayName: '合成 Vendor 角色目標',
    role: 'User'
  });
  database.run('INSERT INTO vendor_principals (user_id) VALUES (?)', 'vendor-role-target');
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

  const vendorRole = await call(
    database,
    '/api/admin/users/user-1/role',
    { method: 'PUT', token: 'admin-token', body: { role: 'Vendor' } },
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  assert.equal(vendorRole.response.status, 400);
  assert.equal(vendorRole.body.error, 'ROLE_INVALID');

  const vendorPrincipal = await call(
    database,
    '/api/admin/users/vendor-role-target/role',
    { method: 'PUT', token: 'admin-token', body: { role: 'Admin' } },
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  assert.equal(vendorPrincipal.response.status, 409);
  assert.equal(vendorPrincipal.body.error, 'ROLE_TARGET_VENDOR_PRINCIPAL');
  assert.equal(database.get(
    'SELECT role FROM users WHERE user_id = ?', 'vendor-role-target'
  ).role, 'User');

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

test('role assignment cannot race a Vendor principal becoming active', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'admin-vendor-race', role: 'Admin' });
  seedUser(database, {
    userId: 'vendor-role-race-target',
    employeeId: 'SYNTHETIC-VENDOR-ROLE-RACE',
    lineUserId: 'vendor-role-race-line',
    role: 'User'
  });
  const originalBatch = database.batch.bind(database);
  let principalInserted = false;
  database.batch = (statements) => {
    if (!principalInserted) {
      database.run(`
        INSERT INTO vendor_principals (user_id, principal_role, status)
        VALUES ('vendor-role-race-target', 'Vendor', 'ACTIVE')
      `);
      principalInserted = true;
    }
    return originalBatch(statements);
  };

  const result = await call(
    database,
    '/api/admin/users/vendor-role-race-target/role',
    { method: 'PUT', token: 'admin-vendor-race-token', body: { role: 'Admin' } },
    { token: 'admin-vendor-race-token', lineUserId: 'admin-vendor-race' }
  );

  assert.equal(principalInserted, true);
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'ROLE_UPDATE_STALE');
  assert.equal(database.get(
    'SELECT role FROM users WHERE user_id = ?', 'vendor-role-race-target'
  ).role, 'User');
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ROLE_UPDATED'"
  ).count, 0);
});
