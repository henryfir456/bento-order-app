import { resolveLineIdentity } from '../auth/identity.js';
import {
  employeeGuestLogin,
  completeEmployeeGuestOnboarding,
  lineEmployeeBind,
  lineEmployeeLookup,
  bindLineIdentity
} from '../domain/guestAccess.js';
import { isVendorCodeLoginEnabled, vendorCodeLogin, vendorLoginCode } from '../auth/vendorCodeLogin.js';
import {
  assertLoginNotThrottled,
  loginAttemptKey,
  recordLoginFailure
} from '../auth/loginThrottle.js';
import { badRequest, HttpError, unauthorized } from '../http/errors.js';
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
  const isGuestOnboarding = request.method === 'POST'
    && url.pathname === '/api/auth/employee-guest/onboarding';
  const isLineBind = request.method === 'POST'
    && url.pathname === '/api/auth/line-bind';
  const isLineEmployeeLookup = request.method === 'POST'
    && url.pathname === '/api/auth/line-employee-lookup';
  const isLineEmployeeBind = request.method === 'POST'
    && url.pathname === '/api/auth/line-employee-bind';
  if (!isGuestLogin && !isGuestOnboarding && !isLineBind && !isLineEmployeeLookup && !isLineEmployeeBind) return null;

  if (isGuestLogin) {
    const body = await readJson(request);
    const attemptKey = loginAttemptKey(request);
    await assertLoginNotThrottled(env.DB, attemptKey, now);
    try {
      if (isVendorCodeLoginEnabled(env) && vendorLoginCode(body.employeeId)) {
        return jsonResponse(await vendorCodeLogin(env.DB, body.employeeId, now), 201);
      }
      const result = await employeeGuestLogin(env.DB, body.employeeId, now);
      // An unknown employee ID is the guessing signal; a known one is not.
      if (result.status === 'UNVERIFIED_EMPLOYEE') {
        await recordLoginFailure(env.DB, attemptKey, now);
      }
      return jsonResponse(
        result,
        result.status === 'UNVERIFIED_EMPLOYEE' ? 200 : 201
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 403) {
        await recordLoginFailure(env.DB, attemptKey, now);
      }
      throw error;
    }
  }

  if (isGuestOnboarding) {
    const guestToken = request.headers.get('X-Employee-Guest-Session')?.trim() || '';
    if (!guestToken) throw unauthorized('GUEST_SESSION_INVALID');
    const result = await completeEmployeeGuestOnboarding(env.DB, {
      guestToken,
      ...await readJson(request),
      clock: now
    });
    return jsonResponse(result);
  }

  if (isLineEmployeeLookup || isLineEmployeeBind) {
    const line = await resolveLineIdentity(request, env.DB, fetchImpl, now, {
      channelId: env.LINE_CHANNEL_ID
    });
    const body = await readJson(request);
    const result = isLineEmployeeLookup
      ? await lineEmployeeLookup(env.DB, {
        employeeId: body.employeeId,
        lineUserId: line.profile.lineUserId,
        clock: now
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
  const line = await resolveLineIdentity(request, env.DB, fetchImpl, now, {
      channelId: env.LINE_CHANNEL_ID
    });
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
