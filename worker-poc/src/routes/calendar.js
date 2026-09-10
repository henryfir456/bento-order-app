import { ACTIONS, assertCan, assertSelfTarget } from '../auth/permissions.js';
import { auditStatement } from '../db/audit.js';
import { prepareStatement, runMutationBatch, resolveClock, randomId } from '../db/transactions.js';
import { getCalendarSetting } from '../domain/calendar.js';
import { isDateOnly } from '../domain/deadlines.js';
import { badRequest } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { requireIdentity } from '../http/authMiddleware.js';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const readJson = async (request) => {
  if (!request.body) return {};
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
    return value;
  } catch {
    throw badRequest('INVALID_JSON');
  }
};

const dateFromPath = (pathname, pattern) => {
  const match = pathname.match(pattern);
  if (!match) return null;
  const date = decodeURIComponent(match[1]).trim();
  if (!isDateOnly(date)) throw badRequest('INVALID_DATE');
  return date;
};

export const toggleLike = async (database, identity, orderDate, clock = new Date()) => {
  assertCan(identity, ACTIONS.WRITE_SELF);
  assertSelfTarget(identity, identity.actor.userId);
  if (!isDateOnly(orderDate)) throw badRequest('INVALID_DATE');
  const occurredAt = resolveClock(clock).toISOString();
  const toggle = prepareStatement(database, `
    DELETE FROM likes
    WHERE order_date = ? AND user_id = ?
  `, [orderDate, identity.actor.userId]);
  const add = prepareStatement(database, `
    INSERT INTO likes (order_date, user_id, created_at)
    SELECT ?, ?, ?
    WHERE changes() = 0
  `, [orderDate, identity.actor.userId, occurredAt]);
  const autoOpen = prepareStatement(database, `
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_user_id,
      created_at, updated_at
    )
    SELECT ?, '蔡老師', 'A', 'LIKE_DEFAULT', NULL, ?, ?
    WHERE EXISTS (SELECT 1 FROM likes WHERE order_date = ?)
      AND NOT EXISTS (
        SELECT 1 FROM calendar_settings
        WHERE order_date = ? AND length(trim(vendor)) > 0
      )
    ON CONFLICT(order_date) DO UPDATE SET
      vendor = '蔡老師',
      mode = 'A',
      vendor_source = 'LIKE_DEFAULT',
      updated_by_user_id = NULL,
      updated_at = excluded.updated_at
  `, [orderDate, occurredAt, occurredAt, orderDate, orderDate]);
  const autoClose = prepareStatement(database, `
    UPDATE calendar_settings
    SET vendor = '', mode = 'A', vendor_source = 'LIKE_DEFAULT',
        updated_by_user_id = NULL, updated_at = ?
    WHERE order_date = ? AND vendor = '蔡老師'
      AND NOT EXISTS (SELECT 1 FROM likes WHERE order_date = ?)
      AND NOT EXISTS (
        SELECT 1 FROM orders
        WHERE order_date = ? AND status = 'ACTIVE'
      )
  `, [occurredAt, orderDate, orderDate, orderDate]);
  await runMutationBatch(database, [toggle, add, autoOpen, autoClose]);
  const state = await database.prepare(`
      SELECT EXISTS(
      SELECT 1 FROM likes WHERE order_date = ? AND user_id = ?
    ) AS is_liked,
    (SELECT COUNT(*) FROM likes WHERE order_date = ?) AS total_likes
  `).bind(orderDate, identity.actor.userId, orderDate).first();
  return {
    success: true,
    isLiked: Boolean(state?.is_liked),
    totalLikes: Number(state?.total_likes || 0),
    setting: await getCalendarSetting(database, orderDate)
  };
};

export const setCalendarSetting = async (database, identity, orderDate, input, clock = new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_CALENDAR);
  if (!isDateOnly(orderDate)) throw badRequest('INVALID_DATE');
  const vendor = text(input?.vendor);
  const mode = text(input?.mode).toUpperCase();
  if (!['A', 'B'].includes(mode)) throw badRequest('CALENDAR_MODE_REQUIRED');
  if (vendor.length > 200) throw badRequest('CALENDAR_VENDOR_TOO_LONG');
  const occurredAt = resolveClock(clock).toISOString();
  const auditId = randomId('audit');
  const upsert = prepareStatement(database, `
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_user_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'CONFIGURED', ?, ?, ?)
    ON CONFLICT(order_date) DO UPDATE SET
      vendor = excluded.vendor,
      mode = excluded.mode,
      vendor_source = 'CONFIGURED',
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at
  `, [orderDate, vendor, mode, identity.actor.userId, occurredAt, occurredAt]);
  const audit = auditStatement(database, {
    auditId,
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    actorEmployeeIdSnapshot: identity.actor.employeeId,
    actorLineUserIdSnapshot: identity.actor.lineUserId,
    action: 'CALENDAR_SETTING_UPDATED',
    metadata: { orderDate, vendor, mode },
    occurredAt
  });
  await runMutationBatch(database, [upsert, audit]);
  return { success: true, setting: await getCalendarSetting(database, orderDate) };
};

export const handleCalendarRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const likeDate = request.method === 'POST'
    ? dateFromPath(url.pathname, /^\/api\/calendar\/([^/]+)\/like$/)
    : null;
  const adminDate = request.method === 'PUT'
    ? dateFromPath(url.pathname, /^\/api\/admin\/calendar\/([^/]+)$/)
    : null;
  if (!likeDate && !adminDate) return null;
  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: false,
    now
  });
  if (likeDate) return jsonResponse(await toggleLike(env.DB, identity, likeDate, now));
  return jsonResponse(await setCalendarSetting(
    env.DB,
    identity,
    adminDate,
    await readJson(request),
    now
  ));
};
