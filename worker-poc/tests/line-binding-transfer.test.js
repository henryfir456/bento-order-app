import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from './helpers/formal-fixtures.js';
import { createGuestSession } from '../src/auth/guestSession.js';
import { resolveCanonicalIdentity } from '../src/auth/identity.js';
import { toggleLike } from '../src/routes/calendar.js';
import { updatePickupFloor } from '../src/domain/users.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedLedgerRow, seedUser } from './helpers/formal-fixtures.js';
import {
  callOrderRoute,
  ORDER_DATE,
  ORDER_NOW,
  seedOrderDatabase,
  userProfile
} from './helpers/order-fixtures.js';

const NOW = new Date('2026-10-16T00:00:00.000Z');

const call = async (database, path, options = {}, profile = {}) => {
  const response = await handleFormalRequest(
    request(path, { token: 'admin-token', ...options }),
    { DB: database },
    {
      fetchImpl: profileFetch({
        token: 'admin-token',
        lineUserId: 'admin-line',
        displayName: 'Admin',
        ...profile
      }),
      now: NOW
    }
  );
  return {
    response,
    body: response.status === 204 ? null : await response.json()
  };
};

const seedTransferDatabase = () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'admin-user',
    employeeId: '900001',
    lineUserId: 'admin-line',
    displayName: 'Admin',
    role: 'Admin'
  });
  seedUser(database, {
    userId: '139790',
    employeeId: '139790',
    lineUserId: 'line-person-139790',
    displayName: '錯誤帳號',
    pickupFloor: '1樓',
    role: 'User',
    balance: 0
  });
  seedUser(database, {
    userId: '139700',
    employeeId: '139700',
    lineUserId: null,
    displayName: '正確帳號',
    pickupFloor: '9樓',
    role: 'User',
    balance: 300
  });
  database.run(`
    INSERT INTO orders (
      order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, order_date, vendor, pickup_floor, note,
      total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES ('target-order', '139700', '139700', NULL, '正確帳號',
      '2026-10-15', 'Vendor A', '9樓', '', 100, 'ACTIVE', '139700', 'line')
  `);
  seedLedgerRow(database, {
    transactionId: 'target-ledger',
    userId: '139700',
    amount: 300,
    balanceAfter: 300,
    type: 'TOPUP'
  });
  return database;
};

test('139790 to 139700 moves only LINE ownership and preserves target history and account data', async () => {
  const database = seedTransferDatabase();
  const beforeOrder = database.get("SELECT * FROM orders WHERE order_id = 'target-order'");
  const beforeLedger = database.get("SELECT * FROM balance_ledger WHERE transaction_id = 'target-ledger'");
  const beforeTarget = database.get("SELECT * FROM users WHERE user_id = '139700'");
  const preview = await call(
    database,
    '/api/admin/users/139790/line-binding-transfer-preview?employeeId=139700'
  );

  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.readyToTransfer, true);
  assert.equal(preview.body.source.employeeId, '139790');
  assert.equal(preview.body.target.employeeId, '139700');
  assert.equal(preview.body.source.lineBinding.masked, '********9790');
  assert.equal(JSON.stringify(preview.body).includes('line-person-139790'), false);

  const transfer = await call(
    database,
    '/api/admin/users/139790/line-binding-transfer',
    {
      method: 'POST',
      body: {
        employeeId: '139700',
        previewFingerprint: preview.body.previewFingerprint
      }
    }
  );

  assert.equal(transfer.response.status, 200);
  assert.equal(transfer.body.success, true);
  assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = '139790'").line_user_id, null);
  assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = '139700'").line_user_id, 'line-person-139790');
  assert.deepEqual(database.get("SELECT * FROM orders WHERE order_id = 'target-order'"), beforeOrder);
  assert.deepEqual(database.get("SELECT * FROM balance_ledger WHERE transaction_id = 'target-ledger'"), beforeLedger);
  const afterTarget = database.get("SELECT * FROM users WHERE user_id = '139700'");
  for (const field of ['employee_id', 'display_name', 'pickup_floor', 'balance', 'role', 'active']) {
    assert.equal(afterTarget[field], beforeTarget[field], `${field} must stay unchanged`);
  }
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'LINE_BINDING_TRANSFER'").count, 1);
  const audit = database.get(`
    SELECT actor_user_id, actor_auth_mode, actor_line_user_id_snapshot,
      target_user_id, target_line_user_id_snapshot, action, metadata_json
    FROM admin_audit_log WHERE action = 'LINE_BINDING_TRANSFER'
  `);
  assert.equal(audit.actor_user_id, 'admin-user');
  assert.equal(audit.actor_auth_mode, 'line');
  assert.equal(audit.target_user_id, '139700');
  assert.equal(audit.actor_line_user_id_snapshot, null);
  assert.equal(audit.target_line_user_id_snapshot, null);
  assert.equal(audit.action, 'LINE_BINDING_TRANSFER');
  assert.ok(audit.metadata_json.includes(transfer.body.requestId));
  assert.ok(audit.metadata_json.includes('139790'));
  assert.ok(audit.metadata_json.includes('139700'));
  assert.equal(audit.metadata_json.includes('line-person-139790'), false);
});

const previewTransfer = (database, options = {}, profile = {}) => call(
  database,
  '/api/admin/users/139790/line-binding-transfer-preview?employeeId=139700',
  options,
  profile
);

const commitTransfer = (database, preview, options = {}, profile = {}) => call(
  database,
  '/api/admin/users/139790/line-binding-transfer',
  {
    method: 'POST',
    ...options,
    body: {
      employeeId: '139700',
      previewFingerprint: preview?.body?.previewFingerprint,
      ...(options.body || {})
    }
  },
  profile
);

test('preview and commit reject normal Users, ProxyAdmin, and View As contexts', async () => {
  const database = seedTransferDatabase();
  seedUser(database, {
    userId: 'proxy-user', employeeId: '900002', lineUserId: 'proxy-line', role: 'ProxyAdmin'
  });

  const normalUser = await previewTransfer(database, { token: 'user-token' }, {
    token: 'user-token', lineUserId: 'line-person-139790'
  });
  assert.equal(normalUser.response.status, 403);
  const proxyAdmin = await previewTransfer(database, { token: 'proxy-token' }, {
    token: 'proxy-token', lineUserId: 'proxy-line'
  });
  assert.equal(proxyAdmin.response.status, 403);
  const proxyCommitPreview = await previewTransfer(database);
  const proxyCommit = await commitTransfer(database, proxyCommitPreview, { token: 'proxy-token' }, {
    token: 'proxy-token', lineUserId: 'proxy-line'
  });
  assert.equal(proxyCommit.response.status, 403);

  const viewAs = await call(
    database,
    '/api/admin/users/139790/line-binding-transfer-preview?employeeId=139700&viewAs=139700'
  );
  assert.equal(viewAs.response.status, 403);
  assert.equal(viewAs.body.error, 'VIEW_AS_FORBIDDEN');
  const viewAsCommit = await call(database, '/api/admin/users/139790/line-binding-transfer?viewAs=139700', {
    method: 'POST',
    body: { employeeId: '139700', previewFingerprint: 'x' }
  });
  assert.equal(viewAsCommit.response.status, 403);
  assert.equal(viewAsCommit.body.error, 'VIEW_AS_FORBIDDEN');

  const userCommit = await call(database, '/api/admin/users/139790/line-binding-transfer', {
    method: 'POST',
    token: 'user-token',
    body: { employeeId: '139700', previewFingerprint: 'x' }
  }, { token: 'user-token', lineUserId: 'line-person-139790' });
  assert.equal(userCommit.response.status, 403);
  assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = '139790'").line_user_id, 'line-person-139790');
});

test('preview and commit reject source orders, balance transactions, and non-zero balance', async (t) => {
  const scenarios = [
    {
      name: 'orders',
      code: 'SOURCE_HAS_ORDERS',
      setup(database) {
        database.run(`
          INSERT INTO orders (
            order_id, user_id, display_name_snapshot, order_date, vendor,
            pickup_floor, total_amount, created_by_user_id
          ) VALUES ('source-order', '139790', '錯誤帳號', '2026-10-15',
            'Vendor A', '1樓', 0, '139790')
        `);
      }
    },
    {
      name: 'ledger transactions',
      code: 'SOURCE_HAS_TRANSACTIONS',
      setup(database) {
        seedLedgerRow(database, {
          transactionId: 'source-ledger', userId: '139790', amount: 1, balanceAfter: 0
        });
      }
    },
    {
      name: 'non-zero balance',
      code: 'SOURCE_BALANCE_NON_ZERO',
      setup(database) {
        database.run("UPDATE users SET balance = 10 WHERE user_id = '139790'");
      }
    }
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const database = seedTransferDatabase();
      scenario.setup(database);
      const preview = await previewTransfer(database);
      assert.equal(preview.response.status, 200);
      assert.equal(preview.body.readyToTransfer, false);
      assert.ok(preview.body.conflicts.includes(scenario.code));
      const result = await commitTransfer(database, preview);
      assert.equal(result.response.status, 409);
      assert.equal(result.body.error, scenario.code);
      assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = '139790'").line_user_id, 'line-person-139790');
      assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = '139700'").line_user_id, null);
    });
  }
});

test('preview rejects other source-owned data that cannot move with LINE binding', async () => {
  for (const scenario of [
    {
      code: 'SOURCE_HAS_LIKES',
      prepare(database) {
        database.run("INSERT INTO likes (order_date, user_id) VALUES ('2026-10-16', '139790')");
      }
    },
    {
      code: 'SOURCE_HAS_IDEMPOTENCY_RECORDS',
      prepare(database) {
        database.run(`
          INSERT INTO idempotency_keys (
            actor_user_id, operation, idempotency_key, request_hash, claim_token, status
          ) VALUES ('139790', 'profile', 'old-key', 'hash', 'claim', 'COMPLETED')
        `);
      }
    },
    {
      code: 'SOURCE_HAS_OPENING_BALANCE',
      prepare(database) {
        database.run(`
          INSERT INTO import_batches (batch_id, source_hash, importer_version)
          VALUES ('old-batch', 'hash', 'test')
        `);
        database.run(`
          INSERT INTO opening_balance_snapshots (
            user_id, snapshot_balance, source_batch_id, policy_status
          ) VALUES ('139790', 0, 'old-batch', 'NOT_REQUIRED')
        `);
      }
    }
  ]) {
    const database = seedTransferDatabase();
    scenario.prepare(database);
    const preview = await previewTransfer(database);
    assert.equal(preview.response.status, 200);
    assert.ok(preview.body.conflicts.includes(scenario.code), `${scenario.code}: ${JSON.stringify(preview.body.conflicts)}`);
  }
});

test('inactive, unbound, missing, and already-bound accounts are rejected with explicit reasons', async () => {
  const inactiveSource = seedTransferDatabase();
  inactiveSource.run("UPDATE users SET active = 0 WHERE user_id = '139790'");
  assert.ok((await previewTransfer(inactiveSource)).body.conflicts.includes('SOURCE_INACTIVE'));

  const unboundSource = seedTransferDatabase();
  unboundSource.run("UPDATE users SET line_user_id = NULL WHERE user_id = '139790'");
  assert.ok((await previewTransfer(unboundSource)).body.conflicts.includes('SOURCE_LINE_NOT_BOUND'));

  const boundTarget = seedTransferDatabase();
  boundTarget.run("UPDATE users SET line_user_id = 'another-line' WHERE user_id = '139700'");
  const boundPreview = await previewTransfer(boundTarget);
  assert.ok(boundPreview.body.conflicts.includes('TARGET_LINE_ALREADY_BOUND'));
  const rejected = await commitTransfer(boundTarget, boundPreview);
  assert.equal(rejected.response.status, 409);
  assert.equal(rejected.body.error, 'TARGET_LINE_ALREADY_BOUND');

  const inactiveTarget = seedTransferDatabase();
  inactiveTarget.run("UPDATE users SET active = 0 WHERE user_id = '139700'");
  assert.ok((await previewTransfer(inactiveTarget)).body.conflicts.includes('TARGET_INACTIVE'));

  const missingTarget = await call(
    seedTransferDatabase(),
    '/api/admin/users/139790/line-binding-transfer-preview?employeeId=missing'
  );
  assert.equal(missingTarget.response.status, 404);
  assert.equal(missingTarget.body.error, 'TRANSFER_TARGET_NOT_FOUND');
});

test('a stale preview cannot move a changed source binding', async () => {
  const database = seedTransferDatabase();
  const preview = await previewTransfer(database);
  database.run("UPDATE users SET updated_at = '2026-10-16T01:00:00.000Z' WHERE user_id = '139790'");
  const result = await commitTransfer(database, preview);
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'LINE_BINDING_TRANSFER_STALE');
  assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = '139790'").line_user_id, 'line-person-139790');
});

test('case-insensitive employee lookup commits against the stored target ID safely', async () => {
  const database = seedTransferDatabase();
  database.run("UPDATE users SET employee_id = 'e139700' WHERE user_id = '139700'");
  const preview = await call(
    database,
    '/api/admin/users/139790/line-binding-transfer-preview?employeeId=E139700'
  );
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.target.employeeId, 'e139700');
  const transfer = await call(database, '/api/admin/users/139790/line-binding-transfer', {
    method: 'POST',
    body: { employeeId: 'E139700', previewFingerprint: preview.body.previewFingerprint }
  });
  assert.equal(transfer.response.status, 200);
  assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = '139700'").line_user_id, 'line-person-139790');
});

test('duplicate and concurrent submissions transfer one unique LINE binding exactly once', async () => {
  const database = seedTransferDatabase();
  const preview = await previewTransfer(database);
  const [first, concurrent] = await Promise.all([
    commitTransfer(database, preview),
    commitTransfer(database, preview)
  ]);
  assert.deepEqual([first.response.status, concurrent.response.status].sort(), [200, 409]);
  const replay = await commitTransfer(database, preview);
  assert.equal(replay.response.status, 409);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM users WHERE line_user_id = 'line-person-139790'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'LINE_BINDING_TRANSFER'").count, 1);
});

test('a LINE order already in flight cannot commit to the source after the binding transfer', async () => {
  const database = seedOrderDatabase({ balance: 0 });
  database.run("UPDATE users SET line_user_id = NULL WHERE user_id = 'user-2'");
  const originalBatch = database.batch.bind(database);
  let releaseOrderBatch;
  let signalOrderBatchStarted;
  const orderBatchStarted = new Promise((resolve) => { signalOrderBatchStarted = resolve; });
  const orderBatchGate = new Promise((resolve) => { releaseOrderBatch = resolve; });
  let pauseNextBatch = true;
  database.batch = async (statements) => {
    if (pauseNextBatch) {
      pauseNextBatch = false;
      signalOrderBatchStarted();
      await orderBatchGate;
    }
    return originalBatch(statements);
  };

  const orderPromise = callOrderRoute(database, '/api/orders', {
    method: 'POST',
    body: {
      targetDate: ORDER_DATE,
      pickupFloor: '1樓',
      items: [{ menu_item_id: 'menu-a', quantity: 1 }]
    },
    headers: { 'Idempotency-Key': 'transfer-race-order' }
  }, userProfile());

  try {
    await orderBatchStarted;
    const previewResponse = await handleFormalRequest(
      request('/api/admin/users/user-1/line-binding-transfer-preview?employeeId=employee-user-2', {
        token: 'admin-token'
      }),
      { DB: database },
      {
        fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin' }),
        now: ORDER_NOW
      }
    );
    const preview = await previewResponse.json();
    assert.equal(previewResponse.status, 200);
    assert.equal(preview.readyToTransfer, true);

    const transferResponse = await handleFormalRequest(
      request('/api/admin/users/user-1/line-binding-transfer', {
        method: 'POST',
        token: 'admin-token',
        body: { employeeId: 'employee-user-2', previewFingerprint: preview.previewFingerprint }
      }),
      { DB: database },
      {
        fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin' }),
        now: ORDER_NOW
      }
    );
    assert.equal(transferResponse.status, 200);
    assert.equal((await transferResponse.json()).success, true);
  } finally {
    releaseOrderBatch();
    database.batch = originalBatch;
  }

  const staleOrder = await orderPromise;
  assert.equal(staleOrder.response.status, 409);
  assert.equal(staleOrder.body.error, 'IDENTITY_SESSION_STALE');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE user_id = 'user-1'").count, 0);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE user_id = 'user-1'").count, 0);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM idempotency_keys WHERE actor_user_id = 'user-1'").count, 0);
  assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = 'user-1'").line_user_id, null);
  assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = 'user-2'").line_user_id, 'user-1');
});

test('a transaction failure rolls back both LINE updates and the audit insert', async () => {
  const database = seedTransferDatabase();
  database.run(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, employee_id, status, expires_at
    ) VALUES ('rollback-source-session', 'rollback-token-hash', '139790', '139790',
      'VERIFIED', '2026-10-17T00:00:00.000Z')
  `);
  const preview = await previewTransfer(database);
  database.exec(`
    CREATE TRIGGER fail_line_transfer_session_revoke
    BEFORE UPDATE ON employee_guest_sessions
    WHEN OLD.user_id = '139790'
    BEGIN SELECT RAISE(ABORT, 'forced transfer session revoke failure'); END;
  `);
  const result = await commitTransfer(database, preview);
  assert.equal(result.response.status, 500);
  assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = '139790'").line_user_id, 'line-person-139790');
  assert.equal(database.get("SELECT line_user_id FROM users WHERE user_id = '139700'").line_user_id, null);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'LINE_BINDING_TRANSFER'").count, 0);
  assert.equal(database.get("SELECT revoked_at FROM employee_guest_sessions WHERE session_id = 'rollback-source-session'").revoked_at, null);
});

test('after transfer an old LINE bearer resolves to the target and source employee sessions are revoked', async () => {
  const database = seedTransferDatabase();
  const staleLineIdentity = await resolveCanonicalIdentity(
    request('/api/me', { token: 'line-token' }),
    { DB: database },
    profileFetch({ token: 'line-token', lineUserId: 'line-person-139790', displayName: '錯誤帳號' }),
    { now: NOW }
  );
  const provisionalEmployeeSession = await createGuestSession(database, {
    userId: null,
    employeeId: '139790',
    status: 'UNVERIFIED_EMPLOYEE',
    clock: NOW
  });
  const sourceProvisionalSession = await createGuestSession(database, {
    userId: '139790',
    employeeId: '139790',
    status: 'UNVERIFIED_EMPLOYEE',
    clock: NOW
  });
  database.run(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, employee_id, status, expires_at
    ) VALUES ('old-source-session', 'test-token-hash', '139790', '139790',
      'VERIFIED', '2026-10-17T00:00:00.000Z')
  `);
  const oldLineSession = await call(database, '/api/me', { token: 'line-token' }, {
    token: 'line-token', lineUserId: 'line-person-139790'
  });
  assert.equal(oldLineSession.body.user.userId, '139790');
  const oldProvisionalSession = await call(
    database,
    '/api/me',
    { token: provisionalEmployeeSession.token }
  );
  assert.equal(oldProvisionalSession.response.status, 200);
  assert.equal(oldProvisionalSession.body.user.userId, '139790');
  const oldSourceProvisionalSession = await call(
    database,
    '/api/me',
    { token: sourceProvisionalSession.token }
  );
  assert.equal(oldSourceProvisionalSession.response.status, 200);
  assert.equal(oldSourceProvisionalSession.body.user.userId, '139790');

  const preview = await previewTransfer(database);
  assert.equal(preview.body.sourceSessionsToRevoke, 3);
  await commitTransfer(database, preview);

  const sourceSession = database.get("SELECT revoked_at, revoked_reason FROM employee_guest_sessions WHERE session_id = 'old-source-session'");
  assert.ok(sourceSession.revoked_at);
  assert.equal(sourceSession.revoked_reason, 'admin_revoke');
  const provisionalSessionRow = database.get(`
    SELECT revoked_at, revoked_reason FROM employee_guest_sessions
    WHERE token_hash = (
      SELECT token_hash FROM employee_guest_sessions WHERE employee_id = '139790' AND user_id IS NULL
    )
  `);
  assert.ok(provisionalSessionRow.revoked_at);
  assert.equal(provisionalSessionRow.revoked_reason, 'admin_revoke');
  const invalidatedSourceProvisionalSession = await call(
    database,
    '/api/me',
    { token: sourceProvisionalSession.token }
  );
  assert.equal(invalidatedSourceProvisionalSession.response.status, 401);
  assert.equal(invalidatedSourceProvisionalSession.body.error, 'GUEST_SESSION_INVALID');
  const invalidatedEmployeeSession = await call(
    database,
    '/api/me',
    { token: provisionalEmployeeSession.token }
  );
  assert.equal(invalidatedEmployeeSession.response.status, 401);
  assert.equal(invalidatedEmployeeSession.body.error, 'GUEST_SESSION_INVALID');
  const refreshedLineSession = await call(database, '/api/me', { token: 'line-token' }, {
    token: 'line-token', lineUserId: 'line-person-139790'
  });
  assert.equal(refreshedLineSession.body.user.userId, '139700');
  const newlyLoggedIn = await call(database, '/api/me', { token: 'new-line-token' }, {
    token: 'new-line-token', lineUserId: 'line-person-139790'
  });
  assert.equal(newlyLoggedIn.body.user.userId, '139700');
  await assert.rejects(
    toggleLike(database, staleLineIdentity, '2026-10-16', NOW),
    (error) => error?.code === 'IDENTITY_SESSION_STALE'
  );
  await assert.rejects(
    updatePickupFloor(database, staleLineIdentity, '9樓', NOW),
    (error) => error?.code === 'IDENTITY_SESSION_STALE'
  );
  const unchangedSourceProfile = database.get(
    "SELECT display_name, pickup_floor FROM users WHERE user_id = '139790'"
  );
  assert.equal(unchangedSourceProfile.display_name, '錯誤帳號');
  assert.equal(unchangedSourceProfile.pickup_floor, '1樓');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM likes WHERE user_id = '139790'").count, 0);
});
