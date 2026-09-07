import { getUserByLineId } from '../db/users.js';
import { forbidden, unauthorized } from '../http/errors.js';
import { fetchLineProfile } from './lineProfile.js';

const bearerToken = (request) => {
  const header = request?.headers?.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

const actorFromProfile = (profile, user) => ({
  lineUserId: profile.lineUserId,
  displayName: user?.displayName || profile.displayName,
  registered: Boolean(user),
  ...(user || {})
});

export const resolveCanonicalIdentity = async (
  request,
  env,
  fetchImpl = globalThis.fetch,
  { allowViewAs = false } = {}
) => {
  const token = bearerToken(request);
  if (!token) throw unauthorized();
  if (!env?.DB || typeof env.DB.prepare !== 'function') {
    throw new Error('D1 binding is unavailable.');
  }

  const profile = await fetchLineProfile(token, fetchImpl);
  const actorUser = await getUserByLineId(env.DB, profile.lineUserId);
  const actor = actorFromProfile(profile, actorUser);
  const url = new URL(request.url);
  const viewAsLineUserId = url.searchParams.get('viewAs')?.trim() || '';

  if (!viewAsLineUserId) {
    return {
      actor,
      authorizationActor: actor,
      effectiveSubject: actor,
      viewAs: null
    };
  }

  if (!allowViewAs || !actor.registered || actor.role !== 'Admin') {
    throw forbidden('VIEW_AS_FORBIDDEN');
  }
  const effectiveUser = await getUserByLineId(env.DB, viewAsLineUserId);
  if (!effectiveUser) throw forbidden('VIEW_AS_TARGET_NOT_FOUND');

  return {
    actor,
    authorizationActor: actor,
    effectiveSubject: effectiveUser,
    viewAs: {
      targetLineUserId: effectiveUser.lineUserId,
      actorLineUserId: actor.lineUserId
    }
  };
};

export { bearerToken };
