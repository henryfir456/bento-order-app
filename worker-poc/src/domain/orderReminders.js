import { ACTIONS, assertCan } from '../auth/permissions.js';
import { prepareStatement, resolveClock } from '../db/transactions.js';
import { badRequest, forbidden } from '../http/errors.js';
import { getTaipeiDate } from './deadlines.js';
import { addDays, pushLineText } from './userNotifications.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

// Mode A closes at 10:00 on the order day; mode B at 18:00 the day before.
const REMINDER_PLAN = {
  A: { dayOffset: 0, deadlineText: '今天 10:00' },
  B: { dayOffset: 1, deadlineText: '今天 18:00' }
};

const isAdminRole = (identity) => ['Admin', 'ProxyAdmin'].includes(identity?.actor?.role);

export const getReminderSettings = async (database, identity) => {
  assertCan(identity, ACTIONS.READ_SELF);
  const result = await database.prepare(`
    SELECT mode, enabled FROM user_reminder_prefs WHERE user_id = ?
  `).bind(identity.actor.userId).all();
  const settings = { A: false, B: false, adminClose: true };
  for (const row of rowsFrom(result)) {
    settings[row.mode === 'ADMIN_CLOSE' ? 'adminClose' : row.mode] = Number(row.enabled) === 1;
  }
  return {
    success: true,
    settings,
    canManageAdminClose: isAdminRole(identity),
    hasLineBinding: Boolean(identity.actor.lineUserId)
  };
};

export const updateReminderSettings = async (database, identity, body, now = new Date()) => {
  assertCan(identity, ACTIONS.READ_SELF);
  const updatedAt = resolveClock(now).toISOString();
  const keys = { A: 'A', B: 'B', adminClose: 'ADMIN_CLOSE' };
  const changes = Object.keys(keys).filter((key) => body?.[key] !== undefined);
  if (!changes.length) throw badRequest('REMINDER_SETTINGS_EMPTY');
  if (changes.some((key) => typeof body[key] !== 'boolean')) throw badRequest('REMINDER_SETTINGS_INVALID');
  if (changes.includes('adminClose') && !isAdminRole(identity)) throw forbidden('ADMIN_ONLY_REMINDER_SETTING');
  await database.batch(changes.map((key) => prepareStatement(database, `
    INSERT INTO user_reminder_prefs (user_id, mode, enabled, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, mode) DO UPDATE SET
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `, [identity.actor.userId, keys[key], body[key] ? 1 : 0, updatedAt])));
  return getReminderSettings(database, identity);
};

// Cron 10 minutes before a deadline. Reminds opted-in LINE users of the
// matching group who have no active order for that date yet.
export const sendOrderReminders = async (database, env, scheduledTime, mode, {
  fetchImpl = globalThis.fetch
} = {}) => {
  const plan = REMINDER_PLAN[mode];
  if (!plan) return { status: 'SKIP_UNKNOWN_MODE', mode, reminded: 0 };
  const now = resolveClock(scheduledTime);
  const orderDate = addDays(getTaipeiDate(now), plan.dayOffset);
  const setting = await database.prepare(`
    SELECT vendor FROM calendar_settings
    WHERE order_date = ? AND mode = ? AND length(trim(vendor)) > 0
  `).bind(orderDate, mode).first();
  if (!setting) return { status: 'SKIP_NO_GROUP', orderDate, mode, reminded: 0 };

  const candidates = rowsFrom(await database.prepare(`
    SELECT u.user_id, u.line_user_id
    FROM user_reminder_prefs p
    JOIN users u ON u.user_id = p.user_id
    WHERE p.mode = ? AND p.enabled = 1 AND u.active = 1
      AND u.line_user_id IS NOT NULL AND length(trim(u.line_user_id)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.user_id = u.user_id AND o.order_date = ? AND o.status = 'ACTIVE'
      )
      AND NOT EXISTS (
        SELECT 1 FROM order_reminder_log l
        WHERE l.user_id = u.user_id AND l.order_date = ? AND l.mode = ?
      )
  `).bind(mode, orderDate, orderDate, mode).all());
  if (!candidates.length) return { status: 'SKIP_NO_RECIPIENT', orderDate, mode, reminded: 0 };

  const sentAt = now.toISOString();
  const results = await database.batch(candidates.map((user) => prepareStatement(database, `
    INSERT OR IGNORE INTO order_reminder_log (user_id, order_date, mode, sent_at)
    VALUES (?, ?, ?, ?)
  `, [user.user_id, orderDate, mode, sentAt])));
  // A retried cron run only reminds users whose log row is new.
  const lineUserIds = candidates
    .filter((_, index) => (results?.[index]?.meta?.changes ?? results?.[index]?.changes ?? 1) > 0)
    .map((user) => user.line_user_id);
  const text = `【便當】${setting.vendor} ${plan.deadlineText}截止訂餐（剩 10 分鐘），你還沒訂餐，記得下單喔！`;
  let push;
  try {
    push = await pushLineText(env, fetchImpl, lineUserIds, text);
  } catch (error) {
    push = { status: 'LINE_PUSH_ERROR', error: error?.name || 'Error', sent: 0 };
  }
  return { status: 'REMINDED', orderDate, mode, reminded: lineUserIds.length, push };
};
