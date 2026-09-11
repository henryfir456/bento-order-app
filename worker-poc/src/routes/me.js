import { requireIdentity } from '../http/authMiddleware.js';
import { jsonResponse } from '../http/response.js';
import { getMe, registerUser, updatePickupFloor } from '../domain/users.js';
import { badRequest } from '../http/errors.js';

const readJson = async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('body');
    }
    return value;
  } catch {
    throw badRequest('INVALID_JSON');
  }
};

export const handleMeRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isMeRoute = (
    (request.method === 'GET' && url.pathname === '/api/me')
    || (request.method === 'POST' && url.pathname === '/api/register')
    || (request.method === 'PATCH' && url.pathname === '/api/me/pickup-floor')
  );
  if (!isMeRoute) return null;
  const identity = await requireIdentity(request, env, { fetchImpl, now });

  if (request.method === 'GET' && url.pathname === '/api/me') {
    return jsonResponse(getMe(identity));
  }
  if (request.method === 'POST' && url.pathname === '/api/register') {
    return jsonResponse(await registerUser(env.DB, identity, await readJson(request), now), 201);
  }
  if (request.method === 'PATCH' && url.pathname === '/api/me/pickup-floor') {
    const body = await readJson(request);
    return jsonResponse(await updatePickupFloor(
      env.DB,
      identity,
      body.pickupFloor,
      now,
      body.displayName
    ));
  }
  return null;
};
