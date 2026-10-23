import { requireIdentity } from '../http/authMiddleware.js';
import { forbidden, badRequest } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { getUserNotifications, markUserNotificationRead } from '../domain/userNotifications.js';

export const handleUserNotificationRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isList = request.method === 'GET' && url.pathname === '/api/me/notifications';
  const readMatch = request.method === 'POST'
    ? url.pathname.match(/^\/api\/me\/notifications\/([^/]+)\/read$/)
    : null;
  if (!isList && !readMatch) return null;

  const identity = await requireIdentity(request, env, { fetchImpl, allowViewAs: false, now });
  if (!identity.actor?.registered || !identity.actor.userId) throw forbidden('NOT_REGISTERED');
  if (isList) return jsonResponse(await getUserNotifications(env.DB, identity));
  let id;
  try { id = decodeURIComponent(readMatch[1]).trim(); } catch { throw badRequest('NOTIFICATION_ID_INVALID'); }
  if (!id) throw badRequest('NOTIFICATION_ID_INVALID');
  return jsonResponse(await markUserNotificationRead(env.DB, identity, id, now));
};
