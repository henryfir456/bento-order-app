import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACTIONS } from '../src/auth/permissions.js';
import { hashGuestToken } from '../src/auth/guestSession.js';
import { employeeGuestLogin } from '../src/domain/guestAccess.js';
import { claimProvisionalEmployee } from '../src/domain/employeeClaim.js';
import { getEligibleOrderTargets } from '../src/domain/orderAuthorization.js';
import { getInvalidEmployeeRepairPreview } from '../src/domain/invalidEmployeeRepair.js';
import { getLineBindingTransferPreview } from '../src/domain/lineBindingTransfer.js';
import { topUpBalance } from '../src/routes/balance.js';
import { SqliteD1 } from './helpers/formal-db.js';
import {
  handleFormalRequest,
  profileFetch,
  request,
  seedUser,
  seedVendor
} from './helpers/formal-fixtures.js';

const call = async (database, path, {
  token,
  lineUserId,
  body,
  method = 'GET',
  headers = {}
}) => {
  const response = await handleFormalRequest(
    request(path, { method, token, body, headers }),
    { DB: database },
    {
      fetchImpl: profileFetch({ token, lineUserId, displayName: 'Synthetic Vendor Actor' }),
      now: new Date('2026-10-20T00:00:00.000Z')
    }
  );
  return { response, body: await response.json() };
};

const addVendorPrincipal = (database, {
  userId,
  status = 'ACTIVE'
}) => {
  database.run(`
    INSERT INTO vendor_principals (user_id, principal_role, status)
    VALUES (?, 'Vendor', ?)
  `, userId, status);
};

const addVendorMembership = (database, {
  userId,
  vendorId,
  status = 'ACTIVE'
}) => {
  database.run(`
    INSERT INTO vendor_memberships (user_id, vendor_id, status)
    VALUES (?, ?, ?)
  `, userId, vendorId, status);
};

test('Vendor identity and scope come only from canonical principal and memberships', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor-a', name: '合成店家 A' });
  seedVendor(database, { vendorId: 'synthetic-vendor-b', name: '合成店家 B' });
  seedUser(database, {
    userId: 'synthetic-vendor-user-a',
    lineUserId: 'synthetic-line-vendor-a',
    employeeId: 'SYNTHETIC-VENDOR-EMPLOYEE-A',
    balance: 7654,
    role: 'User'
  });
  seedUser(database, {
    userId: 'synthetic-vendor-user-b',
    lineUserId: 'synthetic-line-vendor-b',
    employeeId: 'SYNTHETIC-VENDOR-EMPLOYEE-B',
    balance: 4321,
    role: 'User'
  });
  addVendorPrincipal(database, { userId: 'synthetic-vendor-user-a' });
  addVendorPrincipal(database, { userId: 'synthetic-vendor-user-b' });
  addVendorMembership(database, { userId: 'synthetic-vendor-user-a', vendorId: 'synthetic-vendor-a' });
  addVendorMembership(database, { userId: 'synthetic-vendor-user-a', vendorId: 'synthetic-vendor-b' });
  addVendorMembership(database, { userId: 'synthetic-vendor-user-b', vendorId: 'synthetic-vendor-a' });

  const first = await call(database, '/api/vendor/context', {
    token: 'synthetic-vendor-token-a',
    lineUserId: 'synthetic-line-vendor-a',
    headers: {
      'x-user-role': 'Admin',
      'x-vendor-id': 'synthetic-vendor-forged'
    }
  });
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.body, {
    success: true,
    role: 'Vendor',
    vendorIds: ['synthetic-vendor-a', 'synthetic-vendor-b']
  });
  assert.equal(database.get(
    'SELECT role FROM users WHERE user_id = ?', 'synthetic-vendor-user-a'
  ).role, 'User');

  const me = await call(database, '/api/me', {
    token: 'synthetic-vendor-token-a',
    lineUserId: 'synthetic-line-vendor-a'
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.role, 'Vendor');
  assert.equal(me.body.user.balance, null);
  assert.equal(me.body.user.employeeId, null);
  assert.equal(me.body.identityState, 'VERIFIED');
  assert.equal(me.body.capabilities.includes(ACTIONS.READ_VENDOR_CONTEXT), true);

  const vendorBootstrap = await call(database, '/api/bootstrap?targetDate=2026-10-20', {
    token: 'synthetic-vendor-token-a',
    lineUserId: 'synthetic-line-vendor-a'
  });
  assert.equal(vendorBootstrap.response.status, 200);
  assert.equal(vendorBootstrap.body.user.role, 'Vendor');
  assert.equal(vendorBootstrap.body.user.employeeId, null);
  assert.equal(vendorBootstrap.body.user.balance, null);
  assert.deepEqual(vendorBootstrap.body.calendar.events, {});
  assert.deepEqual(vendorBootstrap.body.ordersMap, {});

  const vendorBootId = ['BOOT-', '2026', '1020', '-vendor'].join('');
  const vendorDeferred = await call(database, `/api/bootstrap/deferred?bootId=${vendorBootId}`, {
    token: 'synthetic-vendor-token-a',
    lineUserId: 'synthetic-line-vendor-a'
  });
  assert.equal(vendorDeferred.response.status, 200);
  assert.deepEqual(vendorDeferred.body.likes, {});
  assert.deepEqual(vendorDeferred.body.announcements, []);
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode, created_at, updated_at)
    VALUES ('2026-10-21', '合成廠商', 'A', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')
  `);
  const vendorCalendar = await call(database, '/api/calendar', {
    token: 'synthetic-vendor-token-a',
    lineUserId: 'synthetic-line-vendor-a'
  });
  assert.equal(vendorCalendar.response.status, 200, JSON.stringify(vendorCalendar.body));
  const calendarDay = vendorCalendar.body.events['2026-10-21'];
  assert.equal(calendarDay.vendor, '合成廠商');
  assert.deepEqual(Object.keys(calendarDay).sort(),
    ['deadline', 'isExpired', 'mode', 'order_date', 'vendor']);
  const vendorHistory = await call(database, '/api/orders/history', {
    token: 'synthetic-vendor-token-a',
    lineUserId: 'synthetic-line-vendor-a'
  });
  assert.equal(vendorHistory.response.status, 403);
  assert.equal(vendorHistory.body.error, 'VENDOR_ROUTE_FORBIDDEN');

  const second = await call(database, '/api/vendor/context', {
    token: 'synthetic-vendor-token-b',
    lineUserId: 'synthetic-line-vendor-b'
  });
  assert.equal(second.response.status, 200);
  assert.deepEqual(second.body.vendorIds, ['synthetic-vendor-a']);

  const targets = await getEligibleOrderTargets(database, {
    actor: {
      userId: 'synthetic-admin-order-actor',
      employeeId: 'SYNTHETIC-ADMIN-ORDER-ACTOR',
      role: 'Admin',
      active: true,
      authMode: 'line'
    }
  });
  assert.equal(targets.some((target) => target.userId.startsWith('synthetic-vendor-user-')), false);

  for (const attempt of [
    { path: '/api/vendor/context?vendorId=synthetic-vendor-forged' },
    { path: '/api/vendor/context?userId=synthetic-vendor-user-b' },
    { path: '/api/vendor/context?viewAs=synthetic-vendor-user-b' },
    { path: '/api/orders/history' },
    { path: '/api/me/balance/history' },
    { path: '/api/me/announcements' },
    { path: '/api/orders/targets' },
    { path: '/api/orders', method: 'POST', body: { idempotencyKey: 'synthetic-key' } },
    {
      path: '/api/admin/users/synthetic-vendor-user-b/role',
      method: 'PUT',
      body: { role: 'Admin' }
    }
  ]) {
    const denied = await call(database, attempt.path, {
      token: 'synthetic-vendor-token-a',
      lineUserId: 'synthetic-line-vendor-a',
      method: attempt.method || 'GET',
      body: attempt.body
    });
    assert.equal(denied.response.status, 403, attempt.path);
  }
});

test('ordinary User, ProxyAdmin, and Admin cannot use the Vendor context route', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor-a', name: '合成店家 A' });
  for (const role of ['User', 'ProxyAdmin', 'Admin']) {
    const lineUserId = 'synthetic-line-' + role.toLowerCase();
    seedUser(database, {
      userId: 'synthetic-user-' + role.toLowerCase(),
      lineUserId,
      role
    });
    const result = await call(database, '/api/vendor/context', {
      token: 'synthetic-token-' + role.toLowerCase(),
      lineUserId
    });
    assert.equal(result.response.status, 403, role);
  }
});

test('employee balance ledger and top-up remain separate from Vendor accounts', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor-balance', name: '合成廠商' });
  seedUser(database, {
    userId: 'synthetic-vendor-balance-user',
    employeeId: 'SYNTHETIC-VENDOR-BALANCE',
    lineUserId: 'synthetic-line-vendor-balance',
    displayName: '合成 Vendor 餘額測試',
    balance: 1250,
    role: 'User'
  });
  addVendorPrincipal(database, { userId: 'synthetic-vendor-balance-user' });
  addVendorMembership(database, {
    userId: 'synthetic-vendor-balance-user',
    vendorId: 'synthetic-vendor-balance'
  });
  const adminIdentity = {
    actor: {
      userId: 'synthetic-admin-balance-actor',
      employeeId: 'SYNTHETIC-ADMIN-BALANCE',
      role: 'Admin',
      active: true,
      authMode: 'line'
    }
  };

  await assert.rejects(topUpBalance(database, adminIdentity, {
    targetUserId: 'synthetic-vendor-balance-user',
    amount: 100,
    topupMethod: 'CASH',
    idempotencyKey: 'synthetic-vendor-topup'
  }, new Date('2026-10-20T00:00:00.000Z')), {
    code: 'VENDOR_BALANCE_FORBIDDEN'
  });
  assert.equal(database.get(
    'SELECT balance FROM users WHERE user_id = ?', 'synthetic-vendor-balance-user'
  ).balance, 1250);
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM balance_ledger WHERE user_id = ?',
    'synthetic-vendor-balance-user'
  ).count, 0);
});

test('a Vendor principal inserted after top-up preflight blocks the employee ledger mutation', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'synthetic-topup-race-target',
    employeeId: 'SYNTHETIC-TOPUP-RACE',
    lineUserId: 'synthetic-line-topup-race',
    displayName: 'Synthetic top-up race target',
    balance: 100,
    role: 'User'
  });
  const racingDatabase = {
    prepare: (...args) => database.prepare(...args),
    batch(statements) {
      addVendorPrincipal(database, { userId: 'synthetic-topup-race-target' });
      return database.batch(statements);
    }
  };
  const adminIdentity = {
    actor: {
      userId: 'synthetic-topup-race-admin',
      employeeId: 'SYNTHETIC-TOPUP-RACE-ADMIN',
      lineUserId: 'synthetic-topup-race-admin-line',
      displayName: 'Synthetic top-up race admin',
      role: 'Admin',
      active: true,
      authMode: 'line'
    }
  };

  await assert.rejects(topUpBalance(racingDatabase, adminIdentity, {
    targetUserId: 'synthetic-topup-race-target',
    amount: 250,
    topupMethod: 'CASH',
    idempotencyKey: 'synthetic-topup-vendor-race'
  }, new Date('2026-10-20T00:00:00.000Z')), {
    code: 'VENDOR_BALANCE_FORBIDDEN'
  });
  assert.equal(database.get(
    'SELECT balance FROM users WHERE user_id = ?', 'synthetic-topup-race-target'
  ).balance, 100);
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM balance_ledger WHERE user_id = ?',
    'synthetic-topup-race-target'
  ).count, 0);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'BALANCE_TOP_UP'"
  ).count, 0);
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM idempotency_keys WHERE idempotency_key = ?',
    'synthetic-topup-vendor-race'
  ).count, 0);
});

test('suspended vendor principals and disabled vendor memberships fail closed', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor-active', name: '合成店家啟用' });
  seedVendor(database, { vendorId: 'synthetic-vendor-disabled', name: '合成店家停用', enabled: 0 });
  const cases = [
    { suffix: 'principal', principalStatus: 'SUSPENDED', membershipStatus: 'ACTIVE', vendorId: 'synthetic-vendor-active' },
    { suffix: 'membership', principalStatus: 'ACTIVE', membershipStatus: 'SUSPENDED', vendorId: 'synthetic-vendor-active' },
    { suffix: 'vendor', principalStatus: 'ACTIVE', membershipStatus: 'ACTIVE', vendorId: 'synthetic-vendor-disabled' }
  ];
  for (const item of cases) {
    const userId = 'synthetic-vendor-' + item.suffix;
    const lineUserId = 'synthetic-line-' + item.suffix;
    const token = 'synthetic-token-' + item.suffix;
    seedUser(database, { userId, lineUserId, employeeId: null, role: 'User' });
    addVendorPrincipal(database, { userId, status: item.principalStatus });
    addVendorMembership(database, {
      userId,
      vendorId: item.vendorId,
      status: item.membershipStatus
    });
    const result = await call(database, '/api/vendor/context', { token, lineUserId });
    assert.equal(result.response.status, 403, item.suffix);
    const me = await call(database, '/api/me', { token, lineUserId });
    assert.equal(me.response.status, 403, item.suffix + ' /api/me');
  }
});

test('Vendor principals cannot use or resume employee guest sessions', async () => {
  const database = new SqliteD1();
  const employeeId = 'SYNTHETIC-VENDOR-EMPLOYEE';
  const userId = 'synthetic-vendor-employee-user';
  const lineUserId = 'synthetic-line-vendor-employee';
  const guestToken = 'eg_synthetic_legacy_vendor_session';
  seedVendor(database, { vendorId: 'synthetic-vendor-employee', name: '合成廠商' });
  seedUser(database, { userId, employeeId, lineUserId, role: 'User' });
  addVendorPrincipal(database, { userId });
  addVendorMembership(database, { userId, vendorId: 'synthetic-vendor-employee' });

  await assert.rejects(
    employeeGuestLogin(database, employeeId, new Date('2026-10-20T00:00:00.000Z')),
    { code: 'ADMIN_LINE_AUTH_REQUIRED' }
  );
  const { createGuestSession } = await import('../src/auth/guestSession.js');
  await assert.rejects(createGuestSession(database, { userId, employeeId }), {
    code: 'VENDOR_EMPLOYEE_GUEST_FORBIDDEN'
  });
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM employee_guest_sessions WHERE user_id = ?', userId
  ).count, 0);

  database.run(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, employee_id, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, 'VERIFIED', ?, ?)
  `, 'synthetic-vendor-old-session', await hashGuestToken(guestToken), userId,
  employeeId, '2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z');
  const resumed = await call(database, '/api/me', { token: guestToken, lineUserId });
  assert.equal(resumed.response.status, 401);
  assert.equal(resumed.body.error, 'GUEST_SESSION_INVALID');
});

test('a Vendor employee identity cannot be claimed into a general LINE principal', async () => {
  const database = new SqliteD1();
  const employeeId = 'SYNTHETIC-VENDOR-CLAIM';
  const ownerUserId = 'synthetic-vendor-claim-owner';
  seedVendor(database, { vendorId: 'synthetic-vendor-claim', name: '合成廠商' });
  seedUser(database, {
    userId: 'synthetic-line-claim-survivor',
    lineUserId: 'synthetic-line-claim-survivor',
    employeeId: null,
    displayName: 'Synthetic LINE Claim Survivor',
    role: 'User'
  });
  seedUser(database, {
    userId: ownerUserId,
    employeeId,
    lineUserId: null,
    displayName: 'Synthetic Vendor Claim Owner',
    role: 'User',
    verificationStatus: 'UNVERIFIED'
  });
  addVendorPrincipal(database, { userId: ownerUserId });
  addVendorMembership(database, { userId: ownerUserId, vendorId: 'synthetic-vendor-claim' });
  database.run(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, employee_id, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, 'UNVERIFIED_EMPLOYEE', ?, ?)
  `, 'synthetic-vendor-claim-evidence', 'synthetic-vendor-claim-evidence-hash',
  ownerUserId, employeeId, '2026-10-20T00:00:00.000Z', '2099-01-01T00:00:00.000Z');

  await assert.rejects(claimProvisionalEmployee(database, {
    survivorUserId: 'synthetic-line-claim-survivor',
    lineUserId: 'synthetic-line-claim-survivor',
    employeeId,
    clock: new Date('2026-10-20T00:00:00.000Z')
  }), { code: 'EMPLOYEE_ID_ALREADY_BOUND' });
  assert.equal(database.get(
    'SELECT employee_id FROM users WHERE user_id = ?', ownerUserId
  ).employee_id, employeeId);
  assert.equal(database.get(
    'SELECT employee_id FROM users WHERE user_id = ?', 'synthetic-line-claim-survivor'
  ).employee_id, null);
});

test('Admin identity repair and LINE transfer previews exclude Vendor principals', async () => {
  const database = new SqliteD1();
  const vendorSource = 'synthetic-vendor-transfer-source';
  const vendorTarget = 'synthetic-vendor-repair-target';
  const adminIdentity = {
    actor: {
      userId: 'synthetic-admin-identity-actor',
      employeeId: 'SYNTHETIC-ADMIN-IDENTITY-ACTOR',
      lineUserId: 'synthetic-line-admin-identity-actor',
      role: 'Admin',
      active: true,
      authMode: 'line'
    },
    authorizationActor: {
      userId: 'synthetic-admin-identity-actor',
      employeeId: 'SYNTHETIC-ADMIN-IDENTITY-ACTOR',
      lineUserId: 'synthetic-line-admin-identity-actor',
      role: 'Admin',
      active: true,
      authMode: 'line'
    }
  };
  seedUser(database, {
    userId: vendorSource,
    employeeId: 'SYNTHETIC-VENDOR-TRANSFER-SOURCE',
    lineUserId: 'synthetic-line-vendor-transfer-source',
    displayName: '合成 Vendor 轉移來源',
    role: 'User'
  });
  seedUser(database, {
    userId: vendorTarget,
    employeeId: 'SYNTHETIC-VENDOR-REPAIR-TARGET',
    lineUserId: null,
    displayName: '合成 Vendor 修復目標',
    role: 'User'
  });
  seedUser(database, {
    userId: 'synthetic-general-repair-source',
    employeeId: 'SYNTHETIC-GENERAL-REPAIR-SOURCE',
    lineUserId: 'synthetic-line-general-repair-source',
    displayName: '合成一般修復來源',
    role: 'User'
  });
  seedVendor(database, { vendorId: 'synthetic-vendor-identity-tools', name: '合成廠商' });
  addVendorPrincipal(database, { userId: vendorSource });
  addVendorMembership(database, { userId: vendorSource, vendorId: 'synthetic-vendor-identity-tools' });
  addVendorPrincipal(database, { userId: vendorTarget });
  addVendorMembership(database, { userId: vendorTarget, vendorId: 'synthetic-vendor-identity-tools' });

  const transfer = await getLineBindingTransferPreview(
    database,
    adminIdentity,
    vendorSource,
    'SYNTHETIC-VENDOR-REPAIR-TARGET',
    new Date('2026-10-20T00:00:00.000Z')
  );
  assert.equal(transfer.readyToTransfer, false);
  assert.equal(transfer.conflicts.includes('SOURCE_VENDOR_PRINCIPAL'), true);
  assert.equal(transfer.conflicts.includes('TARGET_VENDOR_PRINCIPAL'), true);

  const repair = await getInvalidEmployeeRepairPreview(
    database,
    adminIdentity,
    'synthetic-general-repair-source',
    vendorTarget
  );
  assert.equal(repair.readyToRepair, false);
  assert.equal(repair.conflicts.includes('TARGET_VENDOR_PRINCIPAL'), true);
});
