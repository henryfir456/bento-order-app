import { requireIdentity } from '../http/authMiddleware.js';
import { badRequest, forbidden } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import {
  approveReimbursement,
  createReimbursement,
  getAutoReimbursementSetting,
  listAdminReimbursements,
  listMyReimbursements,
  previewReimbursement,
  rejectReimbursement,
  updateAutoReimbursementSetting
} from '../domain/reimbursements.js';

const readBody = async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
    return value;
  } catch {
    throw badRequest('INVALID_JSON');
  }
};

export const handleReimbursementRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const decide = method === 'POST'
    ? pathname.match(/^\/api\/admin\/reimbursements\/([^/]+)\/(approve|reject)$/)
    : null;
  const isMine = pathname === '/api/me/reimbursements';
  const isPreview = method === 'GET' && pathname === '/api/me/reimbursements/preview';
  const isAdminList = method === 'GET' && pathname === '/api/admin/reimbursements';
  const isAuto = pathname === '/api/admin/reimbursements/auto-setting'
    && (method === 'GET' || method === 'PUT');
  if (!decide && !isAuto && !(isMine && (method === 'GET' || method === 'POST')) && !isPreview && !isAdminList) {
    return null;
  }

  const identity = await requireIdentity(request, env, { fetchImpl, allowViewAs: false, now });
  if (!identity.actor?.registered || !identity.actor.userId) throw forbidden('NOT_REGISTERED');

  if (isAuto) {
    if (method === 'GET') return jsonResponse(await getAutoReimbursementSetting(env.DB, identity));
    return jsonResponse(await updateAutoReimbursementSetting(env.DB, identity, await readBody(request), now));
  }
  if (isPreview) {
    return jsonResponse(await previewReimbursement(env.DB, identity, url.searchParams.get('date'), now));
  }
  if (isMine && method === 'GET') return jsonResponse(await listMyReimbursements(env.DB, identity));
  if (isMine) {
    return jsonResponse(await createReimbursement(env.DB, identity, await readBody(request), now));
  }
  if (isAdminList) {
    return jsonResponse(await listAdminReimbursements(env.DB, identity, url.searchParams.get('status')));
  }
  let requestId;
  try { requestId = decodeURIComponent(decide[1]).trim(); } catch { throw badRequest('REIMBURSEMENT_ID_INVALID'); }
  if (!requestId) throw badRequest('REIMBURSEMENT_ID_INVALID');
  if (decide[2] === 'approve') {
    return jsonResponse(await approveReimbursement(env.DB, identity, requestId, now));
  }
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  return jsonResponse(await rejectReimbursement(env.DB, identity, requestId, body || {}, now));
};
