import { getUserById, getUserByLineId } from '../db/users.js';
import { forbidden, unauthorized } from '../http/errors.js';
import { fetchLineProfile } from './lineProfile.js';
import { inspectGuestSession, isGuestToken } from './guestSession.js';

const bearerToken = (request) => {
  const header = request?.headers?.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const actorFromUser = (
  user,
  { authMode = 'line', displayName = '', lineUserId = null } = {}
) => ({
  userId: user?.userId || null,
  employeeId: user?.employeeId || null,
  lineUserId: user?.lineUserId || lineUserId || null,
  displayName: user?.displayName || displayName || '',
  registered: Boolean(user),
  ...(user || {}),
  authMode
});

export const resolveLineIdentity = async (
  request,
  database,
  fetchImpl = globalThis.fetch
) => {
  const token = bearerToken(request);
  if (!token) throw unauthorized();
  const profile = await fetchLineProfile(token, fetchImpl);
  const user = await getUserByLineId(database, profile.lineUserId);
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
    if (!guest?.normal) throw unauthorized('GUEST_SESSION_INVALID');
    if (viewAsTarget(new URL(request.url))) throw forbidden('VIEW_AS_FORBIDDEN');
    const actor = actorFromUser(guest.user, { authMode: 'employee_guest' });
    return {
      actor,
      authorizationActor: actor,
      effectiveSubject: actor,
      viewAs: null
    };
  }

  const line = await resolveLineIdentity(request, env.DB, fetchImpl);
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

  if (!allowViewAs || !actor.registered || actor.authMode !== 'line' || actor.role !== 'Admin') {
    throw forbidden('VIEW_AS_FORBIDDEN');
  }
  const effectiveUser = await getUserById(env.DB, requestedTarget);
  if (!effectiveUser) throw forbidden('VIEW_AS_TARGET_NOT_FOUND');
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
