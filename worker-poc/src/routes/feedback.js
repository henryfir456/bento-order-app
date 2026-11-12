import { requireIdentity } from '../http/authMiddleware.js';
import { badRequest } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import {
  createFeedback,
  deleteFeedback,
  listAdminFeedback,
  listMyFeedback,
  updateFeedbackStatus
} from '../domain/feedback.js';

const readBody = async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
    return value;
  } catch {
    throw badRequest('INVALID_JSON');
  }
};

export const handleFeedbackRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  const isMine = pathname === '/api/me/feedback' && (method === 'GET' || method === 'POST');
  const isAdminList = method === 'GET' && pathname === '/api/admin/feedback';
  const statusMatch = method === 'POST'
    ? pathname.match(/^\/api\/admin\/feedback\/([^/]+)\/status$/)
    : null;
  const deleteMatch = method === 'DELETE' ? pathname.match(/^\/api\/admin\/feedback\/([^/]+)$/) : null;
  if (!isMine && !isAdminList && !statusMatch && !deleteMatch) return null;

  // Feedback is never written on behalf of someone else, so View-As is off.
  const identity = await requireIdentity(request, env, { fetchImpl, allowViewAs: false, now });
  if (isMine && method === 'GET') return jsonResponse(await listMyFeedback(env.DB, identity));
  if (isMine) return jsonResponse(await createFeedback(env.DB, identity, await readBody(request), now));
  if (isAdminList) {
    return jsonResponse(await listAdminFeedback(env.DB, identity, {
      status: url.searchParams.get('status'),
      category: url.searchParams.get('category')
    }));
  }
  const idMatch = statusMatch || deleteMatch;
  let feedbackId;
  try { feedbackId = decodeURIComponent(idMatch[1]).trim(); } catch { throw badRequest('FEEDBACK_ID_INVALID'); }
  if (!feedbackId) throw badRequest('FEEDBACK_ID_INVALID');
  if (deleteMatch) return jsonResponse(await deleteFeedback(env.DB, identity, feedbackId, now));
  return jsonResponse(await updateFeedbackStatus(env.DB, identity, feedbackId, await readBody(request), now));
};
