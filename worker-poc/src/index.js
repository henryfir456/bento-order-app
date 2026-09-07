import {
  asBoolean,
  asNumber,
  asText,
  getDeadlineInfo,
  getLunarLabel,
  getTaipeiDate,
  isDateOnly,
  normalizeAnnouncement,
  normalizeBootId,
  normalizeDateOnly,
  normalizeMenuItem,
  normalizeOrderLine,
  normalizeUser,
  resolveMode
} from './contract.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Origin': '*'
};

const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  }
});

const emptyResponse = (status = 204) => new Response(null, {
  status,
  headers: CORS_HEADERS
});

const asRows = (result) => {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
};

const nowMs = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const roundedDuration = (start) => Math.max(0, Math.round(nowMs() - start));

const requireDatabase = (env) => {
  if (!env?.DB || typeof env.DB.prepare !== 'function') {
    throw new Error('D1 binding is unavailable');
  }
  return env.DB;
};

const createDatabaseContext = (database) => {
  let queryCount = 0;
  return {
    prepare(sql) {
      queryCount += 1;
      return database.prepare(sql);
    },
    get queryCount() {
      return queryCount;
    }
  };
};

const requiredUserId = (url) => {
  const userId = url.searchParams.get('userId');
  return userId && userId.trim() ? userId.trim() : null;
};

const generateBootId = () => (
  `BOOT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
);

const resolveWorkerBootId = (value) => normalizeBootId(value, generateBootId());

const serverTimingHeaders = (metrics, queryCount) => {
  const entries = Object.entries(metrics).map(([metric, duration]) => (
    `${metric.toLowerCase().replaceAll('_', '-')};dur=${Math.max(0, Number(duration) || 0)}`
  ));
  entries.push(`d1-queries;desc="${queryCount}"`);
  return { 'Server-Timing': entries.join(', ') };
};

const userNotFound = () => jsonResponse({ error: 'USER_NOT_FOUND' }, 404);

const getUser = async (database, lineUserId) => {
  const row = await database
    .prepare(`
      SELECT line_user_id, display_name, pickup_floor, balance, role
      FROM users
      WHERE line_user_id = ?
    `)
    .bind(lineUserId)
    .first();

  return row ? normalizeUser(row) : null;
};

const getDiagnosticUser = (user) => ({
  line_user_id: user.lineUserId,
  display_name: user.displayName,
  pickup_floor: user.defaultFloor,
  balance: user.balance,
  role: user.role
});

const getOrders = async (database, lineUserId) => {
  const result = await database
    .prepare(`
      SELECT order_id, order_date, vendor, line_user_id, item_id, item_name,
             quantity, unit_price, subtotal, pickup_floor, note, created_at
      FROM orders
      WHERE line_user_id = ?
      ORDER BY order_date DESC, created_at DESC, id ASC
    `)
    .bind(lineUserId)
    .all();

  return asRows(result).map(normalizeOrderLine);
};

const getCalendarSettings = async (database) => {
  const result = await database
    .prepare(`
      SELECT order_date, vendor, mode
      FROM calendar_settings
      ORDER BY id ASC
    `)
    .all();

  return asRows(result);
};

const getCalendarEvents = async (database, now) => {
  const rows = await getCalendarSettings(database);
  return rows.reduce((events, row) => {
    const orderDate = normalizeDateOnly(row.order_date);
    if (!orderDate) return events;

    const vendor = asText(row.vendor);
    const mode = resolveMode(vendor, row.mode);
    const deadlineInfo = getDeadlineInfo(orderDate, mode, now);
    events[orderDate] = {
      order_date: orderDate,
      vendor,
      mode,
      deadline: deadlineInfo.deadline,
      isExpired: deadlineInfo.isExpired,
      lunarLabel: getLunarLabel(orderDate)
    };
    return events;
  }, {});
};

const getOrdersMap = async (database, lineUserId) => {
  const result = await database
    .prepare(`
      SELECT orders.id, orders.order_date,
             COALESCE(order_status.status, 'ACTIVE') AS status
      FROM orders
      LEFT JOIN order_status ON order_status.order_row_id = orders.id
      WHERE orders.line_user_id = ?
      ORDER BY orders.id ASC
    `)
    .bind(lineUserId)
    .all();

  return asRows(result).reduce((ordersMap, row) => {
    if (asText(row.status || 'ACTIVE') !== 'ACTIVE') return ordersMap;
    const orderDate = normalizeDateOnly(row.order_date);
    if (orderDate) ordersMap[orderDate] = true;
    return ordersMap;
  }, {});
};

const getLikes = async (database, lineUserId, now) => {
  const result = await database
    .prepare(`
      SELECT id, order_date, line_user_id, created_at
      FROM likes
      ORDER BY id ASC
    `)
    .all();

  const state = asRows(result).reduce((likes, row) => {
    const orderDate = normalizeDateOnly(row.order_date);
    if (!orderDate) return likes;
    const current = likes[orderDate] || { likeCount: 0, isUserLiked: false };
    current.likeCount += 1;
    if (asText(row.line_user_id).trim() === lineUserId) current.isUserLiked = true;
    likes[orderDate] = current;
    return likes;
  }, {});

  return Object.keys(state).reduce((likes, orderDate) => {
    const deadlineInfo = getDeadlineInfo(orderDate, 'A', now);
    likes[orderDate] = {
      ...state[orderDate],
      calendarEvent: {
        order_date: orderDate,
        vendor: '',
        mode: 'A',
        deadline: deadlineInfo.deadline,
        isExpired: deadlineInfo.isExpired,
        lunarLabel: getLunarLabel(orderDate)
      }
    };
    return likes;
  }, {});
};

const getActiveAnnouncements = async (database, now) => {
  const result = await database
    .prepare(`
      SELECT rowid AS source_order, id, title, content, start_date, end_date, enabled
      FROM announcements
      ORDER BY start_date DESC, source_order DESC
    `)
    .all();
  const today = getTaipeiDate(now);

  return asRows(result)
    .filter((row) => asBoolean(row.enabled))
    .filter((row) => {
      const startDate = asText(row.start_date).trim();
      const endDate = asText(row.end_date).trim();
      return Boolean(
        asText(row.id).trim()
        && asText(row.title).trim()
        && asText(row.content).trim()
        && isDateOnly(startDate)
        && isDateOnly(endDate)
        && endDate >= startDate
        && startDate <= today
        && today <= endDate
      );
    })
    .sort((left, right) => (
      asText(right.start_date).localeCompare(asText(left.start_date))
      || (asNumber(right.source_order) - asNumber(left.source_order))
    ))
    .map(normalizeAnnouncement);
};

const getCalendarSetting = async (database, orderDate) => {
  const row = await database
    .prepare(`
      SELECT order_date, vendor, mode
      FROM calendar_settings
      WHERE order_date = ?
      LIMIT 1
    `)
    .bind(orderDate)
    .first();
  if (!row) return null;

  const vendor = asText(row.vendor);
  return {
    order_date: normalizeDateOnly(row.order_date),
    vendor,
    mode: resolveMode(vendor, row.mode)
  };
};

const getOrderPageMenu = async (database, vendor, targetDate) => {
  const result = await database
    .prepare(`
      SELECT id, menu_date, vendor, item_id, item_name, price, note, image_url
      FROM menu
      WHERE vendor = ? AND menu_date <= ?
      ORDER BY menu_date DESC, id ASC
    `)
    .bind(vendor, targetDate)
    .all();
  const rows = asRows(result)
    .filter((row) => isDateOnly(row.menu_date))
    .sort((left, right) => (
      asText(right.menu_date).localeCompare(asText(left.menu_date))
      || (asNumber(left.id) - asNumber(right.id))
    ));
  const latestMenuDate = rows[0]?.menu_date || null;
  return latestMenuDate
    ? rows.filter((row) => row.menu_date === latestMenuDate).map(normalizeMenuItem)
    : [];
};

const getUserOrder = async (database, lineUserId, targetDate) => {
  const result = await database
    .prepare(`
      SELECT orders.id, orders.order_id, orders.order_date, orders.item_id,
             orders.item_name, orders.quantity, orders.unit_price,
             orders.subtotal, orders.note,
             COALESCE(order_status.status, 'ACTIVE') AS status
      FROM orders
      LEFT JOIN order_status ON order_status.order_row_id = orders.id
      WHERE orders.line_user_id = ? AND orders.order_date = ?
      ORDER BY orders.id ASC
    `)
    .bind(lineUserId, targetDate)
    .all();

  let orderId = '';
  let note = '';
  const items = [];
  for (const row of asRows(result)) {
    if (asText(row.status || 'ACTIVE') !== 'ACTIVE') continue;
    if (!orderId) orderId = asText(row.order_id).trim();
    items.push({
      order_id: asText(row.order_id).trim(),
      item_id: asText(row.item_id),
      item_name: asText(row.item_name),
      quantity: asNumber(row.quantity),
      unit_price: asNumber(row.unit_price),
      subtotal: asNumber(row.subtotal)
    });
    if (asText(row.note)) note = row.note;
  }

  return { orderId, items, note };
};

const buildPrimaryResponse = async (database, url, now) => {
  const userId = requiredUserId(url);
  if (!userId) return jsonResponse({ error: 'USER_ID_REQUIRED' }, 400);

  const totalStart = nowMs();
  const userLookupStart = nowMs();
  const user = await getUser(database, userId);
  const metrics = { USER_LOOKUP_MS: roundedDuration(userLookupStart) };
  if (!user) return userNotFound();

  const [calendarEvents, ordersMap] = await Promise.all([
    (async () => {
      const start = nowMs();
      const result = await getCalendarEvents(database, now);
      metrics.CALENDAR_MS = roundedDuration(start);
      return result;
    })(),
    (async () => {
      const start = nowMs();
      const result = await getOrdersMap(database, userId);
      metrics.ORDERS_MS = roundedDuration(start);
      return result;
    })()
  ]);

  metrics.BOOTSTRAP_TOTAL_MS = roundedDuration(totalStart);
  const bootId = resolveWorkerBootId(url.searchParams.get('bootId'));
  const targetDate = asText(url.searchParams.get('targetDate')).trim() || null;
  const body = {
    success: true,
    registered: true,
    user,
    calendar: {
      events: calendarEvents,
      announcements: [],
      announcement: null
    },
    ordersMap,
    targetDate,
    bootId,
    observability: {
      timing: {
        status: 'success',
        metrics
      }
    }
  };
  return jsonResponse(body, 200, serverTimingHeaders(metrics, database.queryCount));
};

const buildDeferredResponse = async (database, url, now) => {
  const userId = requiredUserId(url);
  if (!userId) return jsonResponse({ error: 'USER_ID_REQUIRED' }, 400);

  const totalStart = nowMs();
  const user = await getUser(database, userId);
  if (!user) return userNotFound();

  const metrics = {};
  const [likes, announcements] = await Promise.all([
    (async () => {
      const start = nowMs();
      const result = await getLikes(database, userId, now);
      metrics.LIKES_MS = roundedDuration(start);
      return result;
    })(),
    (async () => {
      const start = nowMs();
      const result = await getActiveAnnouncements(database, now);
      metrics.ANNOUNCEMENTS_MS = roundedDuration(start);
      return result;
    })()
  ]);
  metrics.DEFERRED_UI_TOTAL_MS = roundedDuration(totalStart);
  const bootId = resolveWorkerBootId(url.searchParams.get('bootId'));
  const body = {
    success: true,
    registered: true,
    likes,
    announcements,
    announcement: announcements[0] || null,
    bootId,
    observability: {
      timing: {
        status: 'success',
        metrics
      }
    }
  };
  return jsonResponse(body, 200, serverTimingHeaders(metrics, database.queryCount));
};

const buildOrderPageResponse = async (database, url, now) => {
  const userId = requiredUserId(url);
  const targetDate = normalizeDateOnly(url.searchParams.get('targetDate'));
  if (!userId) return jsonResponse({ error: 'USER_ID_REQUIRED' }, 400);
  if (!targetDate) return jsonResponse({ error: 'INVALID_DATE' }, 400);

  const user = await getUser(database, userId);
  if (!user) return userNotFound();

  const setting = await getCalendarSetting(database, targetDate);
  if (!setting || !setting.vendor) {
    return jsonResponse({
      error: 'ORDER_PAGE_SETTING_NOT_FOUND'
    }, 404);
  }

  const [menu, myOrder] = await Promise.all([
    getOrderPageMenu(database, setting.vendor, targetDate),
    getUserOrder(database, userId, targetDate)
  ]);
  return jsonResponse({
    success: true,
    setting,
    deadline: getDeadlineInfo(targetDate, setting.mode, now),
    menu,
    myOrder
  });
};

export async function handleRequest(request, env, options = {}) {
  if (request.method === 'OPTIONS') return emptyResponse();
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const url = new URL(request.url);
  const now = options.now instanceof Date ? options.now : new Date();

  if (url.pathname === '/api/health') {
    try {
      const database = createDatabaseContext(requireDatabase(env));
      const row = await database.prepare('SELECT COUNT(*) AS users FROM users').first();
      return jsonResponse({
        ok: true,
        database: true,
        users: asNumber(row?.users)
      });
    } catch {
      return jsonResponse({
        ok: false,
        database: false,
        users: 0,
        error: 'DATABASE_UNAVAILABLE'
      }, 503);
    }
  }

  try {
    const database = createDatabaseContext(requireDatabase(env));
    const userPath = url.pathname.match(/^\/api\/users\/([^/]+)$/);

    if (userPath) {
      let lineUserId;
      try {
        lineUserId = decodeURIComponent(userPath[1]).trim();
      } catch {
        return jsonResponse({ error: 'INVALID_USER_ID' }, 400);
      }
      if (!lineUserId) return jsonResponse({ error: 'USER_ID_REQUIRED' }, 400);

      const user = await getUser(database, lineUserId);
      return user ? jsonResponse(getDiagnosticUser(user)) : userNotFound();
    }

    if (url.pathname === '/api/orders') {
      const userId = requiredUserId(url);
      if (!userId) return jsonResponse({ error: 'USER_ID_REQUIRED' }, 400);
      return jsonResponse({ orders: await getOrders(database, userId) });
    }

    if (url.pathname === '/api/bootstrap') {
      return buildPrimaryResponse(database, url, now);
    }

    if (url.pathname === '/api/bootstrap/deferred') {
      return buildDeferredResponse(database, url, now);
    }

    if (url.pathname === '/api/order-page') {
      return buildOrderPageResponse(database, url, now);
    }

    return jsonResponse({ error: 'NOT_FOUND' }, 404);
  } catch {
    return jsonResponse({ error: 'INTERNAL_SERVER_ERROR' }, 500);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
