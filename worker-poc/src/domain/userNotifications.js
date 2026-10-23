import { ACTIONS, assertCan } from '../auth/permissions.js';
import { prepareStatement, randomId, resolveClock } from '../db/transactions.js';
import { getTaipeiDate } from './deadlines.js';
import { compatibilityVendorCandidates } from './menuVendors.js';
import { notFound } from '../http/errors.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const LIST_LIMIT = 50;

const assertCanReadNotifications = (identity) => assertCan(
  identity,
  identity?.actor?.role === 'Vendor' ? ACTIONS.READ_VENDOR_CONTEXT : ACTIONS.READ_SELF
);

export const notificationStatement = (database, {
  userId, kind, title, body, refDate = null, dedupeKey, occurredAt, guard = null
}) => prepareStatement(database, `
  INSERT OR IGNORE INTO user_notifications (
    notification_id, user_id, kind, title, body, ref_date, dedupe_key, created_at
  )
  SELECT ?, ?, ?, ?, ?, ?, ?, ?
  ${guard ? `WHERE ${guard.sql}` : ''}
`, [randomId('ntf'), userId, kind, title, body, refDate, dedupeKey, occurredAt, ...(guard?.params || [])]);

export const getUserNotifications = async (database, identity) => {
  assertCanReadNotifications(identity);
  const userId = identity.actor.userId;
  const result = await database.prepare(`
    SELECT notification_id, kind, title, body, ref_date, created_at, read_at
    FROM user_notifications
    WHERE user_id = ?
    ORDER BY created_at DESC, notification_id DESC
    LIMIT ${LIST_LIMIT}
  `).bind(userId).all();
  const notifications = rowsFrom(result).map((row) => ({
    id: row.notification_id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    refDate: row.ref_date || null,
    createdAt: row.created_at,
    readAt: row.read_at || null
  }));
  return {
    success: true,
    unreadCount: notifications.filter((item) => !item.readAt).length,
    notifications
  };
};

export const markUserNotificationRead = async (database, identity, notificationId, now = new Date()) => {
  assertCanReadNotifications(identity);
  const userId = identity.actor.userId;
  const readAt = resolveClock(now).toISOString();
  const row = await database.prepare(`
    SELECT notification_id FROM user_notifications
    WHERE notification_id = ? AND user_id = ?
  `).bind(notificationId, userId).first();
  if (!row) throw notFound('NOTIFICATION_NOT_FOUND');
  await database.prepare(`
    UPDATE user_notifications SET read_at = COALESCE(read_at, ?)
    WHERE notification_id = ? AND user_id = ?
  `).bind(readAt, notificationId, userId).run();
  return { success: true, notificationId, readAt };
};

// Vendor principals (ACTIVE) whose membership is on a vendor with this name.
export const vendorPrincipalsForName = async (database, vendorName) => {
  const candidates = compatibilityVendorCandidates(vendorName);
  const placeholders = candidates.map(() => '?').join(', ');
  const result = await database.prepare(`
    SELECT DISTINCT vm.user_id, v.vendor_id
    FROM vendors v
    JOIN vendor_memberships vm ON vm.vendor_id = v.vendor_id AND vm.status = 'ACTIVE'
    JOIN vendor_principals vp ON vp.user_id = vm.user_id AND vp.status = 'ACTIVE'
    WHERE v.enabled = 1 AND v.name IN (${placeholders})
  `).bind(...candidates).all();
  return rowsFrom(result).map((row) => ({ userId: row.user_id, vendorId: row.vendor_id }));
};

const addDays = (dateOnly, days) => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

// 18:00 Taipei cron: tomorrow's mode-B group has just closed. Tell each vendor
// principal of the assigned vendor how many orders and portions came in.
export const notifyVendorsOrderClosed = async (database, scheduledTime) => {
  const now = resolveClock(scheduledTime);
  const orderDate = addDays(getTaipeiDate(now), 1);
  const setting = await database.prepare(`
    SELECT vendor FROM calendar_settings
    WHERE order_date = ? AND mode = 'B' AND length(trim(vendor)) > 0
  `).bind(orderDate).first();
  if (!setting) return { status: 'SKIP_NO_GROUP', orderDate, notified: 0 };

  const principals = await vendorPrincipalsForName(database, setting.vendor);
  if (!principals.length) return { status: 'SKIP_NO_VENDOR_PRINCIPAL', orderDate, notified: 0 };

  const totals = await database.prepare(`
    SELECT COUNT(DISTINCT o.order_id) AS order_count,
      COALESCE(SUM(oi.quantity), 0) AS portions
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.order_date = ? AND o.status = 'ACTIVE'
  `).bind(orderDate).first();
  const orderCount = Number(totals?.order_count || 0);
  const portions = Number(totals?.portions || 0);
  const label = orderDate.replace(/-/g, '/');
  const body = orderCount > 0
    ? `${label} 已收單，共 ${orderCount} 筆訂單、${portions} 份餐點，請到「訂餐」查看明細。`
    : `${label} 已收單，這一天沒有訂單。`;
  const occurredAt = now.toISOString();
  await database.batch(principals.map((principal) => notificationStatement(database, {
    userId: principal.userId,
    kind: 'VENDOR_ORDER_CLOSED',
    title: '已收單通知',
    body,
    refDate: orderDate,
    dedupeKey: `VENDOR_ORDER_CLOSED:${orderDate}:${principal.userId}`,
    occurredAt
  })));
  return { status: 'NOTIFIED', orderDate, notified: principals.length, orderCount, portions };
};
