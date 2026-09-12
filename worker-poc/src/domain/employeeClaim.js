import { conflict, forbidden } from '../http/errors.js';
import { getUserById, getUserByLineId, publicUser, toUser } from '../db/users.js';
import {
  digestEmployeeId,
  employeeIdText,
  resolveEmployeeVerification
} from './employeeVerification.js';
import { VERIFICATION_STATUSES } from '../auth/permissions.js';
import {
  prepareStatement,
  randomId,
  resolveClock,
  runMutationBatch
} from '../db/transactions.js';

const BUSINESS_DEPENDENCIES = Object.freeze([
  Object.freeze({
    name: 'orders',
    query: `SELECT 1 FROM orders WHERE user_id = ? LIMIT 1`
  }),
  Object.freeze({
    name: 'balance_ledger',
    query: `SELECT 1 FROM balance_ledger WHERE user_id = ? LIMIT 1`
  }),
  Object.freeze({
    name: 'opening_balance_snapshots',
    query: `SELECT 1 FROM opening_balance_snapshots WHERE user_id = ? LIMIT 1`
  }),
  Object.freeze({
    name: 'likes',
    query: `SELECT 1 FROM likes WHERE user_id = ? LIMIT 1`
  }),
  Object.freeze({
    name: 'idempotency_keys',
    query: `SELECT 1 FROM idempotency_keys WHERE actor_user_id = ? LIMIT 1`
  })
]);

const rowsFrom = (result) => (
  Array.isArray(result)
    ? result
    : (Array.isArray(result?.results) ? result.results : [])
);

const readCanonicalOwners = async (database, employeeId) => {
  const result = await database.prepare(`
    SELECT
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, active, verification_status, created_at, updated_at
    FROM users
    WHERE UPPER(trim(employee_id)) = ?
      AND length(trim(employee_id)) > 0
    ORDER BY user_id ASC
  `).bind(employeeId).all();
  return rowsFrom(result).map(toUser);
};

const readBusinessDependencies = async (database, userId) => {
  const names = [];
  for (const dependency of BUSINESS_DEPENDENCIES) {
    const row = await database.prepare(dependency.query).bind(userId).first();
    if (row) names.push(dependency.name);
  }
  return names;
};

const readEmployeeGuestEvidence = async (
  database,
  { ownerUserId, employeeId, now }
) => {
  const row = await database.prepare(`
    SELECT session_id
    FROM employee_guest_sessions
    WHERE user_id = ?
      AND auth_mode = 'employee_guest'
      AND status = 'UNVERIFIED_EMPLOYEE'
      AND UPPER(trim(employee_id)) = ?
      AND revoked_at IS NULL
      AND expires_at > ?
    LIMIT 1
  `).bind(ownerUserId, employeeId, now).first();
  return Boolean(row);
};

const readClaimState = async (
  database,
  { survivorUserId, lineUserId, employeeId, now }
) => {
  const [survivor, lineOwner, owners] = await Promise.all([
    getUserById(database, survivorUserId),
    getUserByLineId(database, lineUserId),
    readCanonicalOwners(database, employeeId)
  ]);
  const owner = owners.length === 1 ? owners[0] : null;
  const [hasEmployeeGuestEvidence, dependencies] = owner
    ? await Promise.all([
      readEmployeeGuestEvidence(database, {
        ownerUserId: owner.userId,
        employeeId,
        now
      }),
      readBusinessDependencies(database, owner.userId)
    ])
    : [false, []];

  return {
    survivor,
    lineOwner,
    owners,
    owner,
    hasEmployeeGuestEvidence,
    dependencies
  };
};

const hasClaimableOwnerShape = (
  state,
  { survivorUserId, lineUserId, employeeId }
) => {
  const owner = state.owner;
  return Boolean(
    state.owners.length === 1
    && owner
    && owner.userId !== survivorUserId
    && state.survivor?.userId === survivorUserId
    && state.survivor.lineUserId === lineUserId
    && state.survivor.active
    && state.survivor.employeeId === null
    && owner.active
    && owner.employeeId !== null
    && owner.employeeId.trim().toUpperCase() === employeeId
    && owner.lineUserId === null
    && owner.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED
    && owner.role !== 'Admin'
    && owner.role !== 'ProxyAdmin'
    && state.hasEmployeeGuestEvidence
  );
};

const bindingResult = (user, status = 'BOUND') => ({
  success: true,
  status,
  identityState: publicUser(user).identityState,
  verificationStatus: user.verificationStatus,
  authMode: 'line',
  user: publicUser(user)
});

const claimAssertion = (database, timestamp) => prepareStatement(database, `
  INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
  SELECT ?, NULL, ?
  WHERE changes() <> 1
`, [randomId('claim_assert'), timestamp]);

const revokePostconditionAssertion = (
  database,
  { employeeId, ownerUserId, timestamp }
) => prepareStatement(database, `
  INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
  SELECT ?, NULL, ?
  WHERE EXISTS (
    SELECT 1
    FROM employee_guest_sessions
    WHERE revoked_at IS NULL
      AND expires_at > ?
      AND auth_mode = 'employee_guest'
      AND (
        (
          employee_id IS NOT NULL
          AND length(trim(employee_id)) > 0
          AND UPPER(trim(employee_id)) = ?
        )
        OR user_id = ?
      )
  )
`, [randomId('claim_revoke_assert'), timestamp, timestamp, employeeId, ownerUserId]);

const survivorGuardStatement = (database, {
  survivorUserId,
  lineUserId,
  timestamp
}) => prepareStatement(database, `
  UPDATE users
  SET updated_at = ?
  WHERE user_id = ?
    AND line_user_id = ?
    AND active = 1
    AND employee_id IS NULL
`, [timestamp, survivorUserId, lineUserId]);

const ownerReleaseStatement = (database, {
  ownerUserId,
  employeeId,
  timestamp
}) => prepareStatement(database, `
  UPDATE users
  SET employee_id = NULL,
      updated_at = ?
  WHERE user_id = ?
    AND active = 1
    AND line_user_id IS NULL
    AND verification_status = 'UNVERIFIED'
    AND role NOT IN ('Admin', 'ProxyAdmin')
    AND employee_id IS NOT NULL
    AND length(trim(employee_id)) > 0
    AND UPPER(trim(employee_id)) = ?
    AND (
      SELECT COUNT(*)
      FROM users
      WHERE employee_id IS NOT NULL
        AND length(trim(employee_id)) > 0
        AND UPPER(trim(employee_id)) = ?
    ) = 1
    AND EXISTS (
      SELECT 1
      FROM employee_guest_sessions
      WHERE user_id = ?
        AND auth_mode = 'employee_guest'
        AND status = 'UNVERIFIED_EMPLOYEE'
        AND employee_id IS NOT NULL
        AND length(trim(employee_id)) > 0
        AND UPPER(trim(employee_id)) = ?
        AND revoked_at IS NULL
        AND expires_at > ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM orders WHERE user_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM balance_ledger WHERE user_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM opening_balance_snapshots WHERE user_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM likes WHERE user_id = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM idempotency_keys WHERE actor_user_id = ?
    )
    AND NOT EXISTS (
      SELECT 1
      FROM users AS competing
      WHERE competing.employee_id IS NOT NULL
        AND length(trim(competing.employee_id)) > 0
        AND UPPER(trim(competing.employee_id)) = ?
        AND competing.user_id <> ?
    )
`, [
  timestamp,
  ownerUserId,
  employeeId,
  employeeId,
  ownerUserId,
  employeeId,
  timestamp,
  ownerUserId,
  ownerUserId,
  ownerUserId,
  ownerUserId,
  ownerUserId,
  employeeId,
  ownerUserId
]);

const ownerRetireStatement = (database, {
  ownerUserId,
  timestamp
}) => prepareStatement(database, `
  UPDATE users
  SET active = 0,
      employee_id = NULL,
      updated_at = ?
  WHERE user_id = ?
    AND active = 1
    AND line_user_id IS NULL
    AND verification_status = 'UNVERIFIED'
    AND role NOT IN ('Admin', 'ProxyAdmin')
    AND employee_id IS NULL
`, [timestamp, ownerUserId]);

const survivorAssignStatement = (database, {
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeId,
  timestamp
}) => prepareStatement(database, `
  WITH roster AS (
    SELECT
      COUNT(*) AS match_count,
      COALESCE(SUM(
        CASE
          WHEN active = 1
            AND provenance IN ('TRUSTED_IMPORT', 'ADMIN_APPROVED')
          THEN 1
          ELSE 0
        END
      ), 0) AS trusted_count
    FROM employee_roster
    WHERE UPPER(trim(employee_id)) = ?
  )
  UPDATE users
  SET employee_id = ?,
      verification_status = CASE
        WHEN (SELECT match_count FROM roster) = 1
          AND (SELECT trusted_count FROM roster) = 1
        THEN 'VERIFIED'
        ELSE 'UNVERIFIED'
      END,
      updated_at = ?
  WHERE user_id = ?
    AND line_user_id = ?
    AND active = 1
    AND employee_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM users AS provisional
      WHERE provisional.user_id = ?
        AND provisional.active = 0
        AND provisional.employee_id IS NULL
        AND provisional.line_user_id IS NULL
        AND provisional.verification_status = 'UNVERIFIED'
        AND provisional.role NOT IN ('Admin', 'ProxyAdmin')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM users AS competing
      WHERE competing.employee_id IS NOT NULL
        AND length(trim(competing.employee_id)) > 0
        AND UPPER(trim(competing.employee_id)) = ?
        AND competing.user_id <> ?
        AND competing.user_id <> ?
    )
`, [
  employeeId,
  employeeId,
  timestamp,
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeId,
  survivorUserId,
  ownerUserId
]);

const revokeGuestSessionsStatement = (database, {
  employeeId,
  ownerUserId,
  timestamp
}) => prepareStatement(database, `
  UPDATE employee_guest_sessions
  SET revoked_at = ?,
      revoked_reason = 'line_bound'
  WHERE revoked_at IS NULL
    AND expires_at > ?
    AND auth_mode = 'employee_guest'
    AND (
      (
        employee_id IS NOT NULL
        AND length(trim(employee_id)) > 0
        AND UPPER(trim(employee_id)) = ?
      )
      OR user_id = ?
    )
`, [timestamp, timestamp, employeeId, ownerUserId]);

const auditStatement = (database, {
  auditId,
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeId,
  employeeIdDigest,
  timestamp
}) => prepareStatement(database, `
  WITH roster AS (
    SELECT
      COUNT(*) AS match_count,
      COALESCE(SUM(
        CASE
          WHEN active = 1
            AND provenance IN ('TRUSTED_IMPORT', 'ADMIN_APPROVED')
          THEN 1
          ELSE 0
        END
      ), 0) AS trusted_count
    FROM employee_roster
    WHERE UPPER(trim(employee_id)) = ?
  ),
  decision AS (
    SELECT
      CASE
        WHEN match_count = 1 AND trusted_count = 1
        THEN 'AUTO_VERIFIED'
        ELSE 'PENDING_TRUST_REVIEW'
      END AS verification_decision,
      CASE
        WHEN match_count = 1 AND trusted_count = 1
        THEN 'VERIFIED'
        ELSE 'UNVERIFIED'
      END AS verification_status,
      CASE
        WHEN match_count = 1 AND trusted_count = 1
        THEN 'VERIFIED'
        ELSE 'PENDING_VERIFICATION'
      END AS identity_state,
      CASE
        WHEN match_count = 1 AND trusted_count = 1
        THEN 'TRUSTED_UNIQUE_ACTIVE'
        WHEN match_count = 0
        THEN 'NO_TRUSTED_MATCH'
        WHEN match_count > 1
        THEN 'AMBIGUOUS_MATCH'
        ELSE 'INACTIVE_OR_UNTRUSTED_MATCH'
      END AS verification_reason
    FROM roster
  )
  INSERT INTO admin_audit_log (
    audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
    actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
    target_line_user_id_snapshot, action, metadata_json, occurred_at
  )
  SELECT ?, ?, 'line', NULL, ?, ?, NULL, NULL,
         'PROVISIONAL_EMPLOYEE_CLAIMED',
         json_object(
           'employeeIdDigest', ?,
           'verificationDecision', decision.verification_decision,
           'verificationStatus', decision.verification_status,
           'identityState', decision.identity_state,
           'reason', decision.verification_reason,
           'outcome', 'CLAIMED',
           'retiredProvisionalUserId', ?
         ),
         ?
  FROM decision
`, [
  employeeId,
  auditId,
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeIdDigest,
  ownerUserId,
  timestamp
]);

const classifyTransactionFailure = async (
  database,
  {
    error,
    survivorUserId,
    lineUserId,
    employeeId,
    now
  }
) => {
  const state = await readClaimState(database, {
    survivorUserId,
    lineUserId,
    employeeId,
    now
  });
  if (
    state.survivor?.active
    && state.survivor.lineUserId === lineUserId
    && state.survivor.userId === survivorUserId
    && state.survivor.employeeId !== null
    && state.survivor.employeeId !== undefined
    && state.survivor.employeeId.trim().toUpperCase() === employeeId
  ) {
    return bindingResult(state.survivor, 'ALREADY_BOUND');
  }
  if (
    state.survivor?.lineUserId === lineUserId
    && state.survivor.employeeId !== null
    && state.survivor.employeeId !== undefined
    && state.survivor.employeeId.trim().toUpperCase() !== employeeId
  ) {
    throw conflict('LINE_ALREADY_BOUND');
  }
  if (
    state.owners.length !== 1
    || !state.owner
    || state.owner.userId === survivorUserId
    || state.owner.lineUserId !== null
    || state.owner.verificationStatus !== VERIFICATION_STATUSES.UNVERIFIED
    || state.owner.role === 'Admin'
    || state.owner.role === 'ProxyAdmin'
    || !state.hasEmployeeGuestEvidence
    || !hasClaimableOwnerShape(state, { survivorUserId, lineUserId, employeeId })
  ) {
    throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
  }
  if (state.dependencies.length > 0) {
    throw conflict('PROVISIONAL_IDENTITY_HAS_DEPENDENCIES');
  }
  throw error;
};

export const claimProvisionalEmployee = async (
  database,
  {
    survivorUserId,
    lineUserId,
    employeeId: employeeIdInput,
    clock = new Date()
  } = {}
) => {
  const survivorId = String(survivorUserId || '').trim();
  const verifiedLineUserId = String(lineUserId || '').trim();
  if (!survivorId || !verifiedLineUserId) throw conflict('LINE_BIND_CONFLICT');
  const employeeId = employeeIdText(employeeIdInput);
  const timestamp = resolveClock(clock).toISOString();
  const state = await readClaimState(database, {
    survivorUserId: survivorId,
    lineUserId: verifiedLineUserId,
    employeeId,
    now: timestamp
  });

  if (!state.survivor || state.lineOwner?.userId !== survivorId) {
    throw conflict('LINE_BIND_CONFLICT');
  }
  if (!state.survivor.active) throw forbidden('EMPLOYEE_INACTIVE');
  if (state.survivor.employeeId !== null && state.survivor.employeeId !== undefined) {
    if (state.survivor.employeeId.trim().toUpperCase() === employeeId) {
      return bindingResult(state.survivor, 'ALREADY_BOUND');
    }
    throw conflict('LINE_ALREADY_BOUND');
  }
  if (state.owners.length !== 1 || !state.owner) {
    throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
  }
  if (!hasClaimableOwnerShape(state, {
    survivorUserId: survivorId,
    lineUserId: verifiedLineUserId,
    employeeId
  })) {
    throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
  }
  if (state.dependencies.length > 0) {
    throw conflict('PROVISIONAL_IDENTITY_HAS_DEPENDENCIES');
  }

  await resolveEmployeeVerification(database, employeeId);
  const employeeIdDigest = await digestEmployeeId(employeeId);
  const ownerUserId = state.owner.userId;
  const statements = [
    survivorGuardStatement(database, {
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      timestamp
    }),
    claimAssertion(database, timestamp),
    ownerReleaseStatement(database, {
      ownerUserId,
      employeeId,
      timestamp
    }),
    claimAssertion(database, timestamp),
    ownerRetireStatement(database, {
      ownerUserId,
      timestamp
    }),
    claimAssertion(database, timestamp),
    survivorAssignStatement(database, {
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      ownerUserId,
      employeeId,
      timestamp
    }),
    claimAssertion(database, timestamp),
    revokeGuestSessionsStatement(database, {
      employeeId,
      ownerUserId,
      timestamp
    }),
    revokePostconditionAssertion(database, {
      employeeId,
      ownerUserId,
      timestamp
    }),
    auditStatement(database, {
      auditId: randomId('audit'),
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      ownerUserId,
      employeeId,
      employeeIdDigest,
      timestamp
    }),
    claimAssertion(database, timestamp)
  ];

  try {
    await runMutationBatch(database, statements);
  } catch (error) {
    return classifyTransactionFailure(database, {
      error,
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      employeeId,
      now: timestamp
    });
  }

  const bound = await getUserById(database, survivorId);
  if (
    !bound
    || !bound.active
    || bound.lineUserId !== verifiedLineUserId
    || bound.employeeId === null
    || bound.employeeId.trim().toUpperCase() !== employeeId
  ) {
    throw conflict('LINE_BIND_CONFLICT');
  }
  return bindingResult(bound, 'BOUND');
};
