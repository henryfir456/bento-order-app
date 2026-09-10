import { deadlineInfo, getTaipeiDate, isDateOnly } from './deadlines.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const effectiveMode = (row) => (row.mode === 'B' ? 'B' : 'A');

export const getCalendarSetting = async (database, orderDate) => {
  if (!isDateOnly(orderDate)) return null;
  const row = await database.prepare(`
    SELECT order_date, vendor, mode, vendor_source
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
  {
    fromDate = null,
    toDate = null,
    now = new Date(),
    includeLikes = false,
    userId = null,
    includeSource = false
  } = {}
) => {
  const result = await database.prepare(`
    SELECT order_date, vendor, mode, vendor_source
    FROM calendar_settings
    ORDER BY order_date ASC
  `).all();
  const events = {};
  const likesResult = includeLikes
    ? await database.prepare(`
      SELECT order_date, user_id
      FROM likes
      ORDER BY order_date ASC, user_id ASC
    `).all()
    : { results: [] };
  const likeRows = rowsFrom(likesResult);
  const likesByDate = likeRows.reduce((result, row) => {
    const current = result[row.order_date] || { count: 0, users: new Set() };
    current.count += 1;
    current.users.add(row.user_id);
    result[row.order_date] = current;
    return result;
  }, {});
  for (const row of rowsFrom(result)) {
    if (!isDateOnly(row.order_date)) continue;
    if (fromDate && row.order_date < fromDate) continue;
    if (toDate && row.order_date > toDate) continue;
    const mode = effectiveMode(row);
    const likeState = likesByDate[row.order_date] || { count: 0, users: new Set() };
    events[row.order_date] = {
      order_date: row.order_date,
      vendor: row.vendor || '',
      mode,
      deadline: deadlineInfo(row.order_date, mode, now)?.deadline || null,
      isExpired: Boolean(deadlineInfo(row.order_date, mode, now)?.isExpired),
      lunarLabel: null,
      ...(includeLikes ? {
        likeCount: likeState.count,
        isUserLiked: likeState.users.has(userId),
        ...(includeSource ? { vendorSource: row.vendor_source || 'CONFIGURED' } : {})
      } : {})
    };
  }
  if (includeLikes) {
    for (const [date, likeState] of Object.entries(likesByDate)) {
      if (events[date] || (fromDate && date < fromDate) || (toDate && date > toDate)) continue;
      const fallback = deadlineInfo(date, 'A', now);
      events[date] = {
        order_date: date,
        vendor: '',
        mode: 'A',
        deadline: fallback?.deadline || null,
        isExpired: Boolean(fallback?.isExpired),
        lunarLabel: null,
        likeCount: likeState.count,
        isUserLiked: likeState.users.has(userId),
        ...(includeSource ? { vendorSource: 'LIKE_DEFAULT' } : {})
      };
    }
  }
  return events;
};

export const getLikes = async (database, { userId, now = new Date() } = {}) => {
  const result = await database.prepare(`
    SELECT order_date, user_id
    FROM likes
    ORDER BY order_date ASC, user_id ASC
  `).all();
  return rowsFrom(result).reduce((state, row) => {
    const current = state[row.order_date] || {
      likeCount: 0,
      isUserLiked: false,
      calendarEvent: null
    };
    current.likeCount += 1;
    if (row.user_id === userId) current.isUserLiked = true;
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
