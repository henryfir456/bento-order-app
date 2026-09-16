import { ACTIONS, assertCan } from '../auth/permissions.js';
import {
  getVendor,
  listVendors,
  updateVendor
} from '../domain/vendors.js';
import { badRequest, forbidden } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { requireIdentity } from '../http/authMiddleware.js';

const readJson = async (request) => {
  if (!request.body) throw badRequest('INVALID_JSON');
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
    return value;
  } catch {
    throw badRequest('INVALID_JSON');
  }
};

const vendorIdFromPath = (pathname, pattern) => {
  const match = pathname.match(pattern);
  if (!match) return null;
  let vendorId;
  try {
    vendorId = decodeURIComponent(match[1]).trim();
  } catch {
    throw badRequest('VENDOR_ID_INVALID');
  }
  if (!vendorId) throw badRequest('VENDOR_ID_REQUIRED');
  return vendorId;
};

const requireRegisteredRead = (identity) => {
  if (!identity?.actor?.registered) throw forbidden('NOT_REGISTERED');
  assertCan(identity, ACTIONS.READ_SELF);
};

export const handleVendorRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isList = request.method === 'GET' && url.pathname === '/api/vendors';
  const detailId = request.method === 'GET'
    ? vendorIdFromPath(url.pathname, /^\/api\/vendors\/([^/]+)$/)
    : null;
  const updateId = request.method === 'PATCH'
    ? vendorIdFromPath(url.pathname, /^\/api\/admin\/vendors\/([^/]+)$/)
    : null;
  if (!isList && detailId === null && updateId === null) return null;

  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: updateId === null,
    now
  });

  if (isList) {
    requireRegisteredRead(identity);
    return jsonResponse(await listVendors(env.DB, { now }));
  }
  if (detailId !== null) {
    requireRegisteredRead(identity);
    return jsonResponse(await getVendor(env.DB, detailId, { now }));
  }
  return jsonResponse(await updateVendor(
    env.DB,
    identity,
    updateId,
    await readJson(request),
    now
  ));
};
