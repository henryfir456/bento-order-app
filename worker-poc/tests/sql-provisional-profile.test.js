import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { buildLegacyReconciliationPlan } from '../scripts/lib/legacy-reconciliation.mjs';
import { sqlHistoricalProvisionalUser } from '../scripts/lib/provisional-profile-policy.mjs';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { callOrderRoute, ORDER_DATE, seedOrderDatabase } from './helpers/order-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-09-07T01:00:00.000Z');
const EMPLOYEE_ID = '001234';
const USER_ID = 'sql-provisional-001234';

const call = async (database, path, options = {}, runtime = {}) => {
  const response = await handleFormalRequest(
    request(path, options),
    { DB: database },
    {
      now: runtime.now || NOW,
      fetchImpl: runtime.fetchImpl || profileFetch()
    }
  );
  return { response, body: await response.json() };
};

const seedIncompleteUser = (database, overrides = {}) => {
  seedUser(database, {
    userId: USER_ID,
    employeeId: EMPLOYEE_ID,
    lineUserId: null,
    displayName: 'Legacy employee 001234',
    pickupFloor: null,
    balance: 0,
    role: 'User',
    verificationStatus: 'UNVERIFIED',
    ...overrides
  });
};

const historicalFacts = (employeeId = EMPLOYEE_ID) => ({
  historicalOrderFacts: [{
    kind: 'HISTORICAL_ORDER_FACT',
    normalizedEmployeeId: employeeId,
    sourceTable: 'bento_order_count',
    sourceId: 1,
    sourceRow: 10,
    originalEventType: 'order',
    rawEvidence: { username: employeeId }
  }],
  historicalLikeFacts: [],
  historicalWalletFacts: [],
  historicalMenuFacts: [],
  historicalTypeFacts: [],
  sourceHash: 'sql-history-hash'
});

const currentSnapshot = {
  sourceHash: 'excel-current-hash',
  normalized: {
    sourceHash: 'excel-current-hash',
    importerVersion: 'test',
    shapeIssues: [],
    Users: [],
    Orders: [],
    Likes: [],
    TopupHistory: [],
    Settings: [],
    Menu: [],
    Announcements: []
  },
  workbook: { sheets: {}, shapeIssues: [] }
};

const emptyD1Snapshot = { snapshotVersion: 1, users: [], existingKeys: {} };

test('SQL provisional canonical identity may exist without inventing a pickup floor', () => {
  const database = new SqliteD1();
  seedIncompleteUser(database);

  const row = database.get(`
    SELECT user_id, employee_id, line_user_id, display_name, pickup_floor,
           balance, role, active, verification_status
    FROM users WHERE user_id = ?
  `, USER_ID);
  assert.deepEqual({ ...row }, {
    user_id: USER_ID,
    employee_id: EMPLOYEE_ID,
    line_user_id: null,
    display_name: 'Legacy employee 001234',
    pickup_floor: null,
    balance: 0,
    role: 'User',
    active: 1,
    verification_status: 'UNVERIFIED'
  });
  assert.throws(() => database.run(`
    UPDATE users SET pickup_floor = '3樓' WHERE user_id = ?
  `, USER_ID), /CHECK|constraint/i);
});

test('employee login and authenticated LINE bind converge on the same incomplete canonical user', async () => {
  const database = new SqliteD1();
  seedIncompleteUser(database);
  const lineProfile = profileFetch({
    token: 'sql-line-token',
    lineUserId: 'line-001234',
    displayName: 'Authenticated employee'
  });

  const login = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.userId, USER_ID);
  assert.equal(login.body.user.profileComplete, false);
  assert.equal(login.body.user.floor, null);

  const binding = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'sql-line-token',
    headers: { 'X-Employee-Guest-Session': login.body.token },
    body: { displayName: 'Must not overwrite', pickupFloor: '9樓' }
  }, { fetchImpl: lineProfile });
  assert.equal(binding.response.status, 200);
  assert.equal(binding.body.user.userId, USER_ID);
  assert.equal(binding.body.user.lineUserId, 'line-001234');
  assert.equal(binding.body.user.profileComplete, false);
  assert.equal(binding.body.user.floor, null);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 1);

  const replay = await call(database, '/api/auth/line-bind', {
    method: 'POST',
    token: 'sql-line-token',
    headers: { 'X-Employee-Guest-Session': login.body.token }
  }, { fetchImpl: lineProfile });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.status, 'ALREADY_BOUND');
  assert.equal(replay.body.user.userId, USER_ID);
  assert.equal(database.get(
    'SELECT pickup_floor FROM users WHERE user_id = ?', USER_ID
  ).pickup_floor, null);
});

test('profile completion accepts 1樓 and 9樓, rejects invalid floors, and reports completeness separately', async () => {
  for (const floor of ['1樓', '9樓']) {
    const database = new SqliteD1();
    seedIncompleteUser(database, { userId: `${USER_ID}-${floor}` });
    const login = await call(database, '/api/auth/employee-guest', {
      method: 'POST',
      body: { employeeId: EMPLOYEE_ID }
    });
    const completed = await call(database, '/api/me/pickup-floor', {
      method: 'PATCH',
      token: login.body.token,
      body: { pickupFloor: floor }
    });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.user.floor, floor);
    assert.equal(completed.body.user.profileComplete, true);
  }

  const database = new SqliteD1();
  seedIncompleteUser(database);
  const login = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });
  const rejected = await call(database, '/api/me/pickup-floor', {
    method: 'PATCH',
    token: login.body.token,
    body: { pickupFloor: '3樓' }
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.error, 'INVALID_PICKUP_FLOOR');
  assert.equal(database.get(
    'SELECT pickup_floor FROM users WHERE user_id = ?', USER_ID
  ).pickup_floor, null);
});

test('incomplete canonical users cannot create orders until profile completion', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  database.run(`
    UPDATE users
    SET line_user_id = NULL, pickup_floor = NULL, verification_status = 'UNVERIFIED'
    WHERE user_id = 'user-1'
  `);
  const login = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: 'employee-user-1' }
  });
  const blocked = await callOrderRoute(database, '/api/orders', {
    method: 'POST',
    token: login.body.token,
    body: {
      targetDate: ORDER_DATE,
      pickupFloor: '1樓',
      items: [{ menu_item_id: 'menu-a', quantity: 1 }],
      note: ''
    },
    headers: { 'Idempotency-Key': 'incomplete-profile-order' }
  });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.body.error, 'PROFILE_COMPLETION_REQUIRED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 0);

  const completed = await call(database, '/api/me/pickup-floor', {
    method: 'PATCH',
    token: login.body.token,
    body: { pickupFloor: '1樓' }
  });
  assert.equal(completed.response.status, 200);
  const order = await callOrderRoute(database, '/api/orders', {
    method: 'POST',
    token: login.body.token,
    body: {
      targetDate: ORDER_DATE,
      pickupFloor: '1樓',
      items: [{ menu_item_id: 'menu-a', quantity: 1 }],
      note: ''
    },
    headers: { 'Idempotency-Key': 'complete-profile-order' }
  });
  assert.equal(order.response.status, 200);
});

test('provisional policy is non-executable and no longer blocked by a fabricated floor', () => {
  const candidate = sqlHistoricalProvisionalUser(EMPLOYEE_ID);
  assert.equal(candidate.execute, false);
  assert.equal(candidate.user.pickup_floor, null);
  assert.equal(candidate.profileComplete, false);
  assert.deepEqual(candidate.blockedByRequiredProfileFields, []);

  const result = buildLegacyReconciliationPlan({
    currentSnapshot,
    historicalFacts: historicalFacts(),
    d1Snapshot: emptyD1Snapshot,
    sourceHashes: { excel: 'excel-current-hash', sql: 'sql-history-hash' },
    importerVersion: 'test'
  });
  assert.equal(result.summary.createCanonicalIdentityCount, 1);
  assert.equal(result.summary.createCanonicalReadyCount, 1);
  assert.equal(result.summary.createCanonicalBlockedByRequiredProfileFields, 0);
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_count');
  assert.equal(row.mutationPreview.canonicalUserCandidate.profileComplete, false);
  assert.equal(row.mutationPreview.canonicalUserCandidate.execute, false);
  assert.equal(result.rowsWritten, 0);
  assert.equal(result.changedDb, false);
});
