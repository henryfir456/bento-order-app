import { auditStatement } from '../db/audit.js';
import { prepareStatement, resolveClock, runMutationBatch } from '../db/transactions.js';
import { deadlineInfo, getTaipeiDate, isDateOnly } from './deadlines.js';
import { normalizeMenuVendor } from './menuVendors.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const effectiveMode = (row) => (row.mode === 'B' ? 'B' : 'A');

const statementChanges = (result) => Number(
  result?.meta?.changes ?? result?.changes ?? 0
);

export const getCalendarSetting = async (database, orderDate) => {
  if (!isDateOnly(orderDate)) return null;
  const row = await database.prepare(`
    SELECT order_date, vendor, mode, vendor_source
    FROM calendar_settings
    WHERE order_date = ?
    LIMIT 1
  `).bind(orderDate).first();
  return row
    ? { order_date: row.order_date, vendor: normalizeMenuVendor(row.vendor), mode: effectiveMode(row) }
    : null;
};

export const persistCalendarSetting = async (
  database,
  {
    orderDate,
    vendor,
    mode,
    vendorSource = 'CONFIGURED',
    updatedByUserId = null,
    onlyIfUnassigned = false,
    audit = null
  },
  clock = new Date()
) => {
  const occurredAt = resolveClock(clock).toISOString();
  const conditionalClause = onlyIfUnassigned
    ? `
    WHERE length(trim(calendar_settings.vendor)) = 0`
    : '';
  const upsert = prepareStatement(database, `
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_user_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_date) DO UPDATE SET
      vendor = excluded.vendor,
      mode = excluded.mode,
      vendor_source = excluded.vendor_source,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at${conditionalClause}
  `, [
    orderDate,
    vendor,
    mode,
    vendorSource,
    updatedByUserId,
    occurredAt,
    occurredAt
  ]);
  const statements = [upsert];
  if (audit) {
    statements.push(auditStatement(database, {
      ...audit,
      occurredAt
    }));
  }
  const results = await runMutationBatch(database, statements);
  return {
    changed: statementChanges(results[0]) === 1,
    setting: await getCalendarSetting(database, orderDate)
  };
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
  const orderQuantitiesResult = await database.prepare(`
    SELECT o.order_date, SUM(oi.quantity) AS total_quantity
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status <> 'CANCELLED'
    GROUP BY o.order_date
    ORDER BY o.order_date ASC
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
  const orderQuantitiesByDate = rowsFrom(orderQuantitiesResult).reduce((totals, row) => {
    totals[row.order_date] = Number(row.total_quantity || 0);
    return totals;
  }, {});
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
      vendor: normalizeMenuVendor(row.vendor),
      mode,
      deadline: deadlineInfo(row.order_date, mode, now)?.deadline || null,
      isExpired: Boolean(deadlineInfo(row.order_date, mode, now)?.isExpired),
      lunarLabel: null,
      totalQuantity: orderQuantitiesByDate[row.order_date] || 0,
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
        totalQuantity: orderQuantitiesByDate[date] || 0,
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
