import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { auditStatement } from '../src/db/audit.js';
import { prepareStatement, runMutationBatch } from '../src/db/transactions.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const now = new Date('2026-09-11T00:00:00.000Z');

const call = async (database, path, options = {}, profile = {}) => {
  const response = await handleFormalRequest(
    request(path, options),
    { DB: database },
    { fetchImpl: profileFetch(profile), now }
  );
  return { response, body: await response.json() };
};

const seedBindingDatabase = () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'admin-1',
    lineUserId: 'admin-1',
    employeeId: '900001',
    displayName: 'Admin',
    role: 'Admin',
    balance: 700
  });
  seedUser(database, {
    userId: 'target-1',
    lineUserId: 'target-line',
    employeeId: null,
    displayName: 'Target',
    role: 'User',
    balance: 25
  });
  seedUser(database, {
    userId: 'owner-1',
    lineUserId: 'owner-line',
    employeeId: '139654',
    displayName: 'Owner',
    balance: 90
  });
  return database;
};

const adminBind = (database, targetUserId, employeeId, profile = {}) => call(
  database,
  `/api/admin/users/${encodeURIComponent(targetUserId)}/employee-binding`,
  {
    method: 'POST',
    token: 'admin-token',
    body: { employeeId }
  },
  { token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin', ...profile }
);

test('Admin binding succeeds, auto-verifies trusted match, and leaves role/balance unchanged', async () => {
  const database = seedBindingDatabase();
  database.run(`
    INSERT INTO employee_roster (roster_id, employee_id, active, provenance, source_ref)
    VALUES ('trusted-139653', '139653', 1, 'TRUSTED_IMPORT', 'roster.csv')
  `);
  const result = await adminBind(database, 'target-1', '139653');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(result.body.verificationDecision, 'AUTO_VERIFIED');
  assert.equal(result.body.identityState, 'VERIFIED');
  assert.equal(result.body.user.authSource, 'LINE');
  assert.equal(result.body.user.identityState, 'VERIFIED');
  assert.equal(database.get("SELECT employee_id FROM users WHERE user_id = 'target-1'").employee_id, '139653');
  assert.equal(database.get("SELECT verification_status FROM users WHERE user_id = 'target-1'").verification_status, 'VERIFIED');
  assert.equal(database.get("SELECT role FROM users WHERE user_id = 'target-1'").role, 'User');
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'target-1'").balance, 25);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ADMIN_EMPLOYEE_BIND'").count, 1);
});

test('Admin binding without a trusted unique match remains pending', async () => {
  const database = seedBindingDatabase();
  const result = await adminBind(database, 'target-1', '139653');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.identityState, 'PENDING_VERIFICATION');
  assert.equal(result.body.verificationStatus, 'UNVERIFIED');
  assert.equal(database.get("SELECT verification_status FROM users WHERE user_id = 'target-1'").verification_status, 'UNVERIFIED');
});

test('non-Admin, guest, conflicting, and different-existing bindings fail closed', async () => {
  const database = seedBindingDatabase();
  const user = await call(database, '/api/admin/users/target-1/employee-binding', {
    method: 'POST',
    token: 'user-token',
    body: { employeeId: '139653' }
  }, { token: 'user-token', lineUserId: 'target-line' });
  assert.equal(user.response.status, 403);
  assert.equal(database.get("SELECT employee_id FROM users WHERE user_id = 'target-1'").employee_id, null);

  const conflict = await adminBind(database, 'target-1', '139654');
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error, 'EMPLOYEE_ID_ALREADY_BOUND');

  const first = await adminBind(database, 'target-1', '139653');
  assert.equal(first.response.status, 200);
  const different = await adminBind(database, 'target-1', '139655');
  assert.equal(different.response.status, 409);
  assert.equal(different.body.error, 'USER_EMPLOYEE_ALREADY_BOUND');
});

test('employee ownership is case-insensitive for imported textual IDs', async () => {
  const database = seedBindingDatabase();
  seedUser(database, {
    userId: 'case-owner',
    lineUserId: 'case-owner-line',
    employeeId: 'e0003',
    displayName: 'Case Owner'
  });
  const conflict = await adminBind(database, 'target-1', 'E0003');
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error, 'EMPLOYEE_ID_ALREADY_BOUND');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM users WHERE UPPER(trim(employee_id)) = 'E0003'").count, 1);
});

test('same user and employee ID is idempotent and separately auditable', async () => {
  const database = seedBindingDatabase();
  const first = await adminBind(database, 'target-1', '139653');
  const retry = await adminBind(database, 'target-1', '139653');
  assert.equal(first.body.status, 'BOUND');
  assert.equal(retry.body.status, 'ALREADY_BOUND');
  assert.equal(retry.body.verificationDecision, 'NO_CHANGE');
  assert.equal(retry.body.user.employeeId, '139653');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM users WHERE employee_id = '139653'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ADMIN_EMPLOYEE_BIND'").count, 2);
});

test('a rejected concurrent update cannot create a false BOUND audit event', async () => {
  const database = seedBindingDatabase();
  const auditInput = {
    actorUserId: 'admin-1',
    actorAuthMode: 'line',
    actorEmployeeIdSnapshot: '900001',
    actorLineUserIdSnapshot: 'admin-1',
    targetUserId: 'target-1',
    action: 'ADMIN_EMPLOYEE_BIND',
    metadata: { result: 'BOUND' },
    occurredAt: now.toISOString(),
    onlyIfPriorMutation: true
  };
  const update = () => prepareStatement(database, `
    UPDATE users
    SET employee_id = ?
    WHERE user_id = ? AND employee_id IS NULL
  `, ['139653', 'target-1']);
  const conditionalAudit = () => auditStatement(database, {
    ...auditInput,
    auditId: 'conditional-' + Math.random().toString(36).slice(2)
  });

  await runMutationBatch(database, [update(), conditionalAudit()]);
  await runMutationBatch(database, [update(), conditionalAudit()]);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ADMIN_EMPLOYEE_BIND'").count, 1);
});

test('member projection is server-authoritative for source and identity state', async () => {
  const database = seedBindingDatabase();
  seedUser(database, {
    userId: 'guest-1',
    lineUserId: null,
    employeeId: '139656',
    displayName: 'Guest',
    verificationStatus: 'UNVERIFIED'
  });
  const result = await call(database, '/api/admin/members/balances', { token: 'admin-token' }, {
    token: 'admin-token',
    lineUserId: 'admin-1'
  });
  assert.equal(result.response.status, 200);
  const target = result.body.members.find((user) => user.userId === 'target-1');
  const guest = result.body.members.find((user) => user.userId === 'guest-1');
  assert.equal(target.authSource, 'LINE');
  assert.equal(target.identityState, 'EMPLOYEE_BIND_REQUIRED');
  assert.equal(guest.authSource, 'EMPLOYEE_GUEST');
  assert.equal(guest.identityState, 'PENDING_VERIFICATION');
  assert.equal(guest.verificationStatus, 'UNVERIFIED');
});
