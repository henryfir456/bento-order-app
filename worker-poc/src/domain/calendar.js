import { deadlineInfo, getTaipeiDate, isDateOnly } from './deadlines.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const effectiveMode = (row) => (row.mode === 'B' ? 'B' : 'A');

export const getCalendarSetting = async (database, orderDate) => {
  if (!isDateOnly(orderDate)) return null;
  const row = await database.prepare(`
    SELECT order_date, vendor, mode
    FROM calendar_settings
    WHERE order_date = ?
    LIMIT 1
  `).bind(orderDate).first();
  return row
    ? { order_date: row.order_date, vendor: row.vendor || '', mode: effectiveMode(row) }
    : null;
};

export const getCalendarEvents = async (
  database,
  { fromDate = null, toDate = null, now = new Date() } = {}
) => {
  const result = await database.prepare(`
    SELECT order_date, vendor, mode
    FROM calendar_settings
    ORDER BY order_date ASC
  `).all();
  const events = {};
  for (const row of rowsFrom(result)) {
    if (!isDateOnly(row.order_date)) continue;
    if (fromDate && row.order_date < fromDate) continue;
    if (toDate && row.order_date > toDate) continue;
    const mode = effectiveMode(row);
    events[row.order_date] = {
      order_date: row.order_date,
      vendor: row.vendor || '',
      mode,
      deadline: deadlineInfo(row.order_date, mode, now)?.deadline || null,
      isExpired: Boolean(deadlineInfo(row.order_date, mode, now)?.isExpired),
      lunarLabel: null
    };
  }
  return events;
};

export const getLikes = async (database, { lineUserId, now = new Date() } = {}) => {
  const result = await database.prepare(`
    SELECT order_date, line_user_id
    FROM likes
    ORDER BY order_date ASC, line_user_id ASC
  `).all();
  return rowsFrom(result).reduce((state, row) => {
    const current = state[row.order_date] || {
      likeCount: 0,
      isUserLiked: false,
      calendarEvent: null
    };
    current.likeCount += 1;
    if (row.line_user_id === lineUserId) current.isUserLiked = true;
    current.calendarEvent = {
      order_date: row.order_date,
      vendor: '',
      mode: 'A',
      deadline: deadlineInfo(row.order_date, 'A', now)?.deadline || null,
      isExpired: Boolean(deadlineInfo(row.order_date, 'A', now)?.isExpired),
      lunarLabel: null
    };
    state[row.order_date] = current;
    return state;
  }, {});
};

export const todayInTaipei = (now = new Date()) => getTaipeiDate(now);
