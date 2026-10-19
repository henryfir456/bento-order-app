import { getAdminSummary, getMemberBalances } from '../domain/adminSummary.js';
import { getBalanceHistory } from '../domain/ledger.js';
import { getUserById, currentBalanceProjection } from '../db/users.js';
import { appendAuditEvent, auditStatement } from '../db/audit.js';
import { prepareStatement, runMutationBatch } from '../db/transactions.js';
import { notFound } from '../http/errors.js';
import { adminBindEmployee } from '../domain/adminIdentity.js';
import {
  getInvalidEmployeeRepairPreview,
  listInvalidEmployeeRepairs,
  repairInvalidEmployeeIdentity
} from '../domain/invalidEmployeeRepair.js';
import {
  getLineBindingTransferPreview,
  transferLineBinding
} from '../domain/lineBindingTransfer.js';
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
import { ACTIONS, assertCan } from '../auth/permissions.js';
import {
  getDailyFlavorSyncStatus,
  runCaiTeacherDailyFlavorSync
} from '../domain/dailyFlavors.js';

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
  const invalidRepairPreviewMatch = request.method === 'GET'
    && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/invalid-employee-repair-preview$/);
  const invalidRepairMatch = request.method === 'POST'
    && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/invalid-employee-repair$/);
  const isInvalidRepairPreview = Boolean(invalidRepairPreviewMatch);
  const isInvalidRepair = Boolean(invalidRepairMatch);
  const isInvalidRepairAudit = request.method === 'GET'
    && url.pathname === '/api/admin/invalid-employee-repairs';
  const isInvalidRepairRoute = isInvalidRepairPreview || isInvalidRepair || isInvalidRepairAudit;
  const ledgerMatch = request.method === 'GET' && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/ledger$/);
  const isUserLedger = Boolean(ledgerMatch);
  const nameMatch = request.method === 'PATCH' && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/name$/);
  const isNameUpdate = Boolean(nameMatch);
  const bindingMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/employee-binding$/);
  const isEmployeeBinding = request.method === 'POST' && Boolean(bindingMatch);
  const lineBindingTransferPreviewMatch = request.method === 'GET'
    && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/line-binding-transfer-preview$/);
  const isLineBindingTransferPreview = Boolean(lineBindingTransferPreviewMatch);
  const lineBindingTransferMatch = request.method === 'POST'
    && url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/line-binding-transfer$/);
  const isLineBindingTransfer = Boolean(lineBindingTransferMatch);
  const isLineBindingTransferRoute = isLineBindingTransferPreview || isLineBindingTransfer;
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
  const isDailyFlavorStatus = request.method === 'GET'
    && url.pathname === '/api/admin/daily-flavors/sync-status';
  const isDailyFlavorSync = request.method === 'POST'
    && url.pathname === '/api/admin/daily-flavors/sync';
  const isDailyFlavorRoute = isDailyFlavorStatus || isDailyFlavorSync;
  if (!isSummary && !isMembers && !isInvalidRepairRoute && !isUserLedger && !isNameUpdate && !isEmployeeBinding && !isLineBindingTransferRoute && !isAnnouncementList && !isAnnouncementCreate
    && !isAnnouncementUpdate && !isAnnouncementDelete && !isAnnouncementMissingId
    && !isMenuChangeList && !isMenuChangeCreate && !isMenuPreview && !isMenuVendorList
    && !isDailyFlavorRoute) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: !isUserLedger && !isNameUpdate && !isAnnouncementRoute && !isMenuRoute && !isEmployeeBinding && !isLineBindingTransferRoute && !isInvalidRepairRoute && !isDailyFlavorRoute,
    now
  });
  if (isInvalidRepairAudit) {
    return jsonResponse(await listInvalidEmployeeRepairs(env.DB, identity, now));
  }
  if (isInvalidRepairPreview || isInvalidRepair) {
    const match = invalidRepairPreviewMatch || invalidRepairMatch;
    let sourceUserId;
    try { sourceUserId = decodeURIComponent(match[1]).trim(); }
    catch { throw badRequest('USER_ID_INVALID'); }
    if (!sourceUserId) throw badRequest('USER_ID_REQUIRED');
    if (isInvalidRepairPreview) {
      return jsonResponse(await getInvalidEmployeeRepairPreview(
        env.DB,
        identity,
        sourceUserId,
        url.searchParams.get('targetUserId') || ''
      ));
    }
    return jsonResponse(await repairInvalidEmployeeIdentity(
      env.DB,
      identity,
      sourceUserId,
      await readJson(request),
      now
    ));
  }
  if (isDailyFlavorRoute) {
    assertCan(identity, ACTIONS.ADMIN_MENU_CHANGES);
    if (isDailyFlavorStatus) return jsonResponse(await getDailyFlavorSyncStatus(env.DB, now));
    return jsonResponse(await runCaiTeacherDailyFlavorSync(env.DB, { fetchImpl, now }));
  }
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
  if (isLineBindingTransferPreview || isLineBindingTransfer) {
    const match = lineBindingTransferPreviewMatch || lineBindingTransferMatch;
    let sourceUserId;
    try { sourceUserId = decodeURIComponent(match[1]).trim(); }
    catch { throw badRequest('USER_ID_INVALID'); }
    if (!sourceUserId) throw badRequest('USER_ID_REQUIRED');
    if (isLineBindingTransferPreview) {
      return jsonResponse(await getLineBindingTransferPreview(
        env.DB,
        identity,
        sourceUserId,
        url.searchParams.get('employeeId') || '',
        now
      ));
    }
    return jsonResponse(await transferLineBinding(
      env.DB,
      identity,
      sourceUserId,
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
  if (isNameUpdate) {
    assertCan(identity, ACTIONS.READ_MEMBER_BALANCES);
    if (identity.authorizationActor?.role !== 'Admin' || identity.viewAs) {
      throw notFound('USER_NOT_FOUND');
    }
    let userId;
    try { userId = decodeURIComponent(nameMatch[1]).trim(); }
    catch { throw badRequest('USER_ID_INVALID'); }
    if (!userId) throw badRequest('USER_ID_REQUIRED');
    const body = await readJson(request);
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (!displayName || displayName.length > 100) throw badRequest('DISPLAY_NAME_INVALID');
    const target = await getUserById(env.DB, userId);
    if (!target) throw notFound('USER_NOT_FOUND');
    if (target.displayName !== displayName) {
      const occurredAt = now.toISOString();
      await runMutationBatch(env.DB, [
        prepareStatement(env.DB, 'UPDATE users SET display_name = ?, updated_at = ? WHERE user_id = ?', [displayName, occurredAt, userId]),
        auditStatement(env.DB, {
          actorUserId: identity.authorizationActor.userId,
          actorAuthMode: identity.authorizationActor.authMode,
          actorEmployeeIdSnapshot: identity.authorizationActor.employeeId,
          actorLineUserIdSnapshot: identity.authorizationActor.lineUserId,
          targetUserId: userId,
          targetEmployeeIdSnapshot: target.employeeId,
          targetLineUserIdSnapshot: target.lineUserId,
          action: 'ADMIN_USER_NAME_UPDATED',
          metadata: { previousName: target.displayName, newName: displayName },
          occurredAt
        })
      ]);
    }
    return jsonResponse({ success: true, userId, displayName });
  }
  if (isUserLedger) {
    assertCan(identity, ACTIONS.READ_MEMBER_BALANCES);
    // Only the authenticated canonical Admin may read another user's ledger.
    if (identity.authorizationActor?.role !== 'Admin' || identity.viewAs) {
      throw notFound('USER_LEDGER_NOT_FOUND');
    }
    let userId;
    try { userId = decodeURIComponent(ledgerMatch[1]).trim(); }
    catch { throw badRequest('USER_ID_INVALID'); }
    if (!userId) throw badRequest('USER_ID_REQUIRED');
    const target = await getUserById(env.DB, userId);
    if (!target) throw notFound('USER_NOT_FOUND');
    const month = url.searchParams.get('month') || '';
    const history = await getBalanceHistory(env.DB, userId, month);
    await appendAuditEvent(env.DB, {
      actorUserId: identity.authorizationActor.userId,
      targetUserId: userId,
      action: 'ADMIN_USER_LEDGER_READ',
      metadata: { month },
      occurredAt: now.toISOString()
    });
    const balanceRow = await env.DB.prepare(`SELECT ${currentBalanceProjection('u')} AS balance FROM users u WHERE u.user_id = ?`).bind(userId).first();
    return jsonResponse({ ...history, userId, currentBalance: Number(balanceRow?.balance ?? 0) });
  }
  if (isMembers) return jsonResponse(await getMemberBalances(env.DB, identity, now, {
    includeInvalid: asBoolean(url.searchParams.get('includeInvalid'))
  }));
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
