import { ACTIONS, assertCan } from '../auth/permissions.js';
import { resolveCanonicalIdentity } from '../auth/identity.js';
import { getActiveAnnouncements } from '../domain/announcements.js';
import {
  getCalendarEvents,
  getCalendarSetting,
  getLikes
} from '../domain/calendar.js';
import { deadlineInfo, getTaipeiDate, isDateOnly } from '../domain/deadlines.js';
import { getCustomerMenu } from '../domain/menu.js';
import {
  getHistoricalOrdersMap,
  getReadableOrder,
  isHistoricalOrderDate
} from '../domain/ordersRead.js';
import {
  normalizeTargetUserId,
  orderPolicyResponse,
  resolveOrderPermission
} from '../domain/orderAuthorization.js';
import { notFound, badRequest, forbidden } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { getMe } from '../domain/users.js';
import { publicUser } from '../db/users.js';
import { normalizeBootId } from '../contract.js';

const requireRegistered = (identity) => {
  if (!identity?.actor?.registered) throw forbidden('NOT_REGISTERED');
  assertCan(identity, ACTIONS.READ_SELF);
};

const bootId = () => (
  'BOOT-' + Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8)
);

const requiredBootId = (url) => {
  const value = normalizeBootId(url.searchParams.get('bootId'), null);
  if (!value) throw badRequest('INVALID_BOOT_ID');
  return value;
};

const explicitOrderTarget = (url) => normalizeTargetUserId(
  url.searchParams.get('targetUserId')
);

const viewAsAndDelegatedTarget = (url, targetUserId) => Boolean(
  targetUserId && (url.searchParams.get('viewAs') || url.searchParams.get('viewAsUserId'))
);

export const handleReadOnlyRequest = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  if (request.method !== 'GET') return null;
  const allowViewAs = url.pathname !== '/api/me';
  const identity = await resolveCanonicalIdentity(request, env, fetchImpl, { allowViewAs, now });

  if (url.pathname === '/api/me') {
    return jsonResponse(getMe(identity));
  }

  requireRegistered(identity);
  const subject = identity.effectiveSubject;

  if (url.pathname === '/api/calendar') {
    const announcements = await getActiveAnnouncements(env.DB, now);
    return jsonResponse({
      success: true,
      events: await getCalendarEvents(env.DB, {
        fromDate: url.searchParams.get('from') || null,
        toDate: url.searchParams.get('to') || null,
        now,
        includeLikes: true,
        userId: subject.userId,
        includeSource: true
      }),
      announcements,
      announcement: announcements[0] || null
    });
  }

  if (url.pathname === '/api/bootstrap') {
    const announcements = [];
    return jsonResponse({
      success: true,
      registered: true,
      user: publicUser(subject),
      calendar: {
        events: await getCalendarEvents(env.DB, { now }),
        announcements,
        announcement: null
      },
      ordersMap: await getHistoricalOrdersMap(env.DB, subject.userId, now),
      targetDate: url.searchParams.get('targetDate') || null,
      bootId: bootId()
    });
  }

  if (url.pathname === '/api/bootstrap/deferred') {
    const requestedBootId = requiredBootId(url);
    const announcements = await getActiveAnnouncements(env.DB, now);
    return jsonResponse({
      success: true,
      registered: true,
      likes: await getLikes(env.DB, { userId: subject.userId, now }),
      announcements,
      announcement: announcements[0] || null,
      bootId: requestedBootId
    });
  }

  if (url.pathname === '/api/orders/map') {
    const targetUserId = explicitOrderTarget(url);
    if (viewAsAndDelegatedTarget(url, targetUserId)) {
      throw forbidden('ORDER_TARGET_MODE_CONFLICT');
    }
    const target = targetUserId
      ? (await resolveOrderPermission(env.DB, identity, {
        targetUserId,
        targetDate: getTaipeiDate(now),
        mode: 'A',
        now
      })).target
      : subject;
    return jsonResponse({
      success: true,
      ordersMap: await getHistoricalOrdersMap(env.DB, target.userId, now),
      ...(targetUserId ? { targetUser: publicUser(target) } : {})
    });
  }

  if (url.pathname === '/api/order-page') {
    const targetDate = url.searchParams.get('targetDate') || '';
    if (!isDateOnly(targetDate)) throw badRequest('INVALID_DATE');
    const targetUserId = explicitOrderTarget(url);
    if (viewAsAndDelegatedTarget(url, targetUserId)) {
      throw forbidden('ORDER_TARGET_MODE_CONFLICT');
    }
    const setting = await getCalendarSetting(env.DB, targetDate);
    if (!setting || !setting.vendor) {
      throw notFound('ORDER_PAGE_SETTING_NOT_FOUND');
    }
    const menu = await getCustomerMenu(env.DB, { vendor: setting.vendor, targetDate });
    const permission = identity.viewAs
      ? null
      : await resolveOrderPermission(env.DB, identity, {
        targetUserId,
        targetDate,
        mode: setting.mode,
        now,
        enforceProxyDelegatedDate: false
      });
    const orderSubject = permission?.target || subject;
    const myOrder = await getReadableOrder(env.DB, orderSubject.userId, targetDate, {
      includeCompleted: isHistoricalOrderDate(targetDate, now),
      menuItems: menu
    });
    return jsonResponse({
      success: true,
      setting,
      deadline: permission?.timing.deadline || deadlineInfo(targetDate, setting.mode, now),
      menu,
      myOrder,
      targetUser: publicUser(orderSubject),
      orderPolicy: permission
        ? orderPolicyResponse(permission)
        : {
          actorUserId: identity.authorizationActor.userId,
          targetUserId: orderSubject.userId,
          delegated: false,
          cutoffApplies: false,
          deadlineBypassed: false,
          canMutate: false
        }
    });
  }

  return null;
};
