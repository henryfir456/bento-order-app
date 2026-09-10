import { resolveLineIdentity } from '../auth/identity.js';
import { employeeGuestLogin, bindLineIdentity } from '../domain/guestAccess.js';
import { badRequest, unauthorized } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';

const readJson = async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
    return value;
  } catch {
    throw badRequest('INVALID_JSON');
  }
};

export const handleAuthRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isGuestLogin = request.method === 'POST'
    && url.pathname === '/api/auth/employee-guest';
  const isLineBind = request.method === 'POST'
    && url.pathname === '/api/auth/line-bind';
  if (!isGuestLogin && !isLineBind) return null;

  if (isGuestLogin) {
    const body = await readJson(request);
    return jsonResponse(await employeeGuestLogin(env.DB, body.employeeId, now), 201);
  }

  const guestToken = request.headers.get('X-Employee-Guest-Session')?.trim() || '';
  if (!guestToken) throw unauthorized('GUEST_SESSION_INVALID');
  const line = await resolveLineIdentity(request, env.DB, fetchImpl);
  return jsonResponse(await bindLineIdentity(env.DB, {
    guestToken,
    lineUserId: line.profile.lineUserId,
    lineDisplayName: line.profile.displayName,
    clock: now
  }));
};
