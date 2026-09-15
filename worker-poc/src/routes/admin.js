import { getAdminSummary, getMemberBalances } from '../domain/adminSummary.js';
import { adminBindEmployee } from '../domain/adminIdentity.js';
import {
  createAnnouncement,
  deleteAnnouncement,
  getAdminAnnouncements,
  updateAnnouncement
} from '../domain/announcements.js';
import {
  createAdminMenuItemChange,
  getAdminMenuItemPreview,
  listAdminMenuItemChanges,
  listAdminMenuVendors
} from '../domain/menuItemChanges.js';
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
  const bindingMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/employee-binding$/);
  const isEmployeeBinding = request.method === 'POST' && Boolean(bindingMatch);
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
  const isMenuChangeList = request.method === 'GET'
    && url.pathname === '/api/admin/menu/changes';
  const isMenuChangeCreate = request.method === 'POST'
    && url.pathname === '/api/admin/menu/changes';
  const isMenuPreview = request.method === 'GET'
    && url.pathname === '/api/admin/menu/preview';
  const isMenuVendorList = request.method === 'GET'
    && url.pathname === '/api/admin/menu/vendors';
  const isMenuRoute = isMenuChangeList || isMenuChangeCreate || isMenuPreview || isMenuVendorList;
  if (!isSummary && !isMembers && !isEmployeeBinding && !isAnnouncementList && !isAnnouncementCreate
    && !isAnnouncementUpdate && !isAnnouncementDelete && !isAnnouncementMissingId
    && !isMenuChangeList && !isMenuChangeCreate && !isMenuPreview && !isMenuVendorList) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: !isAnnouncementRoute && !isMenuRoute && !isEmployeeBinding,
    now
  });
  if (isAnnouncementMissingId) throw badRequest('ANNOUNCEMENT_ID_REQUIRED');
  if (isEmployeeBinding) {
    let targetUserId;
    try {
      targetUserId = decodeURIComponent(bindingMatch[1]).trim();
    } catch {
      throw badRequest('USER_ID_INVALID');
    }
    if (!targetUserId) throw badRequest('USER_ID_REQUIRED');
    return jsonResponse(await adminBindEmployee(
      env.DB,
      identity,
      targetUserId,
      await readJson(request),
      now
    ));
  }
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
  if (isMenuChangeList) {
    return jsonResponse(await listAdminMenuItemChanges(env.DB, identity, {
      vendor: url.searchParams.get('vendor') || '',
      itemCode: url.searchParams.get('itemCode') || url.searchParams.get('item_code') || '',
      variantKey: url.searchParams.get('variantKey') || url.searchParams.get('variant_key') || '',
      query: url.searchParams.get('q') || url.searchParams.get('query') || '',
      fromDate: url.searchParams.get('fromDate') || url.searchParams.get('from_date') || '',
      toDate: url.searchParams.get('toDate') || url.searchParams.get('to_date') || '',
      month: url.searchParams.get('month') || ''
    }));
  }
  if (isMenuChangeCreate) {
    return jsonResponse(await createAdminMenuItemChange(
      env.DB,
      identity,
      await readJson(request),
      now
    ), 201);
  }
  if (isMenuPreview) {
    return jsonResponse(await getAdminMenuItemPreview(env.DB, identity, {
      vendor: url.searchParams.get('vendor') || '',
      targetDate: url.searchParams.get('targetDate') || url.searchParams.get('date') || ''
    }));
  }
  if (isMenuVendorList) {
    return jsonResponse(await listAdminMenuVendors(env.DB, identity));
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
