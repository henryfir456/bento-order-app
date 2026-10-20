import { getUserByEmployeeId, getUserById, getUserByLineId } from '../db/users.js';
import { appendAuditEvent } from '../db/audit.js';
import { forbidden, unauthorized } from '../http/errors.js';
import {
  capabilitiesFor,
  identityStateFor,
  isRegisteredEmployeeGuestPrincipal,
  isRegisteredLinePrincipal,
  VERIFICATION_STATUSES
} from './permissions.js';
import { fetchLineProfile } from './lineProfile.js';
import { inspectGuestSession, isGuestToken } from './guestSession.js';
import {
  denyProtectedAccountAccess,
  hasAnyProtectedEmployeeId,
  requireProtectedLineOwner
} from './protectedAccounts.js';

const bearerToken = (request) => {
  const header = request?.headers?.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const actorFromUser = (
  user,
  {
    authMode = 'line',
    displayName = '',
    lineUserId = null,
    employeeId = null,
    provisional = false
  } = {}
) => {
  const verificationStatus = user?.verificationStatus
    || (provisional ? VERIFICATION_STATUSES.UNVERIFIED : null);
  const hasEmployeeId = Boolean(String(user?.employeeId || employeeId || '').trim());
  const requiresEmployeeBinding = Boolean(
    user
    && authMode === 'line'
    && !hasEmployeeId
  );
  const active = user ? Boolean(user.active) : true;
  const registered = Boolean(
    user
    && active
    && hasEmployeeId
    && (
      authMode === 'line'
      || isRegisteredEmployeeGuestPrincipal({
        ...user,
        authMode,
        employeeId: user.employeeId || employeeId,
        canonicalRole: user.role
      })
    )
  );
  const canonicalRole = user?.role || null;
  const guestProvisional = authMode === 'employee_guest'
    && (provisional || !registered);
  const actor = {
    ...(user || {}),
    userId: user?.userId || null,
    employeeId: user?.employeeId || employeeId || null,
    lineUserId: user?.lineUserId || lineUserId || null,
    displayName: user?.displayName || displayName || '',
    registered,
    provisional: guestProvisional,
    requiresEmployeeBinding,
    verificationStatus,
    canonicalRole,
    // Employee-only authentication never becomes an elevated principal.
    role: authMode === 'employee_guest' ? 'User' : (canonicalRole || 'User'),
    authMode
  };
  actor.capabilities = capabilitiesFor(
    actor.role,
    authMode,
    active,
    actor.employeeId,
    requiresEmployeeBinding
  );
  actor.identityState = identityStateFor(actor);
  return actor;
};

export const resolveLineIdentity = async (
  request,
  database,
  fetchImpl = globalThis.fetch,
  clock = new Date()
) => {
  const token = bearerToken(request);
  if (!token) throw unauthorized();
  const profile = await fetchLineProfile(token, fetchImpl);
  let user = await getUserByLineId(database, profile.lineUserId);
  if (await hasAnyProtectedEmployeeId(database, user?.employeeId)) {
    user = await requireProtectedLineOwner(database, profile.lineUserId, clock);
  }
  if (user?.invalidReason === 'INVALID_EMPLOYEE_ID') {
    throw forbidden('INVALID_EMPLOYEE_ID');
  }
  return {
    token,
    profile,
    user,
    actor: actorFromUser(user, {
      authMode: 'line',
      displayName: profile.displayName,
      lineUserId: profile.lineUserId
    })
  };
};

const viewAsTarget = (url) => (
  url.searchParams.get('viewAsUserId')?.trim()
  || url.searchParams.get('viewAs')?.trim()
  || ''
);

// An older unbound guest token may outlive the canonical user created by a
// prior onboarding attempt. Resolve only the matching active user. Employee
// authentication is intentionally independent from persistent LINE ownership.
const resolveGuestCanonicalUser = async (database, guest) => {
  if (!guest?.provisional || guest.user || !guest.employeeId) return guest?.user || null;
  const user = await getUserByEmployeeId(database, guest.employeeId);
  if (user?.invalidReason === 'INVALID_EMPLOYEE_ID') {
    throw forbidden('INVALID_EMPLOYEE_ID');
  }
  if (!user
    || !user.active) {
    return null;
  }
  return user;
};

export const resolveCanonicalIdentity = async (
  request,
  env,
  fetchImpl = globalThis.fetch,
  { allowViewAs = false, now = new Date() } = {}
) => {
  const token = bearerToken(request);
  if (!token) throw unauthorized();
  if (!env?.DB || typeof env.DB.prepare !== 'function') {
    throw new Error('D1 binding is unavailable.');
  }

  const guest = await inspectGuestSession(env.DB, token, { now });
  if (isGuestToken(token)) {
    if (viewAsTarget(new URL(request.url))) throw forbidden('VIEW_AS_FORBIDDEN');
    if (!guest?.normal) throw unauthorized('GUEST_SESSION_INVALID');
    if (await hasAnyProtectedEmployeeId(env.DB,
      guest.employeeId,
      guest.session?.employeeId,
      guest.user?.employeeId
    )) {
      return denyProtectedAccountAccess(env.DB, {
        authMode: 'employee_guest',
        reason: 'GUEST_SESSION_FOR_PROTECTED_ACCOUNT',
        clock: now
      });
    }
    if (guest?.provisional) {
      const canonicalUser = await resolveGuestCanonicalUser(env.DB, guest);
      if (canonicalUser && canonicalUser.role !== 'User') {
        throw forbidden('ADMIN_LINE_AUTH_REQUIRED');
      }
      const actor = actorFromUser(canonicalUser, {
        authMode: 'employee_guest',
        employeeId: guest.employeeId,
        provisional: !canonicalUser
      });
      return {
        actor,
        authorizationActor: actor,
        effectiveSubject: actor,
        viewAs: null,
        guestSession: guest.session
      };
    }
    if (guest.user && guest.user.role !== 'User') {
      throw forbidden('ADMIN_LINE_AUTH_REQUIRED');
    }
    const actor = actorFromUser(guest.user, { authMode: 'employee_guest' });
    return {
      actor,
      authorizationActor: actor,
      effectiveSubject: actor,
      viewAs: null,
      guestSession: guest.session
    };
  }

  const line = await resolveLineIdentity(request, env.DB, fetchImpl, now);
  const actor = line.actor;
  const url = new URL(request.url);
  const requestedTarget = viewAsTarget(url);

  if (!requestedTarget) {
    return {
      actor,
      authorizationActor: actor,
      effectiveSubject: actor,
      viewAs: null
    };
  }

  if (!allowViewAs || !isRegisteredLinePrincipal(actor)
    || actor.authMode !== 'line'
    || !actor.capabilities.includes('VIEW_AS')) {
    throw forbidden('VIEW_AS_FORBIDDEN');
  }
  const effectiveUser = await getUserById(env.DB, requestedTarget);
  if (!effectiveUser) throw forbidden('VIEW_AS_TARGET_NOT_FOUND');
  if (await hasAnyProtectedEmployeeId(env.DB, effectiveUser.employeeId)) {
    await appendAuditEvent(env.DB, {
      actorUserId: actor.userId,
      actorAuthMode: actor.authMode,
      actorEmployeeIdSnapshot: null,
      actorLineUserIdSnapshot: null,
      targetUserId: null,
      targetEmployeeIdSnapshot: null,
      targetLineUserIdSnapshot: null,
      action: 'PROTECTED_ACCOUNT_VIEW_AS_DENIED',
      metadata: { reason: 'PROTECTED_ACCOUNT_VIEW_AS_FORBIDDEN' },
      occurredAt: new Date(now).toISOString()
    });
    await denyProtectedAccountAccess(env.DB, {
      authMode: 'line',
      reason: 'PROTECTED_ACCOUNT_VIEW_AS_BLOCKED',
      clock: now
    });
  }
  const effectiveSubject = actorFromUser(effectiveUser, { authMode: 'line' });

  return {
    actor,
    authorizationActor: actor,
    effectiveSubject,
    viewAs: {
      targetUserId: effectiveSubject.userId,
      actorUserId: actor.userId
    }
  };
};

export { bearerToken };
