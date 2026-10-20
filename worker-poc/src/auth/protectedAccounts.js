import { getUserById, getUserByLineId } from '../db/users.js';
import { appendAuditEvent } from '../db/audit.js';
import { forbidden } from '../http/errors.js';
import { prepareStatement, randomId, resolveClock } from '../db/transactions.js';
import { VERIFICATION_STATUSES } from './permissions.js';

export {
  hasAnyProtectedEmployeeId,
  isProtectedEmployeeId
} from './protectedAccountPolicy.js';

export const recordProtectedAccountDenial = async (
  database,
  {
    authMode = 'line',
    reason = 'AUTHORIZATION_UNVERIFIED',
    clock = new Date()
  } = {}
) => {
  const eventId = randomId('protected_auth');
  const occurredAt = resolveClock(clock).toISOString();
  await prepareStatement(database, `
    INSERT INTO protected_account_access_audit (
      event_id, auth_mode, reason_code, occurred_at
    ) VALUES (?, ?, ?, ?)
  `, [eventId, authMode, reason, occurredAt]).run();
  return eventId;
};

export const auditProtectedAdminIntervention = async (
  database,
  {
    actor,
    action,
    side = 'target',
    reason = 'AUTHORIZATION_UNVERIFIED',
    clock = new Date()
  } = {}
) => {
  const occurredAt = resolveClock(clock).toISOString();
  await appendAuditEvent(database, {
    actorUserId: actor?.userId,
    actorAuthMode: actor?.authMode || 'line',
    actorEmployeeIdSnapshot: null,
    actorLineUserIdSnapshot: null,
    targetUserId: null,
    targetEmployeeIdSnapshot: null,
    targetLineUserIdSnapshot: null,
    action,
    metadata: { side, reason },
    occurredAt
  });
  await recordProtectedAccountDenial(database, {
    authMode: 'line',
    reason,
    clock: occurredAt
  });
};

export const denyProtectedAccountAccess = async (
  database,
  { authMode = 'line', reason = 'AUTHORIZATION_UNVERIFIED', clock = new Date() } = {}
) => {
  await recordProtectedAccountDenial(database, { authMode, reason, clock });
  throw forbidden('PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
};

const allRows = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

/**
 * Resolve the protected employee only from its canonical LINE binding. The
 * dedicated protected-account audit table intentionally stores no actor,
 * account, employee, or LINE IDs.
 */
export const requireProtectedLineOwner = async (database, lineUserId, clock = new Date()) => {
  const owners = allRows(await database.prepare(`
    SELECT user_id
    FROM users
    WHERE UPPER(trim(employee_id)) = ?
      AND length(trim(employee_id)) > 0
    ORDER BY user_id
    LIMIT 2
  `).bind('0'.repeat(6)).all());
  if (owners.length !== 1) {
    return denyProtectedAccountAccess(database, {
      reason: owners.length === 0 ? 'PROTECTED_ACCOUNT_MISSING' : 'PROTECTED_ACCOUNT_AMBIGUOUS',
      clock
    });
  }

  const user = await getUserById(database, owners[0].user_id);
  const lineOwner = await getUserByLineId(database, lineUserId);
  if (!user
    || !user.active
    || user.invalidReason
    || user.verificationStatus !== VERIFICATION_STATUSES.VERIFIED
    || user.lineUserId !== lineUserId
    || !lineOwner
    || lineOwner.userId !== user.userId) {
    const reason = !user
      ? 'PROTECTED_ACCOUNT_MISSING'
      : !user.active
        ? 'PROTECTED_ACCOUNT_INACTIVE'
        : user.invalidReason
          ? 'PROTECTED_ACCOUNT_INVALID'
          : user.verificationStatus !== VERIFICATION_STATUSES.VERIFIED
            ? 'PROTECTED_ACCOUNT_UNVERIFIED'
            : 'LINE_OWNER_MISMATCH';
    return denyProtectedAccountAccess(database, { reason, clock });
  }
  return user;
};
