import {
  ACTIONS,
  assertCan
} from '../auth/permissions.js';
import { currentBalanceProjection, publicUser, toUser } from '../db/users.js';
import { forbidden, badRequest } from '../http/errors.js';
import { deadlineInfo, getTaipeiDate } from './deadlines.js';
import { isProfileComplete } from './profile.js';

const DELEGATED_ROLES = new Set(['ProxyAdmin', 'Admin']);

export const normalizeTargetUserId = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('TARGET_USER_ID_INVALID');
  const targetUserId = value.trim();
  return targetUserId || null;
};

const hasEmployeeId = (value) => String(value ?? '').trim().length > 0;

// Keep canonical identity separate from nullable LINE binding: a canonical
// member does not need a LINE binding to be an order target. Historical guest
// sessions are audit/provenance only and never override current eligibility.
export const isEligibleOrderTarget = (user) => Boolean(
  user?.userId
  && user.active === true
  && hasEmployeeId(user.employeeId)
  && isProfileComplete(user)
);

const orderTargetColumns = (alias = 'u') => `
  ${alias}.user_id, ${alias}.employee_id, ${alias}.line_user_id,
  ${alias}.display_name, ${alias}.pickup_floor,
  ${currentBalanceProjection(alias)} AS balance,
  ${alias}.role, ${alias}.active, ${alias}.verification_status,
  ${alias}.created_at, ${alias}.updated_at
`;

const orderTargetRecord = (row) => ({ user: toUser(row) });

const getOrderTargetById = async (database, userId) => {
  const row = await database.prepare(`
    SELECT ${orderTargetColumns('u')}
    FROM users u
    WHERE u.user_id = ?
    LIMIT 1
  `).bind(userId).first();
  return orderTargetRecord(row);
};

const authenticatedActor = (identity) => {
  assertCan(identity, ACTIONS.WRITE_SELF);
  const actor = identity?.actor;
  if (!actor?.userId) throw forbidden('AUTH_REQUIRED');
  if (
    identity?.effectiveSubject?.userId
    && identity.effectiveSubject.userId !== actor.userId
  ) {
    throw forbidden('VIEW_AS_MUTATION_FORBIDDEN');
  }
  return actor;
};

export const getAuthenticatedOrderActor = (identity) => authenticatedActor(identity);

export const resolveOrderActorTarget = async (
  database,
  identity,
  requestedTargetUserId
) => {
  const actor = authenticatedActor(identity);
  const requestedId = normalizeTargetUserId(requestedTargetUserId);
  const targetUserId = requestedId || actor.userId;
  const isDelegated = targetUserId !== actor.userId;

  if (isDelegated) {
    if (!DELEGATED_ROLES.has(actor.role)) {
      throw forbidden('DELEGATED_ORDER_FORBIDDEN');
    }
    assertCan(identity, ACTIONS.DELEGATE_ORDER);
  }

  const targetRecord = await getOrderTargetById(database, targetUserId);
  const target = targetRecord.user;
  if (!isEligibleOrderTarget(target)) {
    throw forbidden(targetUserId === actor.userId
      ? 'PROFILE_COMPLETION_REQUIRED'
      : 'ORDER_TARGET_INELIGIBLE');
  }

  return {
    actor,
    target,
    targetUserId,
    isDelegated,
    requestedTargetUserId: requestedId
  };
};

export const resolveOrderMutationTiming = ({
  actor,
  isDelegated,
  targetDate,
  mode,
  now,
  enforceProxyDelegatedDate = true
}) => {
  const adminBypass = actor?.role === 'Admin';
  const proxyDelegatedBypass = actor?.role === 'ProxyAdmin' && isDelegated;
  const proxyDelegatedDateAllowed = !proxyDelegatedBypass
    || targetDate >= getTaipeiDate(now);
  if (proxyDelegatedBypass && !proxyDelegatedDateAllowed && enforceProxyDelegatedDate) {
    throw forbidden('DELEGATED_ORDER_DATE_NOT_ELIGIBLE');
  }

  // ProxyAdmin delegation expands the eligible date range only. It never
  // bypasses the canonical calendar/menu cutoff; Admin remains the sole
  // elevated cutoff bypass.
  const cutoffApplies = !adminBypass;
  const deadline = deadlineInfo(targetDate, mode, now);
  return {
    deadline,
    cutoffApplies,
    deadlineBypassed: !cutoffApplies,
    allowed: proxyDelegatedDateAllowed
      && Boolean(deadline)
      && (!cutoffApplies || !deadline.isExpired)
  };
};

export const resolveOrderPermission = async (
  database,
  identity,
  { targetUserId, targetDate, mode, now, enforceProxyDelegatedDate = true }
) => {
  const actorTarget = await resolveOrderActorTarget(database, identity, targetUserId);
  return {
    ...actorTarget,
    timing: resolveOrderMutationTiming({
      actor: actorTarget.actor,
      isDelegated: actorTarget.isDelegated,
      targetDate,
      mode,
      now,
      enforceProxyDelegatedDate
    })
  };
};

export const orderPolicyResponse = ({ actor, target, isDelegated, timing }) => ({
  actorUserId: actor.userId,
  targetUserId: target.userId,
  delegated: isDelegated,
  cutoffApplies: timing.cutoffApplies,
  deadlineBypassed: timing.deadlineBypassed,
  canMutate: timing.allowed
});

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

export const getEligibleOrderTargets = async (database, identity) => {
  const actor = authenticatedActor(identity);
  assertCan(identity, ACTIONS.DELEGATE_ORDER);
  const result = await database.prepare(`
    SELECT ${orderTargetColumns('u')}
    FROM users u
    WHERE u.active = 1
    ORDER BY u.display_name ASC, u.user_id ASC
  `).all();
  return rowsFrom(result)
    .map(orderTargetRecord)
    .filter((record) => isEligibleOrderTarget(record.user))
    .filter((record) => record.user.userId !== actor.userId)
    .map((record) => publicUser(record.user, { authMode: 'canonical' }));
};

export { DELEGATED_ROLES };
