import { requireIdentity } from '../http/authMiddleware.js';
import { forbidden, badRequest } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import {
  dismissAnnouncementAutoPopup,
  getAnnouncementInbox,
  markAnnouncementRead
} from '../domain/announcementInbox.js';

const announcementActionFromPath = (pathname, method) => {
  if (method !== 'POST') return null;
  const match = pathname.match(/^\/api\/me\/announcements\/([^/]+)\/(read|dismiss)$/);
  if (!match) return null;
  let id;
  try {
    id = decodeURIComponent(match[1]).trim();
  } catch {
    throw badRequest('ANNOUNCEMENT_ID_INVALID');
  }
  if (!id) throw badRequest('ANNOUNCEMENT_ID_REQUIRED');
  return { id, action: match[2] };
};

export const handleAnnouncementInboxRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isList = request.method === 'GET' && url.pathname === '/api/me/announcements';
  const action = announcementActionFromPath(url.pathname, request.method);
  if (!isList && !action) return null;

  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: false,
    now
  });
  if (!identity.actor?.registered || !identity.actor.userId) throw forbidden('NOT_REGISTERED');

  if (isList) return jsonResponse(await getAnnouncementInbox(env.DB, identity, now));
  const result = action.action === 'read'
    ? await markAnnouncementRead(env.DB, identity, action.id, now)
    : await dismissAnnouncementAutoPopup(env.DB, identity, action.id, now);
  return jsonResponse(result);
};
