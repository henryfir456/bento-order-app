import { getAdminSummary, getMemberBalances } from '../domain/adminSummary.js';
import {
  createAnnouncement,
  deleteAnnouncement,
  getAdminAnnouncements,
  updateAnnouncement
} from '../domain/announcements.js';
import { badRequest } from '../http/errors.js';
import { emptyResponse, jsonResponse } from '../http/response.js';
import { requireIdentity } from '../http/authMiddleware.js';

const asBoolean = (value) => value === true || String(value).toLowerCase() === 'true';

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

const announcementIdFromPath = (pathname, method) => {
  if (!['PATCH', 'DELETE'].includes(method)) return null;
  const match = pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);
  if (!match) return null;
  let id;
  try {
    id = decodeURIComponent(match[1]).trim();
  } catch {
    throw badRequest('ANNOUNCEMENT_ID_INVALID');
  }
  if (!id) throw badRequest('ANNOUNCEMENT_ID_REQUIRED');
  return id;
};

export const handleAdminRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isSummary = request.method === 'GET' && url.pathname === '/api/admin/summary';
  const isMembers = request.method === 'GET' && url.pathname === '/api/admin/members/balances';
  const isAnnouncementList = request.method === 'GET'
    && url.pathname === '/api/admin/announcements';
  const isAnnouncementCreate = request.method === 'POST'
    && url.pathname === '/api/admin/announcements';
  const isAnnouncementMutation = ['PATCH', 'DELETE'].includes(request.method);
  const isAnnouncementMissingId = isAnnouncementMutation
    && url.pathname === '/api/admin/announcements/';
  const announcementId = announcementIdFromPath(url.pathname, request.method);
  const isAnnouncementUpdate = request.method === 'PATCH' && announcementId !== null;
  const isAnnouncementDelete = request.method === 'DELETE' && announcementId !== null;
  const isAnnouncementRoute = isAnnouncementList || isAnnouncementCreate
    || isAnnouncementUpdate || isAnnouncementDelete || isAnnouncementMissingId;
  if (!isSummary && !isMembers && !isAnnouncementList && !isAnnouncementCreate
    && !isAnnouncementUpdate && !isAnnouncementDelete && !isAnnouncementMissingId) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: !isAnnouncementRoute,
    now
  });
  if (isAnnouncementMissingId) throw badRequest('ANNOUNCEMENT_ID_REQUIRED');
  if (isAnnouncementList) {
    return jsonResponse(await getAdminAnnouncements(env.DB, identity));
  }
  if (isAnnouncementCreate) {
    return jsonResponse(await createAnnouncement(
      env.DB,
      identity,
      await readJson(request),
      now
    ), 201);
  }
  if (isAnnouncementUpdate) {
    return jsonResponse(await updateAnnouncement(
      env.DB,
      identity,
      announcementId,
      await readJson(request),
      now
    ));
  }
  if (isAnnouncementDelete) {
    await deleteAnnouncement(env.DB, identity, announcementId, now);
    return emptyResponse();
  }
  if (isMembers) return jsonResponse(await getMemberBalances(env.DB, identity, now));
  return jsonResponse(await getAdminSummary(
    env.DB,
    identity,
    url.searchParams.get('date') || url.searchParams.get('targetDate') || '',
    {
      includeMemberBalances: asBoolean(url.searchParams.get('includeMemberBalances')),
      now
    }
  ));
};
