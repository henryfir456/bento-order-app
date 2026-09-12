import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { employeeGuestLogin } from '../src/domain/guestAccess.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const NOW = new Date('2026-09-12T02:00:00.000Z');
const NOW_ISO = NOW.toISOString();
const FUTURE = '2099-01-01T00:00:00.000Z';
const EMPLOYEE_ID = '139653';
const LINE_TOKEN = 'line-token';
const LINE_USER_ID = 'line-survivor';
const SURVIVOR_ID = 'line-survivor-user';
const PROVISIONAL_ID = 'provisional-139653';

const survivorProfile = {
  token: LINE_TOKEN,
  lineUserId: LINE_USER_ID,
  displayName: '宗儒'
};

const call = async (database, path, {
  method = 'GET',
  token = LINE_TOKEN,
  body,
  profile = survivorProfile
} = {}) => {
  const response = await handleFormalRequest(
    request(path, { method, token, body }),
    { DB: database },
    {
      fetchImpl: profileFetch(profile),
      now: NOW
    }
  );
  return { response, body: await response.json() };
};

const insertGuestSession = (
  database,
  sessionId,
  {
    userId = null,
    employeeId = EMPLOYEE_ID,
    status = 'UNVERIFIED_EMPLOYEE',
    expiresAt = FUTURE,
    revokedAt = null,
    revokedReason = null
  } = {}
) => {
  database.run(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, employee_id, status,
      created_at, expires_at, revoked_at, revoked_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, sessionId, sessionId + '-hash', userId, employeeId, status,
  NOW_ISO, expiresAt, revokedAt, revokedReason);
};

const insertRoster = (database, {
  rosterId,
  employeeId = EMPLOYEE_ID,
  active = 1,
  provenance = 'TRUSTED_IMPORT',
  sourceRef = 'test-roster'
}) => {
  database.run(`
    INSERT INTO employee_roster (
      roster_id, employee_id, active, provenance, source_ref,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, rosterId, employeeId, active, provenance, sourceRef, NOW_ISO, NOW_ISO);
};

const createClaimFixture = ({
  owner = {},
  sessions = true,
  auditReference = true,
  roster = []
} = {}) => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: SURVIVOR_ID,
    lineUserId: LINE_USER_ID,
    employeeId: null,
    displayName: survivorProfile.displayName,
    pickupFloor: '1樓',
    role: 'Admin',
    active: 1,
    verificationStatus: 'UNVERIFIED'
  });
  seedUser(database, {
    userId: PROVISIONAL_ID,
    lineUserId: null,
    employeeId: EMPLOYEE_ID,
    displayName: 'Provisional 139653',
    pickupFloor: '1樓',
    role: 'User',
    active: 1,
    verificationStatus: 'UNVERIFIED',
    ...owner
  });

  if (auditReference) {
    database.run(`
      INSERT INTO admin_audit_log (
        audit_id, actor_user_id, actor_auth_mode, target_user_id,
        action, metadata_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, 'pre-existing-audit', SURVIVOR_ID, 'line', PROVISIONAL_ID,
    'LEGACY_REFERENCE', JSON.stringify({ retained: true }), NOW_ISO);
  }

  if (sessions) {
    insertGuestSession(database, 'guest-owner-1', { userId: PROVISIONAL_ID });
    insertGuestSession(database, 'guest-owner-2', { userId: PROVISIONAL_ID });
    insertGuestSession(database, 'guest-owner-3', { userId: PROVISIONAL_ID });
    insertGuestSession(database, 'guest-owner-4', { userId: PROVISIONAL_ID });
    insertGuestSession(database, 'guest-loose-1', { userId: null });
    insertGuestSession(database, 'guest-loose-2', { userId: null });
    insertGuestSession(database, 'guest-unrelated', {
      userId: null,
      employeeId: '999999'
    });
  }

  for (const row of roster) insertRoster(database, row);
  return database;
};

const survivorRow = (database) => database.get(`
  SELECT user_id, employee_id, line_user_id, role, active, verification_status
  FROM users
  WHERE user_id = ?
`, SURVIVOR_ID);

const ownerRow = (database) => database.get(`
  SELECT user_id, employee_id, line_user_id, role, active, verification_status
  FROM users
  WHERE user_id = ?
`, PROVISIONAL_ID);

const matchingSessionCount = (database) => Number(database.get(`
  SELECT COUNT(*) AS count
  FROM employee_guest_sessions
  WHERE revoked_at IS NOT NULL
    AND (
      UPPER(trim(employee_id)) = ?
      OR user_id = ?
    )
`, EMPLOYEE_ID, PROVISIONAL_ID).count);

const mergeAuditRows = (database) => database.database.prepare(`
  SELECT actor_user_id, actor_auth_mode, target_user_id, action,
         metadata_json, actor_employee_id_snapshot,
         target_employee_id_snapshot
  FROM admin_audit_log
  WHERE action = 'PROVISIONAL_EMPLOYEE_CLAIMED'
`).all();

const assertNoTransferSideEffects = (database) => {
  assert.equal(ownerRow(database).employee_id, EMPLOYEE_ID);
  assert.equal(ownerRow(database).active, 1);
  assert.equal(survivorRow(database).employee_id, null);
  assert.equal(survivorRow(database).active, 1);
  assert.equal(matchingSessionCount(database), 0);
  assert.equal(mergeAuditRows(database).length, 0);
};

const addBusinessDependency = (database, dependency) => {
  if (dependency === 'orders') {
    database.run(`
      INSERT INTO orders (
        order_id, user_id, display_name_snapshot, order_date, vendor,
        pickup_floor, total_amount, status, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, 'dependent-order-' + dependency, PROVISIONAL_ID, 'Provisional 139653',
    '2026-09-12', 'Vendor A', '1樓', 10, 'ACTIVE',
    PROVISIONAL_ID, NOW_ISO, NOW_ISO);
    return;
  }
  if (dependency === 'balance_ledger') {
    database.run(`
      INSERT INTO balance_ledger (
        transaction_id, user_id, amount, balance_after, type,
        auth_mode, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, 'dependent-ledger', PROVISIONAL_ID, 1, 1, 'ADJUSTMENT', 'legacy_import', NOW_ISO);
    return;
  }
  if (dependency === 'opening_balance_snapshots') {
    database.run(`
      INSERT INTO import_batches (
        batch_id, source_hash, importer_version, status
      ) VALUES (?, ?, ?, ?)
    `, 'dependency-batch', 'dependency-hash', 'test', 'REVIEWED');
    database.run(`
      INSERT INTO opening_balance_snapshots (
        user_id, snapshot_balance, source_batch_id, policy_status
      ) VALUES (?, ?, ?, ?)
    `, PROVISIONAL_ID, 1, 'dependency-batch', 'REQUIRED');
    return;
  }
  if (dependency === 'likes') {
    database.run(`
      INSERT INTO likes (order_date, user_id, created_at)
      VALUES (?, ?, ?)
    `, '2026-09-12', PROVISIONAL_ID, NOW_ISO);
    return;
  }
  database.run(`
    INSERT INTO idempotency_keys (
      actor_user_id, operation, idempotency_key, request_hash,
      claim_token, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, PROVISIONAL_ID, 'DEPENDENCY_TEST', 'dependency-key',
  'dependency-request', 'dependency-claim', 'COMPLETED', NOW_ISO);
};

test('claimable 139653 provisional owner transfers to LINE survivor and preserves historical status', async () => {
  const database = createClaimFixture();

  const bound = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });

  assert.equal(bound.response.status, 200);
  assert.equal(bound.body.success, true);
  assert.equal(bound.body.status, 'BOUND');
  assert.equal(bound.body.authMode, 'line');
  assert.equal(bound.body.verificationStatus, 'UNVERIFIED');
  assert.equal(bound.body.user.userId, SURVIVOR_ID);
  assert.equal(bound.body.user.employeeId, EMPLOYEE_ID);
  assert.equal(bound.body.user.active, true);
  assert.equal(bound.body.user.role, 'Admin');
  assert.equal(bound.body.user.identityState, 'VERIFIED');

  assert.deepEqual({ ...survivorRow(database) }, {
    user_id: SURVIVOR_ID,
    employee_id: EMPLOYEE_ID,
    line_user_id: LINE_USER_ID,
    role: 'Admin',
    active: 1,
    verification_status: 'UNVERIFIED'
  });
  assert.deepEqual({ ...ownerRow(database) }, {
    user_id: PROVISIONAL_ID,
    employee_id: null,
    line_user_id: null,
    role: 'User',
    active: 0,
    verification_status: 'UNVERIFIED'
  });
  assert.equal(matchingSessionCount(database), 6);
  assert.equal(database.get(
    `SELECT revoked_at FROM employee_guest_sessions WHERE session_id = 'guest-unrelated'`
  ).revoked_at, null);

  const audits = mergeAuditRows(database);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actor_user_id, SURVIVOR_ID);
  assert.equal(audits[0].actor_auth_mode, 'line');
  assert.equal(audits[0].target_user_id, PROVISIONAL_ID);
  assert.equal(audits[0].actor_employee_id_snapshot, null);
  assert.equal(audits[0].target_employee_id_snapshot, null);
  const metadata = JSON.parse(audits[0].metadata_json);
  assert.equal(metadata.employeeIdDigest.length, 64);
  assert.match(metadata.employeeIdDigest, /^[0-9a-f]{64}$/);
  assert.equal(metadata.survivorVerificationStatus, 'UNVERIFIED');
  assert.equal(metadata.outcome, 'CLAIMED');
  assert.equal(metadata.retiredProvisionalUserId, PROVISIONAL_ID);
  assert.doesNotMatch(audits[0].metadata_json, /guest-owner-1-hash|eg_[A-Za-z0-9]/);

  const me = await call(database, '/api/me');
  assert.equal(me.response.status, 200);
  assert.equal(me.body.authMode, 'line');
  assert.equal(me.body.status, 'VERIFIED');
  assert.equal(me.body.identityState, 'VERIFIED');
  assert.equal(me.body.verificationStatus, 'UNVERIFIED');
  assert.equal(me.body.employeeId, EMPLOYEE_ID);
  assert.equal(me.body.user.authSource, 'LINE');
  assert.equal(me.body.user.identityState, 'VERIFIED');
  assert.equal(me.body.user.employeeId, EMPLOYEE_ID);
  assert.equal(me.body.user.role, 'Admin');
  assert.ok(me.body.capabilities.includes('ADMIN_ROLE'));

  const roleMutation = await call(database, '/api/admin/users/' + SURVIVOR_ID + '/role', {
    method: 'PUT',
    body: { role: 'Admin' }
  });
  assert.equal(roleMutation.response.status, 200);
  assert.equal(survivorRow(database).role, 'Admin');
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ROLE_UPDATED'"
  ).count, 1);
});

test('employee roster is ignored by claim and survivor verification status is preserved', async () => {
  const database = createClaimFixture({
    roster: [{
      rosterId: 'roster-trusted',
      provenance: 'TRUSTED_IMPORT'
    }]
  });

  const bound = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });

  assert.equal(bound.response.status, 200);
  assert.equal(bound.body.verificationStatus, 'UNVERIFIED');
  assert.equal(bound.body.user.identityState, 'VERIFIED');
  assert.equal(survivorRow(database).verification_status, 'UNVERIFIED');
  const metadata = JSON.parse(mergeAuditRows(database)[0].metadata_json);
  assert.equal(metadata.survivorVerificationStatus, 'UNVERIFIED');
  assert.equal(metadata.verificationDecision, undefined);
  assert.equal(metadata.reason, undefined);
});

test('ADMIN_APPROVED roster evidence does not affect the active claim contract', async () => {
  const database = createClaimFixture({
    roster: [{
      rosterId: 'roster-approved',
      provenance: 'ADMIN_APPROVED'
    }]
  });

  const bound = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });

  assert.equal(bound.response.status, 200);
  assert.equal(bound.body.verificationStatus, 'UNVERIFIED');
});

for (const [label, roster] of [
  ['inactive', [{ rosterId: 'roster-inactive', active: 0 }]],
  ['untrusted', [{ rosterId: 'roster-untrusted', provenance: 'TRUSTED_IMPORT', active: 0 }]],
  ['ambiguous', [
    { rosterId: 'roster-a', provenance: 'TRUSTED_IMPORT' },
    { rosterId: 'roster-b', provenance: 'ADMIN_APPROVED' }
  ]]
]) {
  test('' + label + ' or ambiguous roster match does not affect claim', async () => {
    const database = createClaimFixture({ roster });
    const bound = await call(database, '/api/auth/line-employee-bind', {
      method: 'POST',
      body: { employeeId: EMPLOYEE_ID }
    });
    assert.equal(bound.response.status, 200);
    assert.equal(bound.body.verificationStatus, 'UNVERIFIED');
    assert.equal(bound.body.user.identityState, 'VERIFIED');
    assert.equal(survivorRow(database).verification_status, 'UNVERIFIED');
  });
}

test('same LINE survivor replay is idempotent and does not duplicate merge audit', async () => {
  const database = createClaimFixture();
  const first = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });
  assert.equal(first.response.status, 200);
  const second = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });
  assert.equal(second.response.status, 200);
  assert.equal(second.body.status, 'ALREADY_BOUND');
  assert.equal(second.body.user.userId, SURVIVOR_ID);
  assert.equal(mergeAuditRows(database).length, 1);
  assert.equal(matchingSessionCount(database), 6);
});

for (const [label, owner] of [
  ['LINE-bound owner', { lineUserId: 'line-owner' }],
  ['Admin provisional owner', { role: 'Admin' }],
  ['ProxyAdmin provisional owner', { role: 'ProxyAdmin' }]
]) {
  test(label + ' remains protected by EMPLOYEE_ID_ALREADY_BOUND', async () => {
    const database = createClaimFixture({ owner });
    const result = await call(database, '/api/auth/line-employee-bind', {
      method: 'POST',
      body: { employeeId: EMPLOYEE_ID }
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error, 'EMPLOYEE_ID_ALREADY_BOUND');
    assertNoTransferSideEffects(database);
  });
}

test('owner verification status alone does not block a safe provisional claim', async () => {
  const database = createClaimFixture({
    owner: { verificationStatus: 'VERIFIED' }
  });
  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(ownerRow(database).active, 0);
  assert.equal(ownerRow(database).employee_id, null);
});

test('missing employee_guest evidence fails closed', async () => {
  const database = createClaimFixture({ sessions: false });
  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'EMPLOYEE_ID_ALREADY_BOUND');
  assertNoTransferSideEffects(database);
});

test('historical employee_guest provenance remains claimable when every session is expired', async () => {
  const database = createClaimFixture({ sessions: false });
  const expiredAt = '2026-09-11T00:00:00.000Z';
  insertGuestSession(database, 'guest-expired-owner-1', {
    userId: PROVISIONAL_ID,
    expiresAt: expiredAt
  });
  insertGuestSession(database, 'guest-expired-owner-2', {
    userId: PROVISIONAL_ID,
    expiresAt: expiredAt
  });
  insertGuestSession(database, 'guest-expired-loose-1', {
    userId: null,
    expiresAt: expiredAt
  });
  insertGuestSession(database, 'guest-expired-loose-2', {
    userId: null,
    expiresAt: expiredAt
  });

  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(result.body.user.userId, SURVIVOR_ID);
  assert.equal(result.body.user.employeeId, EMPLOYEE_ID);
  assert.equal(ownerRow(database).active, 0);
  assert.equal(ownerRow(database).employee_id, null);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM employee_guest_sessions
    WHERE UPPER(trim(employee_id)) = ?
      AND revoked_at IS NOT NULL
  `, EMPLOYEE_ID).count, 0);
  assert.equal(mergeAuditRows(database).length, 1);
});

test('claim revokes only currently valid matching employee_guest sessions', async () => {
  const database = createClaimFixture({ sessions: false });
  insertGuestSession(database, 'guest-live-owner', {
    userId: PROVISIONAL_ID
  });
  insertGuestSession(database, 'guest-live-loose', {
    userId: null
  });
  insertGuestSession(database, 'guest-expired-owner', {
    userId: PROVISIONAL_ID,
    expiresAt: '2026-09-11T00:00:00.000Z'
  });
  insertGuestSession(database, 'guest-expired-loose', {
    userId: null,
    expiresAt: '2026-09-11T00:00:00.000Z'
  });
  insertGuestSession(database, 'guest-revoked-owner', {
    userId: PROVISIONAL_ID,
    revokedAt: '2026-09-10T00:00:00.000Z',
    revokedReason: 'admin_revoke'
  });
  insertGuestSession(database, 'guest-revoked-loose', {
    userId: null,
    revokedAt: '2026-09-10T00:00:00.000Z',
    revokedReason: 'admin_revoke'
  });

  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });

  assert.equal(result.response.status, 200);
  for (const sessionId of ['guest-live-owner', 'guest-live-loose']) {
    assert.deepEqual({
      ...database.get(`
        SELECT revoked_at, revoked_reason
        FROM employee_guest_sessions
        WHERE session_id = ?
      `, sessionId)
    }, {
      revoked_at: NOW_ISO,
      revoked_reason: 'line_bound'
    });
  }
  for (const sessionId of [
    'guest-expired-owner',
    'guest-expired-loose',
    'guest-revoked-owner',
    'guest-revoked-loose'
  ]) {
    assert.deepEqual({
      ...database.get(`
        SELECT revoked_at, revoked_reason
        FROM employee_guest_sessions
        WHERE session_id = ?
      `, sessionId)
    }, {
      revoked_at: sessionId.includes('revoked')
        ? '2026-09-10T00:00:00.000Z'
        : null,
      revoked_reason: sessionId.includes('revoked') ? 'admin_revoke' : null
    });
  }
});

test('true business dependencies block claim while audit references do not', async () => {
  const database = createClaimFixture();
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, status, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'dependent-order', PROVISIONAL_ID, 'Provisional 139653',
  '2026-09-12', 'Vendor A', '1樓', 10, 'ACTIVE',
  PROVISIONAL_ID, NOW_ISO, NOW_ISO);

  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'PROVISIONAL_IDENTITY_HAS_DEPENDENCIES');
  assertNoTransferSideEffects(database);
  assert.equal(database.get(
    `SELECT COUNT(*) AS count FROM admin_audit_log WHERE target_user_id = ?`,
    PROVISIONAL_ID
  ).count, 1);
});

for (const dependency of [
  'orders',
  'balance_ledger',
  'opening_balance_snapshots',
  'likes',
  'idempotency_keys'
]) {
  test(dependency + ' ownership is a claim blocker', async () => {
    const database = createClaimFixture();
    addBusinessDependency(database, dependency);
    const result = await call(database, '/api/auth/line-employee-bind', {
      method: 'POST',
      body: { employeeId: EMPLOYEE_ID }
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.body.error, 'PROVISIONAL_IDENTITY_HAS_DEPENDENCIES');
    assertNoTransferSideEffects(database);
  });
}

test('ambiguous normalized canonical ownership fails closed', async () => {
  const database = createClaimFixture();
  database.exec(`
    DROP INDEX users_employee_id_normalized_unique;
    DROP INDEX users_employee_id_unique;
  `);
  seedUser(database, {
    userId: 'duplicate-owner',
    lineUserId: null,
    employeeId: ' 139653 ',
    displayName: 'Duplicate Owner',
    role: 'User',
    active: 1,
    verificationStatus: 'UNVERIFIED'
  });

  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'EMPLOYEE_ID_ALREADY_BOUND');
  assertNoTransferSideEffects(database);
  assert.equal(database.get(
    `SELECT employee_id, active FROM users WHERE user_id = 'duplicate-owner'`
  ).employee_id, ' 139653 ');
});

test('guest credentials cannot invoke the authenticated LINE claim endpoint', async () => {
  const database = createClaimFixture();
  const guest = await employeeGuestLogin(database, EMPLOYEE_ID, NOW);
  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    token: guest.token,
    body: { employeeId: EMPLOYEE_ID },
    profile: {
      token: 'different-token',
      lineUserId: LINE_USER_ID,
      displayName: survivorProfile.displayName
    }
  });
  assert.equal(result.response.status, 401);
  assert.equal(mergeAuditRows(database).length, 0);
  assert.equal(ownerRow(database).employee_id, EMPLOYEE_ID);
});

test('race changing survivor before batch leaves provisional ownership intact', async () => {
  const database = createClaimFixture();
  const originalBatch = database.batch.bind(database);
  database.batch = async (statements) => {
    database.run(
      'UPDATE users SET employee_id = ?, updated_at = ? WHERE user_id = ?',
      'RACE-EMPLOYEE',
      NOW_ISO,
      SURVIVOR_ID
    );
    return originalBatch(statements);
  };

  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });

  assert.equal(result.response.status, 409);
  assert.equal(ownerRow(database).employee_id, EMPLOYEE_ID);
  assert.equal(ownerRow(database).active, 1);
  assert.equal(survivorRow(database).employee_id, 'RACE-EMPLOYEE');
  assert.equal(matchingSessionCount(database), 0);
  assert.equal(mergeAuditRows(database).length, 0);
});

test('in-transaction survivor state change fails through SQL assertion and rolls back all transfer steps', async () => {
  const database = createClaimFixture();
  database.exec(`
    CREATE TEMP TRIGGER claim_test_survivor_race
    AFTER UPDATE OF active ON users
    WHEN OLD.user_id = 'provisional-139653'
      AND OLD.active = 1
      AND NEW.active = 0
    BEGIN
      UPDATE users
      SET employee_id = 'RACE-EMPLOYEE'
      WHERE user_id = 'line-survivor-user';
    END;
  `);

  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });

  assert.notEqual(result.response.status, 200);
  assertNoTransferSideEffects(database);
});

test('native normalized ownership conflict rolls back release and retirement', async () => {
  const database = createClaimFixture();
  seedUser(database, {
    userId: 'competing-owner',
    lineUserId: null,
    employeeId: null,
    displayName: 'Competing Owner',
    role: 'User',
    active: 1,
    verificationStatus: 'UNVERIFIED'
  });
  database.exec(`
    CREATE TEMP TRIGGER claim_test_native_unique_race
    BEFORE UPDATE OF employee_id ON users
    WHEN OLD.user_id = 'line-survivor-user'
      AND OLD.employee_id IS NULL
      AND NEW.employee_id = '139653'
    BEGIN
      UPDATE users
      SET employee_id = '139653'
      WHERE user_id = 'competing-owner';
    END;
  `);

  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: EMPLOYEE_ID }
  });

  assert.notEqual(result.response.status, 200);
  assertNoTransferSideEffects(database);
  assert.equal(database.get(
    "SELECT employee_id FROM users WHERE user_id = 'competing-owner'"
  ).employee_id, null);
});

test('normal LINE binding remains unchanged for an unowned employee id', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: SURVIVOR_ID,
    lineUserId: LINE_USER_ID,
    employeeId: null,
    displayName: survivorProfile.displayName,
    pickupFloor: '1樓',
    role: 'Admin',
    active: 1,
    verificationStatus: 'VERIFIED'
  });

  const result = await call(database, '/api/auth/line-employee-bind', {
    method: 'POST',
    body: { employeeId: '777777' }
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'BOUND');
  assert.equal(result.body.user.userId, SURVIVOR_ID);
  assert.equal(result.body.user.employeeId, '777777');
  assert.equal(result.body.verificationStatus, 'VERIFIED');
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM employee_guest_sessions'
  ).count, 0);
});
