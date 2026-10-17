import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedLedgerRow, seedUser } from './helpers/formal-fixtures.js';

const NOW = new Date('2026-10-17T02:00:00.000Z');
const SOURCE_USER = 'user-source-synthetic';
const TARGET_USER = 'user-target-synthetic';
const SOURCE_EMPLOYEE = 'SYNTHETIC-EMPLOYEE-SOURCE';
const TARGET_EMPLOYEE = 'SYNTHETIC-EMPLOYEE-TARGET';

const call = async (database, path, options = {}, profile = {}) => {
  const token = options.token || 'test-admin-token';
  const response = await handleFormalRequest(
    request(path, { token, ...options }),
    { DB: database },
    {
      fetchImpl: profileFetch({
        token,
        lineUserId: 'synthetic-line-admin',
        displayName: '測試管理員',
        ...profile
      }),
      now: NOW
    }
  );
  return { response, body: await response.json() };
};

const repairPayload = (preview, confirmTargetDisplayName = preview.body.target.displayName) => ({
  targetUserId: TARGET_USER,
  expectedSourceUpdatedAt: preview.body.source.updatedAt,
  expectedTargetUpdatedAt: preview.body.target.updatedAt,
  expectedSourceDisplayName: preview.body.source.displayName,
  expectedSourceEmployeeId: preview.body.source.employeeId,
  expectedTargetEmployeeId: preview.body.target.employeeId,
  expectedSourceBalance: preview.body.source.balance,
  expectedTargetBalance: preview.body.target.balance,
  confirmTargetDisplayName
});

const seedRepairDatabase = () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'user-admin-synthetic',
    employeeId: 'SYNTHETIC-EMPLOYEE-ADMIN',
    lineUserId: 'synthetic-line-admin',
    displayName: '測試管理員',
    role: 'Admin'
  });
  seedUser(database, {
    userId: SOURCE_USER,
    employeeId: SOURCE_EMPLOYEE,
    lineUserId: 'synthetic-line-source',
    displayName: '測試來源帳號',
    pickupFloor: '1樓'
  });
  seedUser(database, {
    userId: TARGET_USER,
    employeeId: TARGET_EMPLOYEE,
    lineUserId: 'synthetic-line-target',
    displayName: '測試目標帳號',
    pickupFloor: '9樓',
    balance: 350,
    role: 'User'
  });
  database.run(`
    INSERT INTO orders (
      order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, order_date, vendor, pickup_floor, note,
      total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES (
      'order-target-synthetic', ?, ?, 'synthetic-line-target',
      '測試目標帳號', '2026-10-16', '測試店家', '9樓', '',
      120, 'COMPLETED', ?, 'line'
    )
  `, TARGET_USER, TARGET_EMPLOYEE, TARGET_USER);
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, item_name_snapshot, quantity, unit_price, subtotal
    ) VALUES ('order-target-synthetic', 1, '測試餐點', 1, 120, 120)
  `);
  seedLedgerRow(database, {
    transactionId: 'ledger-target-synthetic',
    userId: TARGET_USER,
    amount: 350,
    balanceAfter: 350,
    type: 'TOPUP'
  });
  return database;
};

test('synthetic invalid employee repair previews and atomically preserves target identity and history', async () => {
  const database = seedRepairDatabase();
  const beforeTarget = database.get(`
    SELECT user_id, employee_id, line_user_id, role, pickup_floor, balance
    FROM users WHERE user_id = ?
  `, TARGET_USER);
  const beforeOrder = database.get(`
    SELECT order_id, user_id, total_amount, status FROM orders WHERE order_id = ?
  `, 'order-target-synthetic');
  const beforeLedger = database.get(`
    SELECT transaction_id, user_id, amount, balance_after, type
    FROM balance_ledger WHERE transaction_id = ?
  `, 'ledger-target-synthetic');

  const preview = await call(
    database,
    `/api/admin/users/${SOURCE_USER}/invalid-employee-repair-preview?targetUserId=${TARGET_USER}`
  );
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.readyToRepair, true);
  assert.equal(preview.body.source.userId, SOURCE_USER);
  assert.equal(preview.body.target.userId, TARGET_USER);

  const repair = await call(
    database,
    `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`,
    {
      method: 'POST',
      body: repairPayload(preview)
    }
  );
  assert.equal(repair.response.status, 200);
  assert.equal(repair.body.success, true);

  const source = database.get('SELECT * FROM users WHERE user_id = ?', SOURCE_USER);
  const target = database.get('SELECT * FROM users WHERE user_id = ?', TARGET_USER);
  assert.equal(source.active, 0);
  assert.equal(source.invalid_reason, 'INVALID_EMPLOYEE_ID');
  assert.equal(source.employee_id, SOURCE_EMPLOYEE);
  assert.equal(target.display_name, '測試來源帳號');
  assert.equal(target.line_user_id, beforeTarget.line_user_id);
  assert.equal(target.employee_id, beforeTarget.employee_id);
  assert.equal(target.role, beforeTarget.role);
  assert.equal(target.pickup_floor, beforeTarget.pickup_floor);
  assert.equal(target.balance, beforeTarget.balance);
  assert.deepEqual(database.get('SELECT order_id, user_id, total_amount, status FROM orders WHERE order_id = ?', 'order-target-synthetic'), beforeOrder);
  assert.deepEqual(database.get('SELECT transaction_id, user_id, amount, balance_after, type FROM balance_ledger WHERE transaction_id = ?', 'ledger-target-synthetic'), beforeLedger);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'INVALID_EMPLOYEE_ID_REPAIR'").count, 1);
  const memberList = await call(database, '/api/admin/members/balances');
  assert.equal(memberList.body.members.some((member) => member.userId === SOURCE_USER), false);
});

test('synthetic repair keeps source balance and history in place and snapshots both names in audit', async () => {
  const database = seedRepairDatabase();
  seedLedgerRow(database, {
    transactionId: 'ledger-source-synthetic',
    userId: SOURCE_USER,
    amount: 150,
    balanceAfter: 150,
    type: 'TOPUP'
  });
  database.run(`
    INSERT INTO orders (
      order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, order_date, vendor, pickup_floor, note,
      total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES (
      'order-source-synthetic', ?, ?, 'synthetic-line-source',
      '測試來源帳號', '2026-10-16', '測試店家', '1樓', '',
      75, 'COMPLETED', ?, 'line'
    )
  `, SOURCE_USER, SOURCE_EMPLOYEE, SOURCE_USER);
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, item_name_snapshot, quantity, unit_price, subtotal
    ) VALUES ('order-source-synthetic', 1, '測試來源餐點', 1, 75, 75)
  `);
  const beforeOrder = database.get('SELECT * FROM orders WHERE order_id = ?', 'order-source-synthetic');
  const beforeLedger = database.get('SELECT * FROM balance_ledger WHERE transaction_id = ?', 'ledger-source-synthetic');

  const preview = await call(
    database,
    `/api/admin/users/${SOURCE_USER}/invalid-employee-repair-preview?targetUserId=${TARGET_USER}`
  );
  assert.equal(preview.body.source.balance, 150);
  await call(database, `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`, {
    method: 'POST',
    body: repairPayload(preview)
  });

  const audit = await call(database, '/api/admin/invalid-employee-repairs');
  const entry = audit.body.repairs[0];
  assert.equal(entry.sourceBalance, 150);
  assert.equal(entry.sourceDisplayName, '測試來源帳號');
  assert.equal(entry.targetOriginalDisplayName, '測試目標帳號');
  assert.equal(entry.targetDisplayName, '測試來源帳號');
  assert.equal(entry.targetBalance, 350);
  assert.equal(database.get('SELECT balance_after FROM balance_ledger WHERE transaction_id = ?', 'ledger-source-synthetic').balance_after, beforeLedger.balance_after);
  assert.deepEqual(database.get('SELECT * FROM orders WHERE order_id = ?', 'order-source-synthetic'), beforeOrder);
});

test('synthetic invalid employee repair requires a LINE Admin outside View As', async () => {
  const database = seedRepairDatabase();
  seedUser(database, {
    userId: 'user-ordinary-synthetic',
    employeeId: 'SYNTHETIC-EMPLOYEE-ORDINARY',
    lineUserId: 'synthetic-line-ordinary',
    displayName: '測試一般使用者'
  });
  const ordinary = await call(
    database,
    `/api/admin/users/${SOURCE_USER}/invalid-employee-repair-preview?targetUserId=${TARGET_USER}`,
    { token: 'test-ordinary-token' },
    { token: 'test-ordinary-token', lineUserId: 'synthetic-line-ordinary' }
  );
  assert.equal(ordinary.response.status, 403);

  const viewAs = await call(
    database,
    `/api/admin/users/${SOURCE_USER}/invalid-employee-repair-preview?targetUserId=${TARGET_USER}&viewAsUserId=${TARGET_USER}`
  );
  assert.equal(viewAs.response.status, 403);
  assert.equal(database.get('SELECT active, invalid_reason FROM users WHERE user_id = ?', SOURCE_USER).active, 1);
});

test('synthetic repair rejects stale previews and requires the target display name for overwrite confirmation', async () => {
  const database = seedRepairDatabase();
  const preview = await call(
    database,
    `/api/admin/users/${SOURCE_USER}/invalid-employee-repair-preview?targetUserId=${TARGET_USER}`
  );
  const originalTargetName = preview.body.target.displayName;
  const wrongName = await call(database, `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`, {
    method: 'POST',
    body: repairPayload(preview, '未確認名稱')
  });
  assert.equal(wrongName.response.status, 409);
  assert.equal(database.get('SELECT display_name FROM users WHERE user_id = ?', TARGET_USER).display_name, originalTargetName);

  database.run('UPDATE users SET updated_at = ? WHERE user_id = ?', '2026-10-17T03:00:00.000Z', TARGET_USER);
  const stale = await call(database, `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`, {
    method: 'POST',
    body: repairPayload(preview, originalTargetName)
  });
  assert.equal(stale.response.status, 409);
  assert.equal(database.get('SELECT active, invalid_reason FROM users WHERE user_id = ?', SOURCE_USER).active, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'INVALID_EMPLOYEE_ID_REPAIR'").count, 0);

  const changedSource = await call(database, `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`, {
    method: 'POST',
    body: { ...repairPayload(preview, originalTargetName), expectedSourceDisplayName: '測試已變更來源' }
  });
  assert.equal(changedSource.response.status, 409);
  assert.equal(database.get('SELECT active FROM users WHERE user_id = ?', SOURCE_USER).active, 1);
});

test('synthetic concurrent repair submissions apply the repair and audit once', async () => {
  const database = seedRepairDatabase();
  const preview = await call(
    database,
    `/api/admin/users/${SOURCE_USER}/invalid-employee-repair-preview?targetUserId=${TARGET_USER}`
  );
  const options = {
    method: 'POST',
    body: repairPayload(preview)
  };
  const results = await Promise.all([
    call(database, `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`, options),
    call(database, `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`, options)
  ]);
  assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 409]);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'INVALID_EMPLOYEE_ID_REPAIR'").count, 1);
  assert.equal(database.get('SELECT invalid_reason FROM users WHERE user_id = ?', SOURCE_USER).invalid_reason, 'INVALID_EMPLOYEE_ID');
});

test('synthetic ledger changes after preview reject repair before either identity is modified', async () => {
  for (const changedUserId of [SOURCE_USER, TARGET_USER]) {
    const database = seedRepairDatabase();
    const preview = await call(
      database,
      `/api/admin/users/${SOURCE_USER}/invalid-employee-repair-preview?targetUserId=${TARGET_USER}`
    );
    const originalBatch = database.batch.bind(database);
    database.batch = async (statements) => {
      seedLedgerRow(database, {
        transactionId: `ledger-concurrent-${changedUserId}`,
        userId: changedUserId,
        amount: 10,
        balanceAfter: changedUserId === SOURCE_USER ? 10 : 360,
        type: 'TOPUP'
      });
      return originalBatch(statements);
    };

    const result = await call(database, `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`, {
      method: 'POST',
      body: repairPayload(preview)
    });
    assert.equal(result.response.status, 409, `changed user: ${changedUserId}`);
    assert.equal(result.body.error, 'INVALID_EMPLOYEE_REPAIR_STALE');
    const source = database.get('SELECT active, invalid_reason FROM users WHERE user_id = ?', SOURCE_USER);
    assert.equal(source.active, 1);
    assert.equal(source.invalid_reason, null);
    assert.equal(database.get('SELECT display_name FROM users WHERE user_id = ?', TARGET_USER).display_name, '測試目標帳號');
    assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'INVALID_EMPLOYEE_ID_REPAIR'").count, 0);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger WHERE transaction_id = ?', `ledger-concurrent-${changedUserId}`).count, 1);
  }
});

test('synthetic audit insert failure rolls back both user updates', async () => {
  const database = seedRepairDatabase();
  const preview = await call(
    database,
    `/api/admin/users/${SOURCE_USER}/invalid-employee-repair-preview?targetUserId=${TARGET_USER}`
  );
  database.exec(`
    CREATE TRIGGER reject_synthetic_repair_audit
    BEFORE INSERT ON admin_audit_log
    WHEN NEW.action = 'INVALID_EMPLOYEE_ID_REPAIR'
    BEGIN
      SELECT RAISE(ABORT, 'synthetic audit failure');
    END;
  `);
  const result = await call(database, `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`, {
    method: 'POST',
    body: repairPayload(preview)
  });
  assert.equal(result.response.status, 500);
  assert.equal(database.get('SELECT active, invalid_reason FROM users WHERE user_id = ?', SOURCE_USER).active, 1);
  assert.equal(database.get('SELECT display_name FROM users WHERE user_id = ?', TARGET_USER).display_name, '測試目標帳號');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'INVALID_EMPLOYEE_ID_REPAIR'").count, 0);
});

test('synthetic invalid identity marker blocks LINE, registration, employee guest, onboarding, and reactivated sessions', async () => {
  const database = seedRepairDatabase();
  const { createGuestSession } = await import('../src/auth/guestSession.js');
  const registeredGuest = await createGuestSession(database, {
    userId: SOURCE_USER,
    employeeId: SOURCE_EMPLOYEE,
    clock: NOW
  });
  const provisionalGuest = await createGuestSession(database, {
    employeeId: SOURCE_EMPLOYEE,
    status: 'UNVERIFIED_EMPLOYEE',
    clock: NOW
  });
  database.run('UPDATE users SET invalid_reason = ? WHERE user_id = ?', 'INVALID_EMPLOYEE_ID', SOURCE_USER);

  await assert.rejects(
    createGuestSession(database, { userId: SOURCE_USER, employeeId: SOURCE_EMPLOYEE, clock: NOW }),
    (error) => error?.code === 'INVALID_EMPLOYEE_ID'
  );
  await assert.rejects(
    createGuestSession(database, { employeeId: SOURCE_EMPLOYEE, status: 'UNVERIFIED_EMPLOYEE', clock: NOW }),
    (error) => error?.code === 'INVALID_EMPLOYEE_ID'
  );

  const employeeGuest = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: SOURCE_EMPLOYEE }
  });
  assert.equal(employeeGuest.response.status, 403);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM employee_guest_sessions').count, 2);

  const lookup = await call(database, '/api/auth/line-employee-lookup', {
    method: 'POST',
    body: { employeeId: SOURCE_EMPLOYEE },
    token: 'test-new-line-token'
  }, { token: 'test-new-line-token', lineUserId: 'synthetic-line-new', displayName: '測試新使用者' });
  assert.equal(lookup.response.status, 403);

  const bind = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: {
      employeeId: SOURCE_EMPLOYEE,
      displayName: '測試覆寫名稱',
      pickupFloor: '1樓'
    },
    token: 'test-new-line-token'
  }, { token: 'test-new-line-token', lineUserId: 'synthetic-line-new', displayName: '測試新使用者' });
  assert.equal(bind.response.status, 403);

  const lineLogin = await call(database, '/api/me', {
    token: 'test-source-line-token'
  }, { token: 'test-source-line-token', lineUserId: 'synthetic-line-source' });
  assert.equal(lineLogin.response.status, 403);

  const guestMe = await call(database, '/api/me', { token: registeredGuest.token });
  assert.equal(guestMe.response.status, 401);

  const lineBinding = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'test-new-line-token',
    headers: { 'X-Employee-Guest-Session': provisionalGuest.token },
    body: { displayName: '測試新姓名', pickupFloor: '1樓' }
  }, { token: 'test-new-line-token', lineUserId: 'synthetic-line-new', displayName: '測試新使用者' });
  assert.equal(lineBinding.response.status, 403);

  const onboarding = await call(database, '/api/auth/employee-guest/onboarding', {
    method: 'POST',
    token: 'test-onboarding-bearer',
    headers: { 'X-Employee-Guest-Session': provisionalGuest.token },
    body: { displayName: '測試新姓名', pickupFloor: '1樓' }
  });
  assert.equal(onboarding.response.status, 403);

  const adminBind = await call(database, `/api/admin/users/${SOURCE_USER}/employee-binding`, {
    method: 'POST',
    body: { employeeId: 'SYNTHETIC-EMPLOYEE-OTHER' }
  });
  assert.equal(adminBind.response.status, 403);
  assert.equal(adminBind.body.error, 'INVALID_EMPLOYEE_ID');

  const roleChange = await call(database, `/api/admin/users/${SOURCE_USER}/role`, {
    method: 'PUT',
    body: { role: 'Admin' }
  });
  assert.equal(roleChange.response.status, 403);
  assert.equal(roleChange.body.error, 'INVALID_EMPLOYEE_ID');
  assert.equal(database.get('SELECT role FROM users WHERE user_id = ?', SOURCE_USER).role, 'User');

  const transferPreview = await call(database,
    `/api/admin/users/${SOURCE_USER}/line-binding-transfer-preview?employeeId=${TARGET_EMPLOYEE}`
  );
  assert.equal(transferPreview.response.status, 200);
  assert.ok(transferPreview.body.conflicts.includes('SOURCE_INVALID_EMPLOYEE_ID'));
  const transfer = await call(database, `/api/admin/users/${SOURCE_USER}/line-binding-transfer`, {
    method: 'POST',
    body: { employeeId: TARGET_EMPLOYEE, previewFingerprint: transferPreview.body.previewFingerprint }
  });
  assert.equal(transfer.response.status, 409);
  assert.equal(database.get('SELECT line_user_id FROM users WHERE user_id = ?', SOURCE_USER).line_user_id, 'synthetic-line-source');
});

test('synthetic repair audit is queryable by LINE Admin and unavailable in View As', async () => {
  const database = seedRepairDatabase();
  const preview = await call(
    database,
    `/api/admin/users/${SOURCE_USER}/invalid-employee-repair-preview?targetUserId=${TARGET_USER}`
  );
  await call(database, `/api/admin/users/${SOURCE_USER}/invalid-employee-repair`, {
    method: 'POST',
    body: repairPayload(preview)
  });
  const audit = await call(database, '/api/admin/invalid-employee-repairs');
  assert.equal(audit.response.status, 200);
  assert.equal(audit.body.repairs.length, 1);
  assert.equal(audit.body.repairs[0].sourceUserId, SOURCE_USER);
  assert.equal(audit.body.repairs[0].targetUserId, TARGET_USER);
  assert.match(audit.body.repairs[0].requestId, /^request_/);

  const viewAsAudit = await call(database, `/api/admin/invalid-employee-repairs?viewAsUserId=${TARGET_USER}`);
  assert.equal(viewAsAudit.response.status, 403);
});
