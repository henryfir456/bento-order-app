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

export const LEAD_MINUTES = [10, 30, 60];
const DEFAULT_SCHEDULE = { leadMinutes: 10, weekdays: [1, 2, 3, 4, 5], lunarDays: [] };
const LUNAR_DAY_BITS = [[1, 1], [15, 2]];

const weekdaysFromMask = (mask) => [1, 2, 3, 4, 5].filter((day) => (mask >> (day - 1)) & 1);
const lunarDaysFromMask = (mask) => LUNAR_DAY_BITS.filter(([, bit]) => mask & bit).map(([day]) => day);

// Lunar day of month (1-30) for a Taipei calendar date, or null when the
// runtime cannot compute it.
export const lunarDayOf = (dateOnly) => {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'Asia/Taipei', day: 'numeric' })
      .formatToParts(new Date(`${dateOnly}T04:00:00Z`));
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    return Number.isInteger(day) && day >= 1 && day <= 30 ? day : null;
  } catch {
    return null;
  }
};

// Does a reminder with this schedule apply to the order date? Saturday and
// Sunday are never filtered out by the weekday chips (they only cover Mon-Fri).
export const scheduleAppliesTo = (orderDate, { weekdaysMask, lunarMask }) => {
  const weekday = new Date(`${orderDate}T00:00:00Z`).getUTCDay();
  if (weekday >= 1 && weekday <= 5 && !((weekdaysMask >> (weekday - 1)) & 1)) return false;
  if (lunarMask) {
    const lunarDay = lunarDayOf(orderDate);
    if (lunarDay === null) return false;
    return LUNAR_DAY_BITS.some(([day, bit]) => lunarMask & bit && day === lunarDay);
  }
  return true;
};

const isAdminRole = (identity) => ['Admin', 'ProxyAdmin'].includes(identity?.actor?.role);

const isVendorRole = (identity) => identity?.actor?.role === 'Vendor';

// Vendor principals have no READ_SELF; they only manage their own close push.
const assertCanManageReminders = (identity) => assertCan(
  identity,
  isVendorRole(identity) ? ACTIONS.READ_VENDOR_CONTEXT : ACTIONS.READ_SELF
);

export const getReminderSettings = async (database, identity) => {
  assertCanManageReminders(identity);
  const result = await database.prepare(`
    SELECT mode, enabled, lead_minutes, weekdays, lunar_days
    FROM user_reminder_prefs WHERE user_id = ?
  `).bind(identity.actor.userId).all();
  const settings = { A: false, B: false, adminClose: true, vendorClose: true, adminVendorClose: false };
  const schedule = { A: { ...DEFAULT_SCHEDULE }, B: { ...DEFAULT_SCHEDULE } };
  for (const row of rowsFrom(result)) {
    if (row.mode === 'A' || row.mode === 'B') {
      schedule[row.mode] = {
        leadMinutes: Number(row.lead_minutes) || 10,
        weekdays: weekdaysFromMask(Number(row.weekdays ?? 31)),
        lunarDays: lunarDaysFromMask(Number(row.lunar_days ?? 0))
      };
    }
    const key = { ADMIN_CLOSE: 'adminClose', VENDOR_CLOSE: 'vendorClose', ADMIN_VENDOR_CLOSE: 'adminVendorClose' }[row.mode] || row.mode;
    settings[key] = Number(row.enabled) === 1;
  }
  return {
    success: true,
    settings,
    schedule,
    canManageAdminClose: isAdminRole(identity),
    canManageVendorClose: isVendorRole(identity),
    hasLineBinding: Boolean(identity.actor.lineUserId)
  };
};

// body.schedule = { A?: {leadMinutes, weekdays, lunarDays}, B?: {...} }; each
// given mode replaces that mode's whole schedule.
const parseScheduleChanges = (schedule) => {
  if (schedule === undefined) return [];
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) throw badRequest('REMINDER_SCHEDULE_INVALID');
  const changes = [];
  for (const mode of Object.keys(schedule)) {
    if (mode !== 'A' && mode !== 'B') throw badRequest('REMINDER_SCHEDULE_INVALID');
    const { leadMinutes, weekdays, lunarDays } = schedule[mode] || {};
    if (!LEAD_MINUTES.includes(leadMinutes)) throw badRequest('REMINDER_SCHEDULE_INVALID');
    if (!Array.isArray(weekdays) || !weekdays.length || weekdays.some((day) => ![1, 2, 3, 4, 5].includes(day))) {
      throw badRequest('REMINDER_SCHEDULE_INVALID');
    }
    if (!Array.isArray(lunarDays) || lunarDays.some((day) => ![1, 15].includes(day))) {
      throw badRequest('REMINDER_SCHEDULE_INVALID');
    }
    changes.push({
      mode,
      leadMinutes,
      weekdaysMask: weekdays.reduce((mask, day) => mask | (1 << (day - 1)), 0),
      lunarMask: LUNAR_DAY_BITS.reduce((mask, [day, bit]) => (lunarDays.includes(day) ? mask | bit : mask), 0)
    });
  }
  return changes;
};

export const updateReminderSettings = async (database, identity, body, now = new Date()) => {
  assertCanManageReminders(identity);
  const updatedAt = resolveClock(now).toISOString();
  const keys = { A: 'A', B: 'B', adminClose: 'ADMIN_CLOSE', vendorClose: 'VENDOR_CLOSE', adminVendorClose: 'ADMIN_VENDOR_CLOSE' };
  const changes = Object.keys(keys).filter((key) => body?.[key] !== undefined);
  const scheduleChanges = parseScheduleChanges(body?.schedule);
  if (!changes.length && !scheduleChanges.length) throw badRequest('REMINDER_SETTINGS_EMPTY');
  if (changes.some((key) => typeof body[key] !== 'boolean')) throw badRequest('REMINDER_SETTINGS_INVALID');
  if ((changes.includes('adminClose') || changes.includes('adminVendorClose')) && !isAdminRole(identity)) throw forbidden('ADMIN_ONLY_REMINDER_SETTING');
  if (changes.includes('vendorClose') && !isVendorRole(identity)) throw forbidden('VENDOR_ONLY_REMINDER_SETTING');
  if (isVendorRole(identity) && changes.some((key) => key !== 'vendorClose')) throw forbidden('VENDOR_REMINDER_SETTING_ONLY');
  if (scheduleChanges.length && isVendorRole(identity)) throw forbidden('VENDOR_REMINDER_SETTING_ONLY');
  await database.batch([
    ...changes.map((key) => prepareStatement(database, `
      INSERT INTO user_reminder_prefs (user_id, mode, enabled, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, mode) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `, [identity.actor.userId, keys[key], body[key] ? 1 : 0, updatedAt])),
    // A schedule saved before the switch is on must not turn the reminder on.
    ...scheduleChanges.map((change) => prepareStatement(database, `
      INSERT INTO user_reminder_prefs (user_id, mode, enabled, updated_at, lead_minutes, weekdays, lunar_days)
      VALUES (?, ?, 0, ?, ?, ?, ?)
      ON CONFLICT(user_id, mode) DO UPDATE SET
        lead_minutes = excluded.lead_minutes,
        weekdays = excluded.weekdays,
        lunar_days = excluded.lunar_days,
        updated_at = excluded.updated_at
    `, [identity.actor.userId, change.mode, updatedAt, change.leadMinutes, change.weekdaysMask, change.lunarMask]))
  ]);
  return getReminderSettings(database, identity);
};

// Cron 10 minutes before a deadline. Reminds opted-in LINE users of the
// matching group who have no active order for that date yet.
export const sendOrderReminders = async (database, env, scheduledTime, mode, {
  fetchImpl = globalThis.fetch,
  leadMinutes = 10
} = {}) => {
  const plan = REMINDER_PLAN[mode];
  if (!plan) return { status: 'SKIP_UNKNOWN_MODE', mode, reminded: 0 };
  const now = resolveClock(scheduledTime);
  const orderDate = addDays(getTaipeiDate(now), plan.dayOffset);
  // Without a token nothing can be sent, so leave no log rows that would block a later retry.
  if (!env?.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN) return { status: 'SKIP_NO_TOKEN', mode, reminded: 0 };
  const setting = await database.prepare(`
    SELECT vendor FROM calendar_settings
    WHERE order_date = ? AND mode = ? AND length(trim(vendor)) > 0
  `).bind(orderDate, mode).first();
  if (!setting) return { status: 'SKIP_NO_GROUP', orderDate, mode, reminded: 0 };

  const candidates = rowsFrom(await database.prepare(`
    SELECT u.user_id, u.line_user_id, p.weekdays, p.lunar_days
    FROM user_reminder_prefs p
    JOIN users u ON u.user_id = p.user_id
    WHERE p.mode = ? AND p.enabled = 1 AND p.lead_minutes = ? AND u.active = 1
      AND u.line_user_id IS NOT NULL AND length(trim(u.line_user_id)) > 0
      AND NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.user_id = u.user_id AND o.order_date = ? AND o.status = 'ACTIVE'
      )
      AND NOT EXISTS (
        SELECT 1 FROM order_reminder_log l
        WHERE l.user_id = u.user_id AND l.order_date = ? AND l.mode = ?
      )
  `).bind(mode, leadMinutes, orderDate, orderDate, mode).all())
    .filter((user) => scheduleAppliesTo(orderDate, {
      weekdaysMask: Number(user.weekdays ?? 31), lunarMask: Number(user.lunar_days ?? 0)
    }));
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
  const text = `【便當】${setting.vendor} ${plan.deadlineText}截止訂餐（剩 ${leadMinutes} 分鐘），你還沒訂餐，記得下單喔！`;
  let push;
  try {
    push = await pushLineText(env, fetchImpl, lineUserIds, text);
  } catch (error) {
    push = { status: 'LINE_PUSH_ERROR', error: error?.name || 'Error', sent: 0 };
  }
  return { status: 'REMINDED', orderDate, mode, reminded: lineUserIds.length, push };
};
