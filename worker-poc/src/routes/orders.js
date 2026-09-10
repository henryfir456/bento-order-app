import { requireIdentity } from '../http/authMiddleware.js';
import { badRequest } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { cancelOrder, createOrReplaceOrder } from '../domain/orders.js';

const readJson = async (request) => {
  if (!request.body) return {};
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

const idempotencyKey = (request, body) => (
  request.headers.get('Idempotency-Key')?.trim()
  || body.idempotencyKey
  || body.idempotency_key
  || ''
);

const orderIdFromCancelPath = (pathname) => {
  const match = pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (!match) return null;
  try {
    const orderId = decodeURIComponent(match[1]).trim();
    return orderId || null;
  } catch {
    throw badRequest('ORDER_ID_INVALID');
  }
};

export const handleOrderRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isCreate = request.method === 'POST' && url.pathname === '/api/orders';
  const cancelId = request.method === 'POST' ? orderIdFromCancelPath(url.pathname) : null;
  if (!isCreate && !cancelId) return null;

  const identity = await requireIdentity(request, env, { fetchImpl, allowViewAs: false });
  const body = isCreate ? await readJson(request) : {};
  const key = idempotencyKey(request, body);

  if (isCreate) {
    return jsonResponse(await createOrReplaceOrder(
      env.DB,
      identity,
      { ...body, idempotencyKey: key },
      now
    ));
  }

  return jsonResponse(await cancelOrder(env.DB, identity, cancelId, key, now));
};
