import { requireIdentity } from '../http/authMiddleware.js';
import { forbidden, badRequest } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { getUserNotifications, markUserNotificationRead } from '../domain/userNotifications.js';
import { getReminderSettings, updateReminderSettings } from '../domain/orderReminders.js';

export const handleUserNotificationRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isList = request.method === 'GET' && url.pathname === '/api/me/notifications';
  const readMatch = request.method === 'POST'
    ? url.pathname.match(/^\/api\/me\/notifications\/([^/]+)\/read$/)
    : null;
  const isReminderGet = request.method === 'GET' && url.pathname === '/api/me/reminder-settings';
  const isReminderPut = request.method === 'PUT' && url.pathname === '/api/me/reminder-settings';
  if (!isList && !readMatch && !isReminderGet && !isReminderPut) return null;

  const identity = await requireIdentity(request, env, { fetchImpl, allowViewAs: false, now });
  if (!identity.actor?.registered || !identity.actor.userId) throw forbidden('NOT_REGISTERED');
  if (isReminderGet) return jsonResponse(await getReminderSettings(env.DB, identity));
  if (isReminderPut) {
    let body;
    try { body = await request.json(); } catch { throw badRequest('INVALID_JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('INVALID_JSON');
    return jsonResponse(await updateReminderSettings(env.DB, identity, body, now));
  }
  if (isList) return jsonResponse(await getUserNotifications(env.DB, identity));
  let id;
  try { id = decodeURIComponent(readMatch[1]).trim(); } catch { throw badRequest('NOTIFICATION_ID_INVALID'); }
  if (!id) throw badRequest('NOTIFICATION_ID_INVALID');
  return jsonResponse(await markUserNotificationRead(env.DB, identity, id, now));
};
