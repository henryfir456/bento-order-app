import {
  ACTIONS,
  assertCan
} from '../auth/permissions.js';
import { currentBalanceProjection, publicUser, toUser } from '../db/users.js';
import { forbidden, badRequest } from '../http/errors.js';
import { deadlineInfo, getTaipeiDate } from './deadlines.js';
import { matchingEmployeeGuestEvidencePredicate } from './employeeGuestEvidence.js';
import { isProfileComplete } from './profile.js';

const DELEGATED_ROLES = new Set(['ProxyAdmin', 'Admin']);

export const normalizeTargetUserId = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('TARGET_USER_ID_INVALID');
  const targetUserId = value.trim();
  return targetUserId || null;
};

const hasEmployeeId = (value) => String(value ?? '').trim().length > 0;

// Keep canonical/provisional identity separate from nullable LINE binding:
// only an unbound row with historical provisional guest-session evidence is
// excluded here. A bound canonical survivor remains eligible even if its
// historical guest sessions are retained for audit/provenance.
export const isEligibleOrderTarget = (user, { hasProvisionalGuestEvidence = false } = {}) => Boolean(
  user?.userId
  && user.active === true
  && hasEmployeeId(user.employeeId)
  && !hasProvisionalGuestEvidence
  && isProfileComplete(user)
);

const provisionalGuestEvidence = (alias = 'u') => `
  ${alias}.line_user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM employee_guest_sessions egs
    WHERE ${matchingEmployeeGuestEvidencePredicate({
      sessionAlias: 'egs',
      ownerUserIdExpression: `${alias}.user_id`,
      ownerEmployeeIdExpression: `${alias}.employee_id`
    })}
  )
`;

const orderTargetColumns = (alias = 'u') => `
  ${alias}.user_id, ${alias}.employee_id, ${alias}.line_user_id,
  ${alias}.display_name, ${alias}.pickup_floor,
  ${currentBalanceProjection(alias)} AS balance,
  ${alias}.role, ${alias}.active, ${alias}.verification_status,
  ${alias}.created_at, ${alias}.updated_at,
  CASE WHEN ${provisionalGuestEvidence(alias)} THEN 1 ELSE 0 END
    AS has_provisional_guest_evidence
`;

const orderTargetRecord = (row) => ({
  user: toUser(row),
  hasProvisionalGuestEvidence: Boolean(row?.has_provisional_guest_evidence)
});

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
  if (!isEligibleOrderTarget(target, targetRecord)) {
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
    SELECT ${orderTargetColumns('u')}
    FROM users u
    WHERE u.active = 1
    ORDER BY u.display_name ASC, u.user_id ASC
  `).all();
  return rowsFrom(result)
    .map(orderTargetRecord)
    .filter((record) => isEligibleOrderTarget(record.user, record))
    .filter((record) => record.user.userId !== actor.userId)
    .map((record) => publicUser(record.user, { authMode: 'canonical' }));
};

export { DELEGATED_ROLES };
