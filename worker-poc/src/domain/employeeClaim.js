import { conflict, forbidden } from '../http/errors.js';
import {
  currentBalanceProjection,
  getUserById,
  getUserByLineId,
  publicUser,
  toUser
} from '../db/users.js';
import { digestEmployeeId, employeeIdText } from './employeeVerification.js';
import { matchingEmployeeGuestEvidencePredicate } from './employeeGuestEvidence.js';
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

const normalizedEmployeeId = (value) => String(value ?? '').trim().toUpperCase();

const hasEmployeeId = (value) => normalizedEmployeeId(value).length > 0;

const sameNormalizedEmployeeId = (left, right) => (
  hasEmployeeId(left)
  && normalizedEmployeeId(left) === normalizedEmployeeId(right)
);

const readCanonicalOwners = async (database, employeeId) => {
  const result = await database.prepare(`
    SELECT
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      ${currentBalanceProjection('u')} AS balance,
      role, active, verification_status, created_at, updated_at
    FROM users u
    WHERE UPPER(trim(u.employee_id)) = ?
      AND length(trim(u.employee_id)) > 0
    ORDER BY u.user_id ASC
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

// This is intentionally historical provenance. Expiry and revocation are
// runtime session properties, not evidence that the provisional user never
// originated from this employee_guest flow.
const readEmployeeGuestEvidence = async (
  database,
  { ownerUserId, employeeId }
) => {
  const row = await database.prepare(`
    SELECT session_id
    FROM employee_guest_sessions
    WHERE ${matchingEmployeeGuestEvidencePredicate()}
    LIMIT 1
  `).bind(ownerUserId, employeeId).first();
  return Boolean(row);
};

const readClaimState = async (
  database,
  { survivorUserId, lineUserId, employeeId }
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
        employeeId
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
    && state.lineOwner?.userId === survivorUserId
    && state.survivor.lineUserId === lineUserId
    && state.survivor.active === true
    && state.survivor.employeeId === null
    && owner.active === true
    && sameNormalizedEmployeeId(owner.employeeId, employeeId)
    && owner.lineUserId === null
    && owner.role !== 'Admin'
    && owner.role !== 'ProxyAdmin'
    && state.hasEmployeeGuestEvidence
  );
};

const bindingResult = (user, status = 'BOUND') => ({
  success: true,
  status,
  registered: true,
  identityState: publicUser(user).identityState,
  verificationStatus: user.verificationStatus,
  authMode: 'line',
  user: publicUser(user)
});

// The same trusted SQL predicate is used by both the revoke UPDATE and its
// postcondition. Keep the OR group parenthesized under the guest/validity
// guards so an expired, revoked, or non-guest row cannot be updated.
const LIVE_MATCHING_GUEST_SESSION_PREDICATE = `
  auth_mode = 'employee_guest'
  AND revoked_at IS NULL
  AND expires_at > ?
  AND (
    (
      employee_id IS NOT NULL
      AND length(trim(employee_id)) > 0
      AND UPPER(trim(employee_id)) = ?
    )
    OR user_id = ?
  )
`;

const claimAssertion = (database, timestamp) => prepareStatement(database, `
  INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
  SELECT ?, NULL, ?
  WHERE changes() <> 1
`, [randomId('claim_assert'), timestamp]);

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
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeId,
  timestamp
}) => prepareStatement(database, `
  UPDATE users
  SET employee_id = NULL,
      updated_at = ?
  WHERE user_id = ?
    AND user_id <> ?
    AND active = 1
    AND line_user_id IS NULL
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
    AND EXISTS (
      SELECT 1
      FROM users AS survivor
      WHERE survivor.user_id = ?
        AND survivor.line_user_id = ?
        AND survivor.active = 1
        AND survivor.employee_id IS NULL
    )
`, [
  timestamp,
  ownerUserId,
  survivorUserId,
  employeeId,
  employeeId,
  ownerUserId,
  employeeId,
  ownerUserId,
  ownerUserId,
  ownerUserId,
  ownerUserId,
  ownerUserId,
  survivorUserId,
  lineUserId
]);

const ownerRetireStatement = (database, {
  survivorUserId,
  lineUserId,
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
    AND employee_id IS NULL
    AND role NOT IN ('Admin', 'ProxyAdmin')
    AND EXISTS (
      SELECT 1
      FROM users AS survivor
      WHERE survivor.user_id = ?
        AND survivor.line_user_id = ?
        AND survivor.active = 1
        AND survivor.employee_id IS NULL
    )
`, [timestamp, ownerUserId, survivorUserId, lineUserId]);

const survivorAssignStatement = (database, {
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeId,
  timestamp
}) => prepareStatement(database, `
  UPDATE users
  SET employee_id = ?,
      updated_at = ?
  WHERE user_id = ?
    AND line_user_id = ?
    AND active = 1
    AND employee_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM users AS retired_owner
      WHERE retired_owner.user_id = ?
        AND retired_owner.active = 0
        AND retired_owner.employee_id IS NULL
        AND retired_owner.line_user_id IS NULL
        AND retired_owner.role NOT IN ('Admin', 'ProxyAdmin')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM users AS competing
      WHERE competing.user_id <> ?
        AND competing.employee_id IS NOT NULL
        AND length(trim(competing.employee_id)) > 0
        AND UPPER(trim(competing.employee_id)) = ?
    )
`, [
  employeeId,
  timestamp,
  survivorUserId,
  lineUserId,
  ownerUserId,
  survivorUserId,
  employeeId
]);

const revokeGuestSessionsStatement = (database, {
  employeeId,
  ownerUserId,
  timestamp
}) => prepareStatement(database, `
  UPDATE employee_guest_sessions
  SET revoked_at = ?,
      revoked_reason = 'line_bound'
  WHERE ${LIVE_MATCHING_GUEST_SESSION_PREDICATE}
`, [timestamp, timestamp, employeeId, ownerUserId]);

const revokePostconditionAssertion = (
  database,
  { employeeId, ownerUserId, timestamp }
) => prepareStatement(database, `
  INSERT INTO employee_guest_sessions (session_id, token_hash, expires_at)
  SELECT ?, NULL, ?
  WHERE EXISTS (
    SELECT 1
    FROM employee_guest_sessions
    WHERE ${LIVE_MATCHING_GUEST_SESSION_PREDICATE}
  )
`, [
  randomId('claim_revoke_assert'),
  timestamp,
  timestamp,
  employeeId,
  ownerUserId
]);

const auditStatement = (database, {
  auditId,
  survivorUserId,
  lineUserId,
  ownerUserId,
  employeeIdDigest,
  survivorVerificationStatus,
  timestamp
}) => prepareStatement(database, `
  INSERT INTO admin_audit_log (
    audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
    actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
    target_line_user_id_snapshot, action, metadata_json, occurred_at
  )
  VALUES (?, ?, 'line', NULL, ?, ?, NULL, NULL,
          'PROVISIONAL_EMPLOYEE_CLAIMED', ?, ?)
`, [
  auditId,
  survivorUserId,
  lineUserId,
  ownerUserId,
  JSON.stringify({
    survivorUserId,
    retiredProvisionalUserId: ownerUserId,
    employeeIdDigest,
    survivorVerificationStatus: survivorVerificationStatus || null,
    outcome: 'CLAIMED'
  }),
  timestamp
]);

const classifyTransactionFailure = async (
  database,
  {
    error,
    survivorUserId,
    lineUserId,
    employeeId
  }
) => {
  const state = await readClaimState(database, {
    survivorUserId,
    lineUserId,
    employeeId
  });
  if (
    state.survivor?.active === true
    && state.lineOwner?.userId === survivorUserId
    && sameNormalizedEmployeeId(state.survivor.employeeId, employeeId)
  ) {
    return bindingResult(state.survivor, 'ALREADY_BOUND');
  }
  if (
    state.survivor?.lineUserId === lineUserId
    && hasEmployeeId(state.survivor.employeeId)
    && !sameNormalizedEmployeeId(state.survivor.employeeId, employeeId)
  ) {
    throw conflict('LINE_ALREADY_BOUND');
  }
  if (state.owner && state.owner.userId !== survivorUserId) {
    const claimable = hasClaimableOwnerShape(state, {
      survivorUserId,
      lineUserId,
      employeeId
    });
    if (claimable && state.dependencies.length > 0) {
      throw conflict('PROVISIONAL_IDENTITY_HAS_DEPENDENCIES');
    }
    if (state.owners.length !== 1 || !claimable) {
      throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
    }
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
    employeeId
  });

  if (!state.survivor || state.lineOwner?.userId !== survivorId) {
    throw conflict('LINE_BIND_CONFLICT');
  }
  if (!state.survivor.active) throw forbidden('EMPLOYEE_INACTIVE');
  if (hasEmployeeId(state.survivor.employeeId)) {
    if (sameNormalizedEmployeeId(state.survivor.employeeId, employeeId)) {
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
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
      ownerUserId,
      employeeId,
      timestamp
    }),
    claimAssertion(database, timestamp),
    ownerRetireStatement(database, {
      survivorUserId: survivorId,
      lineUserId: verifiedLineUserId,
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
      employeeIdDigest,
      survivorVerificationStatus: state.survivor.verificationStatus,
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
      employeeId
    });
  }

  const bound = await getUserById(database, survivorId);
  if (
    !bound
    || bound.active !== true
    || bound.lineUserId !== verifiedLineUserId
    || !sameNormalizedEmployeeId(bound.employeeId, employeeId)
    || bound.verificationStatus !== state.survivor.verificationStatus
  ) {
    throw conflict('LINE_BIND_CONFLICT');
  }
  return bindingResult(bound, 'BOUND');
};
