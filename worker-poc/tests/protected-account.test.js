import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGuestSession } from '../src/auth/guestSession.js';
import { claimProvisionalEmployee } from '../src/domain/employeeClaim.js';
import { handleFormalRequest } from '../src/formalWorker.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const PROTECTED_USER_ID = 'synthetic-protected-user';
const PROTECTED_LINE_ID = 'line-synthetic-protected-owner';
const PROTECTED_TOKEN = 'synthetic-protected-token';
const protectedEmployeeId = () => '0'.repeat(6);

const call = async (database, path, options = {}, runtime = {}) => {
  const response = await handleFormalRequest(
    request(path, options),
    { DB: database },
    { now: runtime.now || NOW, fetchImpl: runtime.fetchImpl || profileFetch() }
  );
  return { response, body: await response.json() };
};

const protectedDatabase = (overrides = {}) => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: PROTECTED_USER_ID,
    employeeId: protectedEmployeeId(),
    lineUserId: PROTECTED_LINE_ID,
    displayName: 'Synthetic Protected User',
    ...overrides
  });
  return database;
};

const ownerFetch = profileFetch({
  token: PROTECTED_TOKEN,
  lineUserId: PROTECTED_LINE_ID,
  displayName: 'Synthetic LINE Owner'
});

const adminToken = 'synthetic-admin-token';
const adminFetch = profileFetch({
  token: adminToken,
  lineUserId: 'line-synthetic-admin',
  displayName: 'Synthetic Admin'
});

const strangerFetch = profileFetch({
  token: 'synthetic-stranger-token',
  lineUserId: 'line-synthetic-stranger',
  displayName: 'Synthetic Stranger'
});

test('protected account permits only the active verified account’s existing LINE owner', async () => {
  const database = protectedDatabase();
  const lookup = await call(database, '/api/auth/line-employee-lookup', {
    method: 'POST',
    token: PROTECTED_TOKEN,
    body: { employeeId: ` ${protectedEmployeeId()} ` }
  }, { fetchImpl: ownerFetch });

  assert.equal(lookup.response.status, 200);
  assert.equal(lookup.body.status, 'FOUND');
  assert.equal(lookup.body.resolution, 'PROTECTED_LINE_ACCOUNT');
  assert.equal(lookup.body.ownershipChanged, false);
  assert.equal(lookup.body.employeeId, protectedEmployeeId());
  assert.equal(lookup.body.user.name, 'Synthetic Protected User');
  assert.equal(lookup.body.user.lineUserId, undefined);
  assert.equal(JSON.stringify(lookup.body).includes(PROTECTED_LINE_ID), false);

  const bind = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: PROTECTED_TOKEN,
    body: { employeeId: protectedEmployeeId(), displayName: 'Ignored Synthetic Name', pickupFloor: '9樓' }
  }, { fetchImpl: ownerFetch });
  assert.equal(bind.response.status, 200);
  assert.equal(bind.body.status, 'ALREADY_BOUND');
  assert.equal(JSON.stringify(bind.body).includes(PROTECTED_LINE_ID), false);
  assert.equal(database.get('SELECT employee_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).employee_id, protectedEmployeeId());
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).line_user_id, PROTECTED_LINE_ID);
  const me = await call(database, '/api/me', { token: PROTECTED_TOKEN }, { fetchImpl: ownerFetch });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.userId, PROTECTED_USER_ID);
  assert.equal(me.body.lineUserId, '');
  assert.equal(JSON.stringify(me.body).includes(PROTECTED_LINE_ID), false);
  const bootstrap = await call(database, '/api/bootstrap', { token: PROTECTED_TOKEN }, { fetchImpl: ownerFetch });
  assert.equal(bootstrap.response.status, 200);
  assert.equal(JSON.stringify(bootstrap.body).includes(PROTECTED_LINE_ID), false);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM protected_account_access_audit').count, 0);
});

test('stranger lookup and bind fail closed without changing identity ownership', async () => {
  const database = protectedDatabase();
  for (const path of ['/api/auth/line-employee-lookup', '/api/auth/line-employee-bind']) {
    const result = await call(database, path, {
      method: 'POST',
      token: 'synthetic-stranger-token',
      body: {
        employeeId: protectedEmployeeId(),
        lineUserId: PROTECTED_LINE_ID,
        userId: PROTECTED_USER_ID,
        role: 'Admin',
        displayName: 'Synthetic Attempt',
        pickupFloor: '1樓'
      }
    }, { fetchImpl: strangerFetch });
    assert.equal(result.response.status, 403, path);
    assert.deepEqual(result.body, { error: 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED' });
  }
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).line_user_id, PROTECTED_LINE_ID);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM protected_account_access_audit').count, 2);
});

test('simultaneous rebind attempts from different LINE subjects cannot claim protected ownership', async () => {
  const database = protectedDatabase();
  const attempts = [
    {
      token: 'synthetic-stranger-one-token',
      fetchImpl: profileFetch({ token: 'synthetic-stranger-one-token', lineUserId: 'line-synthetic-stranger-one' })
    },
    {
      token: 'synthetic-stranger-two-token',
      fetchImpl: profileFetch({ token: 'synthetic-stranger-two-token', lineUserId: 'line-synthetic-stranger-two' })
    }
  ];
  const results = await Promise.all(attempts.map(({ token, fetchImpl }) => call(
    database,
    '/api/auth/line-employee-bind',
    { method: 'POST', token, body: { employeeId: protectedEmployeeId(), displayName: 'Synthetic Attempt', pickupFloor: '1樓' } },
    { fetchImpl }
  )));
  assert.deepEqual(results.map(({ response }) => response.status), [403, 403]);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).line_user_id, PROTECTED_LINE_ID);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM protected_account_access_audit').count, 2);
});

test('employee login, onboarding, and old guest sessions cannot use protected employee identity', async () => {
  const database = protectedDatabase();
  const guestLogin = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: protectedEmployeeId() }
  });
  assert.equal(guestLogin.response.status, 403);
  assert.equal(guestLogin.body.error, 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM employee_guest_sessions').count, 0);

  const lineBindSession = await createGuestSession(database, {
    userId: PROTECTED_USER_ID,
    employeeId: protectedEmployeeId(),
    status: 'VERIFIED',
    clock: NOW
  });
  const legitimateReplay = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: PROTECTED_TOKEN,
    headers: { 'X-Employee-Guest-Session': lineBindSession.token },
    body: {}
  }, { fetchImpl: ownerFetch });
  assert.equal(legitimateReplay.response.status, 200);
  assert.equal(legitimateReplay.body.status, 'ALREADY_BOUND');
  const foreignReplay = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'synthetic-stranger-token',
    headers: { 'X-Employee-Guest-Session': lineBindSession.token },
    body: {}
  }, { fetchImpl: strangerFetch });
  assert.equal(foreignReplay.response.status, 403);
  assert.equal(foreignReplay.body.error, 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).line_user_id, PROTECTED_LINE_ID);

  const onboardingSession = await createGuestSession(database, {
    userId: PROTECTED_USER_ID,
    employeeId: protectedEmployeeId(),
    status: 'VERIFIED',
    clock: NOW
  });
  const onboarding = await call(database, '/api/auth/employee-guest/onboarding', {
    method: 'POST',
    token: '',
    headers: { 'X-Employee-Guest-Session': onboardingSession.token },
    body: { displayName: 'Synthetic Attempt', pickupFloor: '1樓' }
  });
  assert.equal(onboarding.response.status, 403);
  assert.equal(onboarding.body.error, 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');

  const oldSession = await createGuestSession(database, {
    userId: PROTECTED_USER_ID,
    employeeId: protectedEmployeeId(),
    status: 'VERIFIED',
    clock: NOW
  });
  const me = await call(database, '/api/me', { token: oldSession.token });
  assert.equal(me.response.status, 403);
  assert.equal(me.body.error, 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM protected_account_access_audit').count, 4);
});

test('expired legacy guest sessions cannot resume protected-account access', async () => {
  const database = protectedDatabase();
  const expired = await createGuestSession(database, {
    userId: PROTECTED_USER_ID,
    employeeId: protectedEmployeeId(),
    status: 'VERIFIED',
    clock: new Date('2026-10-19T00:00:00.000Z')
  });
  const result = await call(database, '/api/me', { token: expired.token });
  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, 'GUEST_SESSION_INVALID');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM protected_account_access_audit').count, 0);
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).line_user_id, PROTECTED_LINE_ID);
});

test('direct LINE sessions for inactive or unverified protected owners are denied', async (context) => {
  for (const [label, overrides] of [
    ['inactive', { active: 0 }],
    ['unverified', { verificationStatus: 'UNVERIFIED' }]
  ]) {
    await context.test(label, async () => {
      const database = protectedDatabase(overrides);
      const result = await call(database, '/api/me', {
        token: PROTECTED_TOKEN
      }, { fetchImpl: ownerFetch });
      assert.equal(result.response.status, 403);
      assert.equal(result.body.error, 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
      assert.equal(database.get('SELECT COUNT(*) AS count FROM protected_account_access_audit').count, 1);
    });
  }
});

test('authorized admin transfer preview and submission cannot move protected LINE ownership', async () => {
  const database = protectedDatabase();
  seedUser(database, {
    userId: 'synthetic-admin-user',
    employeeId: 'SYNTHETIC-ADMIN',
    lineUserId: 'line-synthetic-admin',
    displayName: 'Synthetic Admin',
    role: 'Admin'
  });
  seedUser(database, {
    userId: 'synthetic-target-user',
    employeeId: 'SYNTHETIC-TARGET',
    lineUserId: null,
    displayName: 'Synthetic Target'
  });
  const preview = await call(database,
    '/api/admin/users/synthetic-protected-user/line-binding-transfer-preview?employeeId=SYNTHETIC-TARGET',
    { token: adminToken },
    { fetchImpl: adminFetch }
  );
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.readyToTransfer, false);
  assert.ok(preview.body.conflicts.includes('PROTECTED_ACCOUNT_LINE_BINDING_IMMUTABLE'));
  assert.deepEqual(preview.body.source.lineBinding, { bound: true, masked: null });
  assert.equal(JSON.stringify(preview.body).includes(PROTECTED_LINE_ID), false);

  const protectedTargetPreview = await call(
    database,
    `/api/admin/users/synthetic-target-user/line-binding-transfer-preview?employeeId=${protectedEmployeeId()}`,
    { token: adminToken },
    { fetchImpl: adminFetch }
  );
  assert.equal(protectedTargetPreview.response.status, 200);
  assert.deepEqual(protectedTargetPreview.body.target.lineBinding, { bound: true, masked: null });
  assert.equal(JSON.stringify(protectedTargetPreview.body).includes(PROTECTED_LINE_ID), false);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count FROM admin_audit_log
    WHERE action = 'PROTECTED_ACCOUNT_LINE_BINDING_TRANSFER_PREVIEW'
  `).count, 2);

  const transfer = await call(database,
    '/api/admin/users/synthetic-protected-user/line-binding-transfer',
    {
      method: 'POST',
      token: adminToken,
      body: {
        employeeId: 'SYNTHETIC-TARGET',
        previewFingerprint: preview.body.previewFingerprint
      }
    },
    { fetchImpl: adminFetch }
  );
  assert.equal(transfer.response.status, 409);
  assert.equal(transfer.body.error, 'PROTECTED_ACCOUNT_LINE_BINDING_IMMUTABLE');
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).line_user_id, PROTECTED_LINE_ID);
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', 'synthetic-target-user').line_user_id, null);
  assert.equal(database.get('SELECT reason_code FROM protected_account_access_audit').reason_code, 'PROTECTED_ACCOUNT_ADMIN_TRANSFER_BLOCKED');
  const denialAudit = database.get(`
    SELECT actor_user_id, actor_line_user_id_snapshot, target_user_id,
      target_employee_id_snapshot, target_line_user_id_snapshot, action, metadata_json
    FROM admin_audit_log
    WHERE action = 'PROTECTED_ACCOUNT_LINE_BINDING_TRANSFER_DENIED'
  `);
  assert.equal(denialAudit.actor_user_id, 'synthetic-admin-user');
  assert.equal(denialAudit.actor_line_user_id_snapshot, null);
  assert.equal(denialAudit.target_user_id, null);
  assert.equal(denialAudit.target_employee_id_snapshot, null);
  assert.equal(denialAudit.target_line_user_id_snapshot, null);
  assert.ok(denialAudit.metadata_json.includes('PROTECTED_ACCOUNT_LINE_BINDING_IMMUTABLE'));
  assert.equal(database.get(`
    SELECT COUNT(*) AS count FROM admin_audit_log
    WHERE action IN (
      'PROTECTED_ACCOUNT_LINE_BINDING_TRANSFER_PREVIEW',
      'PROTECTED_ACCOUNT_LINE_BINDING_TRANSFER_DENIED'
    )
  `).count, 3);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'LINE_BINDING_TRANSFER'").count, 0);
});

test('admin employee binding cannot assign or replace the protected employee identity', async () => {
  const database = protectedDatabase();
  seedUser(database, {
    userId: 'synthetic-admin-user',
    employeeId: 'SYNTHETIC-ADMIN',
    lineUserId: 'line-synthetic-admin',
    displayName: 'Synthetic Admin',
    role: 'Admin'
  });
  seedUser(database, {
    userId: 'synthetic-unbound-user',
    employeeId: null,
    lineUserId: null,
    displayName: 'Synthetic Unbound'
  });

  const claim = await call(database, '/api/admin/users/synthetic-unbound-user/employee-binding', {
    method: 'POST',
    token: adminToken,
    body: { employeeId: protectedEmployeeId() }
  }, { fetchImpl: adminFetch });
  assert.equal(claim.response.status, 403);
  assert.equal(claim.body.error, 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
  assert.equal(database.get('SELECT employee_id FROM users WHERE user_id = ?', 'synthetic-unbound-user').employee_id, null);

  const rewrite = await call(database, '/api/admin/users/synthetic-protected-user/employee-binding', {
    method: 'POST',
    token: adminToken,
    body: { employeeId: 'SYNTHETIC-OTHER' }
  }, { fetchImpl: adminFetch });
  assert.equal(rewrite.response.status, 403);
  assert.equal(rewrite.body.error, 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
  assert.equal(database.get('SELECT employee_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).employee_id, protectedEmployeeId());
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).line_user_id, PROTECTED_LINE_ID);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM protected_account_access_audit').count, 2);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count FROM admin_audit_log
    WHERE action = 'PROTECTED_ACCOUNT_EMPLOYEE_BIND_DENIED'
      AND target_user_id IS NULL
      AND target_employee_id_snapshot IS NULL
      AND target_line_user_id_snapshot IS NULL
      AND actor_employee_id_snapshot IS NULL
      AND actor_line_user_id_snapshot IS NULL
  `).count, 2);
});

test('provisional employee claim helper rejects protected identity even if called directly', async () => {
  const database = protectedDatabase({ lineUserId: null });
  await assert.rejects(() => claimProvisionalEmployee(database, {
    survivorUserId: 'synthetic-survivor-user',
    lineUserId: 'line-synthetic-survivor',
    employeeId: protectedEmployeeId(),
    clock: NOW
  }), (error) => error?.status === 403
    && error?.code === 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
  assert.equal(database.get('SELECT employee_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).employee_id, protectedEmployeeId());
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).line_user_id, null);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM protected_account_access_audit').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 0);
});

test('identity repair preview and submission reject protected accounts and leave deidentified audits', async (context) => {
  for (const side of ['source', 'target']) {
    await context.test(side, async () => {
      const database = protectedDatabase();
      seedUser(database, {
        userId: 'synthetic-admin-user',
        employeeId: 'SYNTHETIC-ADMIN',
        lineUserId: 'line-synthetic-admin',
        displayName: 'Synthetic Admin',
        role: 'Admin'
      });
      seedUser(database, {
        userId: 'synthetic-source-user',
        employeeId: 'SYNTHETIC-SOURCE',
        lineUserId: null,
        displayName: 'Synthetic Source'
      });
      seedUser(database, {
        userId: 'synthetic-target-user',
        employeeId: 'SYNTHETIC-TARGET',
        lineUserId: null,
        displayName: 'Synthetic Target'
      });
      const sourceUserId = side === 'source' ? PROTECTED_USER_ID : 'synthetic-source-user';
      const targetUserId = side === 'target' ? PROTECTED_USER_ID : 'synthetic-target-user';
      const preview = await call(database,
        `/api/admin/users/${sourceUserId}/invalid-employee-repair-preview?targetUserId=${targetUserId}`,
        { token: adminToken },
        { fetchImpl: adminFetch }
      );
      assert.equal(preview.response.status, 200);
      assert.equal(preview.body.readyToRepair, false);
      assert.ok(preview.body.conflicts.includes('PROTECTED_ACCOUNT_IDENTITY_REPAIR_BLOCKED'));

      const submission = await call(database,
        `/api/admin/users/${sourceUserId}/invalid-employee-repair`,
        { method: 'POST', token: adminToken, body: { targetUserId } },
        { fetchImpl: adminFetch }
      );
      assert.equal(submission.response.status, 409);
      assert.equal(submission.body.error, 'INVALID_EMPLOYEE_REPAIR_NOT_READY');
      assert.equal(database.get('SELECT active FROM users WHERE user_id = ?', PROTECTED_USER_ID).active, 1);
      assert.equal(database.get('SELECT invalid_reason FROM users WHERE user_id = ?', PROTECTED_USER_ID).invalid_reason, null);
      assert.equal(database.get('SELECT employee_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).employee_id, protectedEmployeeId());
      assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', PROTECTED_USER_ID).line_user_id, PROTECTED_LINE_ID);
      assert.equal(database.get('SELECT COUNT(*) AS count FROM protected_account_access_audit').count, 2);
      assert.equal(database.get(`
        SELECT COUNT(*) AS count FROM admin_audit_log
        WHERE action IN (
          'PROTECTED_ACCOUNT_IDENTITY_REPAIR_PREVIEW_BLOCKED',
          'PROTECTED_ACCOUNT_IDENTITY_REPAIR_DENIED'
        )
          AND target_user_id IS NULL
          AND actor_employee_id_snapshot IS NULL
          AND actor_line_user_id_snapshot IS NULL
          AND target_employee_id_snapshot IS NULL
          AND target_line_user_id_snapshot IS NULL
      `).count, 2);
    });
  }
});

test('View As cannot enter a protected account and the authorized Admin attempt is audited', async () => {
  const database = protectedDatabase();
  seedUser(database, {
    userId: 'synthetic-admin-user',
    employeeId: 'SYNTHETIC-ADMIN',
    lineUserId: 'line-synthetic-admin',
    displayName: 'Synthetic Admin',
    role: 'Admin'
  });
  const result = await call(database,
    '/api/calendar?viewAsUserId=synthetic-protected-user',
    { token: adminToken },
    { fetchImpl: adminFetch }
  );
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, 'PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
  const audit = database.get(`
    SELECT actor_user_id, actor_line_user_id_snapshot, target_user_id,
      target_employee_id_snapshot, target_line_user_id_snapshot, action, metadata_json
    FROM admin_audit_log WHERE action = 'PROTECTED_ACCOUNT_VIEW_AS_DENIED'
  `);
  assert.equal(audit.actor_user_id, 'synthetic-admin-user');
  assert.equal(audit.actor_line_user_id_snapshot, null);
  assert.equal(audit.target_user_id, null);
  assert.equal(audit.target_employee_id_snapshot, null);
  assert.equal(audit.target_line_user_id_snapshot, null);
  assert.ok(audit.metadata_json.includes('PROTECTED_ACCOUNT_VIEW_AS_FORBIDDEN'));
  assert.equal(database.get('SELECT reason_code FROM protected_account_access_audit').reason_code, 'PROTECTED_ACCOUNT_VIEW_AS_BLOCKED');
});

test('missing and ambiguous protected employee ownership fail closed', async (context) => {
  await context.test('missing', async () => {
    const database = new SqliteD1();
    const result = await call(database, '/api/auth/line-employee-lookup', {
      method: 'POST',
      token: 'synthetic-stranger-token',
      body: { employeeId: protectedEmployeeId() }
    }, { fetchImpl: strangerFetch });
    assert.equal(result.response.status, 403);
    assert.equal(database.get('SELECT reason_code FROM protected_account_access_audit').reason_code, 'PROTECTED_ACCOUNT_MISSING');
  });

  await context.test('ambiguous', async () => {
    const database = protectedDatabase();
    database.exec('DROP INDEX users_employee_id_normalized_unique');
    seedUser(database, {
      userId: 'synthetic-protected-alias',
      employeeId: ` ${protectedEmployeeId()} `,
      lineUserId: 'line-synthetic-protected-alias',
      displayName: 'Synthetic Alias'
    });
    const result = await call(database, '/api/auth/line-employee-lookup', {
      method: 'POST',
      token: 'synthetic-stranger-token',
      body: { employeeId: protectedEmployeeId() }
    }, { fetchImpl: strangerFetch });
    assert.equal(result.response.status, 403);
    assert.equal(database.get('SELECT reason_code FROM protected_account_access_audit').reason_code, 'PROTECTED_ACCOUNT_AMBIGUOUS');
  });
});

test('protected account denial audit contains only deidentified, append-only fields', async () => {
  const database = protectedDatabase();
  await call(database, '/api/auth/line-employee-lookup', {
    method: 'POST',
    token: 'synthetic-stranger-token',
    body: { employeeId: protectedEmployeeId() }
  }, { fetchImpl: strangerFetch });

  const columns = database.database.prepare('PRAGMA table_info(protected_account_access_audit)').all();
  assert.deepEqual(columns.map(({ name }) => name), [
    'event_id', 'auth_mode', 'reason_code', 'occurred_at'
  ]);
  const audit = database.get('SELECT * FROM protected_account_access_audit');
  assert.deepEqual(Object.keys(audit).sort(), ['auth_mode', 'event_id', 'occurred_at', 'reason_code']);
  assert.equal(audit.auth_mode, 'line');
  assert.equal(audit.reason_code, 'LINE_OWNER_MISMATCH');
  assert.equal(JSON.stringify(audit).includes(PROTECTED_LINE_ID), false);
  assert.equal(JSON.stringify(audit).includes('line-synthetic-stranger'), false);
  assert.throws(() => database.run('UPDATE protected_account_access_audit SET reason_code = ? WHERE event_id = ?', 'AUTHORIZATION_UNVERIFIED', audit.event_id), /append-only/i);
  assert.throws(() => database.run('DELETE FROM protected_account_access_audit WHERE event_id = ?', audit.event_id), /append-only/i);
});
