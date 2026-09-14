import {
  ACTIONS,
  assertCan
} from '../auth/permissions.js';
import { currentBalanceProjection, getUserById, publicUser, toUser } from '../db/users.js';
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

export const isEligibleOrderTarget = (user) => Boolean(
  user?.userId
  && user.active === true
  && isProfileComplete(user)
);

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

  const target = await getUserById(database, targetUserId);
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
    || targetDate === getTaipeiDate(now);
  if (proxyDelegatedBypass && !proxyDelegatedDateAllowed && enforceProxyDelegatedDate) {
    throw forbidden('DELEGATED_ORDER_TODAY_ONLY');
  }

  const cutoffApplies = !(adminBypass || (proxyDelegatedBypass && proxyDelegatedDateAllowed));
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
    SELECT u.user_id, u.employee_id, u.line_user_id, u.display_name,
           u.pickup_floor, ${currentBalanceProjection('u')} AS balance,
           u.role, u.active, u.verification_status, u.created_at, u.updated_at
    FROM users u
    WHERE u.active = 1
    ORDER BY u.display_name ASC, u.user_id ASC
  `).all();
  return rowsFrom(result)
    .map(toUser)
    .filter(isEligibleOrderTarget)
    .filter((target) => target.userId !== actor.userId)
    .map(publicUser);
};

export { DELEGATED_ROLES };
