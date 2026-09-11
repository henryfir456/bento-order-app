import { resolveLineIdentity } from '../auth/identity.js';
import {
  employeeGuestLogin,
  lineEmployeeBind,
  lineEmployeeLookup,
  bindLineIdentity
} from '../domain/guestAccess.js';
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

const readOptionalJson = async (request) => {
  if (!request.headers.get('content-type') && !request.headers.get('content-length')) {
    return {};
  }
  return readJson(request);
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
  const isLineEmployeeLookup = request.method === 'POST'
    && url.pathname === '/api/auth/line-employee-lookup';
  const isLineEmployeeBind = request.method === 'POST'
    && url.pathname === '/api/auth/line-employee-bind';
  if (!isGuestLogin && !isLineBind && !isLineEmployeeLookup && !isLineEmployeeBind) return null;

  if (isGuestLogin) {
    const body = await readJson(request);
    const result = await employeeGuestLogin(env.DB, body.employeeId, now);
    return jsonResponse(
      result,
      result.status === 'UNVERIFIED_EMPLOYEE' ? 200 : 201
    );
  }

  if (isLineEmployeeLookup || isLineEmployeeBind) {
    const line = await resolveLineIdentity(request, env.DB, fetchImpl);
    const body = await readJson(request);
    const result = isLineEmployeeLookup
      ? await lineEmployeeLookup(env.DB, {
        employeeId: body.employeeId,
        lineUserId: line.profile.lineUserId
      })
      : await lineEmployeeBind(env.DB, {
        employeeId: body.employeeId,
        lineUserId: line.profile.lineUserId,
        lineDisplayName: line.profile.displayName,
        displayName: body.displayName,
        pickupFloor: body.pickupFloor,
        clock: now
      });
    return jsonResponse(result);
  }

  const guestToken = request.headers.get('X-Employee-Guest-Session')?.trim() || '';
  if (!guestToken) throw unauthorized('GUEST_SESSION_INVALID');
  const line = await resolveLineIdentity(request, env.DB, fetchImpl);
  const body = await readOptionalJson(request);
  return jsonResponse(await bindLineIdentity(env.DB, {
    guestToken,
    lineUserId: line.profile.lineUserId,
    lineDisplayName: line.profile.displayName,
    displayName: body.displayName,
    pickupFloor: body.pickupFloor,
    clock: now
  }));
};
