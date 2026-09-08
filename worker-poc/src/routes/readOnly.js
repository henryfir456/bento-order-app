import { ACTIONS, assertCan } from '../auth/permissions.js';
import { resolveCanonicalIdentity } from '../auth/identity.js';
import { getActiveAnnouncements } from '../domain/announcements.js';
import {
  getCalendarEvents,
  getCalendarSetting,
  getLikes
} from '../domain/calendar.js';
import { deadlineInfo, isDateOnly } from '../domain/deadlines.js';
import { getCustomerMenu } from '../domain/menu.js';
import { getActiveOrder, getActiveOrdersMap } from '../domain/ordersRead.js';
import { notFound, badRequest, forbidden } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { publicUser } from '../db/users.js';

const requireRegistered = (identity) => {
  if (!identity?.actor?.registered) throw forbidden('NOT_REGISTERED');
  assertCan(identity, ACTIONS.READ_SELF);
};

const bootId = () => (
  'BOOT-' + Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8)
);

export const handleReadOnlyRequest = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  if (request.method !== 'GET') return null;
  const allowViewAs = url.pathname !== '/api/me';
  const identity = await resolveCanonicalIdentity(request, env, fetchImpl, { allowViewAs });

  if (url.pathname === '/api/me') {
    return jsonResponse({
      success: true,
      registered: Boolean(identity.actor.registered),
      user: identity.actor.registered ? publicUser(identity.actor) : null
    });
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
        lineUserId: subject.lineUserId,
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
      ordersMap: await getActiveOrdersMap(env.DB, subject.lineUserId),
      targetDate: url.searchParams.get('targetDate') || null,
      bootId: bootId()
    });
  }

  if (url.pathname === '/api/bootstrap/deferred') {
    const announcements = await getActiveAnnouncements(env.DB, now);
    return jsonResponse({
      success: true,
      registered: true,
      likes: await getLikes(env.DB, { lineUserId: subject.lineUserId, now }),
      announcements,
      announcement: announcements[0] || null,
      bootId: bootId()
    });
  }

  if (url.pathname === '/api/orders/map') {
    return jsonResponse({
      success: true,
      ordersMap: await getActiveOrdersMap(env.DB, subject.lineUserId)
    });
  }

  if (url.pathname === '/api/order-page') {
    const targetDate = url.searchParams.get('targetDate') || '';
    if (!isDateOnly(targetDate)) throw badRequest('INVALID_DATE');
    const setting = await getCalendarSetting(env.DB, targetDate);
    if (!setting || !setting.vendor) {
      throw notFound('ORDER_PAGE_SETTING_NOT_FOUND');
    }
    const [menu, myOrder] = await Promise.all([
      getCustomerMenu(env.DB, { vendor: setting.vendor, targetDate }),
      getActiveOrder(env.DB, subject.lineUserId, targetDate)
    ]);
    return jsonResponse({
      success: true,
      setting,
      deadline: deadlineInfo(targetDate, setting.mode, now),
      menu,
      myOrder
    });
  }

  return null;
};
