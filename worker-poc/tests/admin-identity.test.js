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
  return {
    response,
    body: response.status === 204 ? null : await response.json()
  };
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

test('Admin binding preserves legacy verification fields and leaves role/balance unchanged', async () => {
  const database = seedBindingDatabase();
  database.run(`
    INSERT INTO employee_roster (roster_id, employee_id, active, provenance, source_ref)
    VALUES ('trusted-139653', '139653', 1, 'TRUSTED_IMPORT', 'roster.csv')
  `);
  const result = await adminBind(database, 'target-1', '139653');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(result.body.verificationDecision, 'NO_CHANGE');
  assert.equal(result.body.identityState, 'VERIFIED');
  assert.equal(result.body.user.authSource, 'LINE');
  assert.equal(result.body.user.identityState, 'VERIFIED');
  assert.equal(database.get("SELECT employee_id FROM users WHERE user_id = 'target-1'").employee_id, '139653');
  assert.equal(database.get("SELECT verification_status FROM users WHERE user_id = 'target-1'").verification_status, 'VERIFIED');
  assert.equal(database.get("SELECT role FROM users WHERE user_id = 'target-1'").role, 'User');
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'target-1'").balance, 25);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ADMIN_EMPLOYEE_BIND'").count, 1);
});

test('Admin binding without a roster match remains directly registered', async () => {
  const database = seedBindingDatabase();
  const result = await adminBind(database, 'target-1', '139653');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.identityState, 'VERIFIED');
  assert.equal(result.body.verificationStatus, 'VERIFIED');
  assert.equal(database.get("SELECT verification_status FROM users WHERE user_id = 'target-1'").verification_status, 'VERIFIED');
});

test('registered LINE Admin can bind with historical UNVERIFIED status, while unbound Admin cannot', async () => {
  const database = seedBindingDatabase();
  database.run(`
    UPDATE users SET verification_status = 'UNVERIFIED' WHERE user_id = 'admin-1'
  `);

  const registered = await adminBind(database, 'target-1', '139653');
  assert.equal(registered.response.status, 200);
  assert.equal(registered.body.user.employeeId, '139653');
  assert.equal(registered.body.user.verificationStatus, 'VERIFIED');

  const unboundDatabase = seedBindingDatabase();
  unboundDatabase.run(`
    UPDATE users SET employee_id = NULL WHERE user_id = 'admin-1'
  `);
  const unbound = await adminBind(unboundDatabase, 'target-1', '139653');
  assert.equal(unbound.response.status, 403);
  assert.equal(unbound.body.error, 'ADMIN_LINE_AUTH_REQUIRED');
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

test('registered LINE Admin with legacy UNVERIFIED status reaches every privileged capability', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'admin-1',
    lineUserId: 'admin-1',
    employeeId: '900001',
    role: 'Admin',
    verificationStatus: 'UNVERIFIED'
  });
  seedUser(database, {
    userId: 'target-1',
    lineUserId: 'target-line',
    employeeId: null,
    role: 'User'
  });
  const profile = {
    token: 'admin-token',
    lineUserId: 'admin-1',
    displayName: 'Admin'
  };
  const adminCall = (path, options = {}) => call(
    database,
    path,
    { token: profile.token, ...options },
    profile
  );

  const summary = await adminCall('/api/admin/summary?date=2026-09-11');
  assert.equal(summary.response.status, 200);

  const members = await adminCall('/api/admin/members/balances');
  assert.equal(members.response.status, 200);

  const topUp = await adminCall('/api/admin/balances/top-up', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'unverified-admin-top-up' },
    body: { targetUserId: 'target-1', amount: 10, note: 'legacy-status' }
  }, profile);
  assert.equal(topUp.response.status, 200);

  const calendar = await adminCall('/api/admin/calendar/2026-09-12', {
    method: 'PUT',
    body: { vendor: 'Vendor A', mode: 'A' }
  }, profile);
  assert.equal(calendar.response.status, 200);

  const role = await adminCall('/api/admin/users/target-1/role', {
    method: 'PUT',
    body: { role: 'ProxyAdmin' }
  });
  assert.equal(role.response.status, 200);
  assert.equal(role.body.user.role, 'ProxyAdmin');
  assert.equal(database.get("SELECT role FROM users WHERE user_id = 'admin-1'").role, 'Admin');
  assert.equal(database.get("SELECT verification_status FROM users WHERE user_id = 'admin-1'").verification_status, 'UNVERIFIED');

  const announcementList = await adminCall('/api/admin/announcements');
  assert.equal(announcementList.response.status, 200);

  const announcement = await adminCall('/api/admin/announcements', {
    method: 'POST',
    body: {
      title: 'Legacy status',
      content: 'Admin access remains role-based.',
      start_date: '2026-09-12',
      end_date: '2026-09-13'
    }
  });
  assert.equal(announcement.response.status, 201);
  const announcementId = announcement.body.id;

  const updatedAnnouncement = await adminCall(
    `/api/admin/announcements/${announcementId}`,
    { method: 'PATCH', body: { title: 'Updated legacy status' } }
  );
  assert.equal(updatedAnnouncement.response.status, 200);

  const deletedAnnouncement = await adminCall(
    `/api/admin/announcements/${announcementId}`,
    { method: 'DELETE' }
  );
  assert.equal(deletedAnnouncement.response.status, 204);

  const employeeBinding = await adminCall(
    '/api/admin/users/target-1/employee-binding',
    { method: 'POST', body: { employeeId: '139653' } }
  );
  assert.equal(employeeBinding.response.status, 200);
  assert.equal(employeeBinding.body.status, 'BOUND');

  const viewAs = await adminCall(
    '/api/admin/summary?date=2026-09-11&viewAs=target-1',
    {}
  );
  assert.equal(viewAs.response.status, 200);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE actor_user_id = 'admin-1'").count > 0, true);
});

test('guest, unbound LINE Admin, and inactive LINE Admin cannot cross privileged boundaries', async () => {
  const requests = [
    ['/api/admin/summary?date=2026-09-11', {}],
    ['/api/admin/members/balances', {}],
    ['/api/admin/balances/top-up', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'denied-top-up' },
      body: { targetUserId: 'target-1', amount: 10 }
    }],
    ['/api/admin/calendar/2026-09-12', {
      method: 'PUT',
      body: { vendor: 'Vendor A', mode: 'A' }
    }],
    ['/api/admin/users/target-1/role', {
      method: 'PUT',
      body: { role: 'ProxyAdmin' }
    }],
    ['/api/admin/announcements', {}],
    ['/api/admin/announcements', {
      method: 'POST',
      body: {
        title: 'Denied',
        content: 'Denied',
        start_date: '2026-09-12',
        end_date: '2026-09-13'
      }
    }],
    ['/api/admin/announcements/unknown', {
      method: 'PATCH',
      body: { title: 'Denied' }
    }],
    ['/api/admin/announcements/unknown', { method: 'DELETE' }],
    ['/api/admin/users/target-1/employee-binding', {
      method: 'POST',
      body: { employeeId: '139653' }
    }],
    ['/api/admin/summary?date=2026-09-11&viewAs=target-1', {}]
  ];

  const assertDenied = async (label, database, authOptions, profile) => {
    for (const [path, options] of requests) {
      const result = await call(
        database,
        path,
        { token: authOptions.token, ...options },
        profile
      );
      assert.equal(result.response.status, 403, `${label} ${options.method || 'GET'} ${path}`);
    }
    assert.equal(database.get("SELECT role FROM users WHERE user_id = 'admin-1'").role, 'Admin');
    assert.equal(database.get("SELECT employee_id FROM users WHERE user_id = 'target-1'").employee_id, null);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 0);
  };

  const unboundDatabase = new SqliteD1();
  seedUser(unboundDatabase, {
    userId: 'admin-1',
    lineUserId: 'admin-1',
    employeeId: null,
    role: 'Admin',
    verificationStatus: 'UNVERIFIED'
  });
  seedUser(unboundDatabase, {
    userId: 'target-1',
    lineUserId: 'target-line',
    employeeId: null
  });
  await assertDenied(
    'unbound LINE Admin',
    unboundDatabase,
    { token: 'admin-token' },
    { token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin' }
  );

  const inactiveDatabase = new SqliteD1();
  seedUser(inactiveDatabase, {
    userId: 'admin-1',
    lineUserId: 'admin-1',
    employeeId: '900001',
    role: 'Admin',
    active: 0,
    verificationStatus: 'UNVERIFIED'
  });
  seedUser(inactiveDatabase, {
    userId: 'target-1',
    lineUserId: 'target-line',
    employeeId: null
  });
  await assertDenied(
    'inactive LINE Admin',
    inactiveDatabase,
    { token: 'admin-token' },
    { token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin' }
  );

  const guestDatabase = new SqliteD1();
  seedUser(guestDatabase, {
    userId: 'admin-1',
    lineUserId: null,
    employeeId: '139653',
    displayName: 'Guest Admin',
    role: 'Admin',
    verificationStatus: 'UNVERIFIED'
  });
  seedUser(guestDatabase, {
    userId: 'target-1',
    lineUserId: 'target-line',
    employeeId: null
  });
  const guestLogin = await call(guestDatabase, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '139653' }
  });
  assert.equal(guestLogin.response.status, 200);
  await assertDenied(
    'employee_guest Admin',
    guestDatabase,
    { token: guestLogin.body.token },
    {}
  );

  const guestLineBind = await call(guestDatabase, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: guestLogin.body.token,
    body: { employeeId: '139653' }
  });
  assert.equal(guestLineBind.response.status, 401);
});
