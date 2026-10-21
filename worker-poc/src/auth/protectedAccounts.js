import { getUserById, getUserByLineId } from '../db/users.js';
import { appendAuditEvent } from '../db/audit.js';
import { forbidden } from '../http/errors.js';
import { prepareStatement, randomId, resolveClock } from '../db/transactions.js';

export {
  hasAnyProtectedEmployeeId,
  isProtectedAccount,
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
 * Resolve the protected account only from its canonical marker and LINE binding. The
 * dedicated protected-account audit table intentionally stores no actor,
 * account, employee, or LINE IDs.
 */
export const requireProtectedLineOwner = async (database, lineUserId, clock = new Date()) => {
  const owners = allRows(await database.prepare(`
    SELECT mapping.user_id
    FROM protected_account_user_mappings mapping
    WHERE mapping.account_key = 'RESERVED_VENDOR_OWNER'
    ORDER BY mapping.user_id
    LIMIT 2
  `).all());
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
    || user.lineUserId !== lineUserId
    || !lineOwner
    || lineOwner.userId !== user.userId) {
    const reason = !user
      ? 'PROTECTED_ACCOUNT_MISSING'
      : !user.active
        ? 'PROTECTED_ACCOUNT_INACTIVE'
        : user.invalidReason
          ? 'PROTECTED_ACCOUNT_INVALID'
          : 'LINE_OWNER_MISMATCH';
    return denyProtectedAccountAccess(database, { reason, clock });
  }
  return user;
};
