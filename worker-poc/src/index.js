const TIME_ZONE = 'Asia/Taipei';

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Origin': '*'
};

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8'
  }
});

const emptyResponse = (status = 204) => new Response(null, {
  status,
  headers: CORS_HEADERS
});

const asText = (value) => (value === null || value === undefined ? '' : String(value));

const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const asRows = (result) => {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
};

const getTaipeiDate = (date) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: TIME_ZONE,
    year: 'numeric'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const requireDatabase = (env) => {
  if (!env?.DB || typeof env.DB.prepare !== 'function') {
    throw new Error('D1 binding is unavailable');
  }
  return env.DB;
};

const getUser = async (database, lineUserId) => {
  const row = await database
    .prepare(`
      SELECT line_user_id, display_name, pickup_floor, balance, role
      FROM users
      WHERE line_user_id = ?
    `)
    .bind(lineUserId)
    .first();

  if (!row) return null;
  return {
    line_user_id: asText(row.line_user_id),
    display_name: asText(row.display_name),
    pickup_floor: asText(row.pickup_floor),
    balance: asNumber(row.balance),
    role: asText(row.role)
  };
};

const getOrders = async (database, lineUserId) => {
  const result = await database
    .prepare(`
      SELECT order_id, order_date, vendor, line_user_id, item_id, item_name,
             quantity, unit_price, subtotal, pickup_floor, note, created_at
      FROM orders
      WHERE line_user_id = ?
      ORDER BY order_date DESC, created_at DESC
    `)
    .bind(lineUserId)
    .all();

  return asRows(result).map((row) => ({
    order_id: asText(row.order_id),
    order_date: asText(row.order_date),
    vendor: asText(row.vendor),
    line_user_id: asText(row.line_user_id),
    item_id: asText(row.item_id),
    item_name: asText(row.item_name),
    quantity: asNumber(row.quantity),
    unit_price: asNumber(row.unit_price),
    subtotal: asNumber(row.subtotal),
    pickup_floor: asText(row.pickup_floor),
    note: asText(row.note),
    created_at: asText(row.created_at)
  }));
};

const getSettings = async (database) => {
  const result = await database
    .prepare(`
      SELECT setting_key, setting_value
      FROM settings
      ORDER BY setting_key ASC
    `)
    .all();

  return asRows(result).reduce((settings, row) => {
    const key = asText(row.setting_key);
    if (key) settings[key] = asText(row.setting_value);
    return settings;
  }, {});
};

const getAnnouncements = async (database, now) => {
  const result = await database
    .prepare(`
      SELECT id, title, content, start_date, end_date, enabled
      FROM announcements
      ORDER BY start_date DESC, id ASC
    `)
    .all();
  const today = getTaipeiDate(now);

  return asRows(result)
    .filter((row) => Number(row.enabled) === 1)
    .filter((row) => (
      asText(row.start_date) <= today
      && today <= asText(row.end_date)
    ))
    .map((row) => ({
      id: asText(row.id),
      title: asText(row.title),
      content: asText(row.content),
      start_date: asText(row.start_date),
      end_date: asText(row.end_date)
    }));
};

const getMenu = async (database) => {
  const result = await database
    .prepare(`
      SELECT menu_date, vendor, item_id, item_name, price, note, image_url
      FROM menu
      ORDER BY menu_date ASC, vendor ASC, item_id ASC
    `)
    .all();

  return asRows(result).map((row) => ({
    menu_date: asText(row.menu_date),
    vendor: asText(row.vendor),
    item_id: asText(row.item_id),
    item_name: asText(row.item_name),
    price: asNumber(row.price),
    note: asText(row.note),
    image_url: asText(row.image_url)
  }));
};

const requiredUserId = (url) => {
  const userId = url.searchParams.get('userId');
  return userId && userId.trim() ? userId.trim() : null;
};

const userNotFound = () => jsonResponse({ error: 'USER_NOT_FOUND' }, 404);

export async function handleRequest(request, env, options = {}) {
  if (request.method === 'OPTIONS') return emptyResponse();
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const url = new URL(request.url);
  const now = options.now instanceof Date ? options.now : new Date();

  if (url.pathname === '/api/health') {
    try {
      const database = requireDatabase(env);
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
    const database = requireDatabase(env);
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
      return user ? jsonResponse(user) : userNotFound();
    }

    if (url.pathname === '/api/orders') {
      const userId = requiredUserId(url);
      if (!userId) return jsonResponse({ error: 'USER_ID_REQUIRED' }, 400);
      return jsonResponse({ orders: await getOrders(database, userId) });
    }

    if (url.pathname === '/api/bootstrap') {
      const userId = requiredUserId(url);
      if (!userId) return jsonResponse({ error: 'USER_ID_REQUIRED' }, 400);

      const user = await getUser(database, userId);
      if (!user) return userNotFound();

      const [orders, settings, announcements, menu] = await Promise.all([
        getOrders(database, userId),
        getSettings(database),
        getAnnouncements(database, now),
        getMenu(database)
      ]);

      return jsonResponse({
        user,
        orders,
        settings,
        announcements,
        menu
      });
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
