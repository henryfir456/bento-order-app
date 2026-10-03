import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { getCustomerMenu } from '../src/domain/menu.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { request, seedMenuVersion, seedUser } from './helpers/formal-fixtures.js';

const NOW = new Date('2026-10-02T18:00:00.000Z');
const SOURCE_HTML = `<script>const menuData = [
  { date: "2026/10/03", title: "今日風味餐", img: "E05.jpg", note: "每日介紹" },
  { date: "2026/10/04", title: "明日風味餐", img: "E06.jpg" }
];</script>`;
const identities = {
  Admin: { token: 'daily-admin-token', lineUserId: 'daily-admin' },
  ProxyAdmin: { token: 'daily-proxy-token', lineUserId: 'daily-proxy' },
  User: { token: 'daily-user-token', lineUserId: 'daily-user' }
};

const databaseWithUsers = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'daily-admin', role: 'Admin' });
  seedUser(database, { lineUserId: 'daily-proxy', role: 'ProxyAdmin' });
  seedUser(database, { lineUserId: 'daily-user', role: 'User' });
  return database;
};

const call = async (database, path, {
  role = 'Admin', method = 'GET', body
} = {}) => {
  const identity = identities[role];
  const response = await handleFormalRequest(
    request(path, { method, token: identity.token, ...(body === undefined ? {} : { body }) }),
    { DB: database },
    {
      now: NOW,
      fetchImpl: async (url, init) => {
        if (url === 'https://api.line.me/v2/profile') {
          if (init?.headers?.Authorization !== `Bearer ${identity.token}`) {
            return Response.json({}, { status: 401 });
          }
          return Response.json({ userId: identity.lineUserId, displayName: identity.lineUserId });
        }
        if (url === 'https://www.vegetsai.com.tw/products.html') {
          return new Response(SOURCE_HTML, { status: 200 });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
    }
  );
  return { response, body: response.status === 204 ? null : await response.json() };
};

test('daily flavor admin endpoints are Admin-only and reject View As', async () => {
  const database = databaseWithUsers();

  for (const role of ['User', 'ProxyAdmin']) {
    const denied = await call(database, '/api/admin/daily-flavors/sync-status', { role });
    assert.equal(denied.response.status, 403, role);
  }
  const viewAs = await call(database, '/api/admin/daily-flavors/sync-status?viewAs=daily-user');
  assert.equal(viewAs.response.status, 403);

  const status = await call(database, '/api/admin/daily-flavors/sync-status');
  assert.equal(status.response.status, 200);
  assert.equal(status.body.success, true);
  assert.equal(JSON.stringify(status.body).includes('vegetsai.com.tw'), false);

  const sync = await call(database, '/api/admin/daily-flavors/sync', { method: 'POST', body: {} });
  assert.equal(sync.response.status, 200);
  assert.equal(sync.body.status, 'SUCCESS');
  assert.equal(sync.body.addedCount, 2);
});

test('order page adds a separate date/vendor flavor projection without changing menu identity or prices', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'daily-user' });
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-10-04', '蔡老師', 'A')
  `);
  seedMenuVersion(database, {
    menuVersionId: 'daily-menu-version', vendor: '蔡老師', effectiveDate: '2026-10-01'
  });
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name,
      price, enabled, source_order
    ) VALUES
      ('daily-menu-e', 'daily-menu-version', 'E', 'BASE', '舊的風味餐名稱', 105, 1, 1),
      ('daily-menu-a', 'daily-menu-version', 'A', 'BASE', '舊的風味便當名稱', 115, 1, 2),
      ('daily-menu-other', 'daily-menu-version', 'R', '', '非風味餐', 90, 1, 3)
  `);
  database.run(`
    INSERT INTO vendor_daily_flavors (
      vendor, service_date, flavor_name, description, image_url,
      source_url, source_hash, fetched_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    '蔡老師', '2026-10-04', '明日風味餐', '每日介紹',
    'https://www.vegetsai.com.tw/img/sp_meals_s/E06.jpg',
    'https://www.vegetsai.com.tw/products.html#specials',
    'a'.repeat(64), NOW.toISOString(), NOW.toISOString(), NOW.toISOString()
  );
  const expectedMenu = await getCustomerMenu(database, {
    vendor: '蔡老師', targetDate: '2026-10-04'
  });
  const { response, body } = await call(database, '/api/order-page?targetDate=2026-10-04', {
    role: 'User'
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body.dailyFlavor, {
    service_date: '2026-10-04',
    name: '明日風味餐',
    description: '每日介紹',
    image_url: 'https://www.vegetsai.com.tw/img/sp_meals_s/E06.jpg'
  });
  assert.deepEqual(body.menu, expectedMenu);
  assert.deepEqual(body.menu.map(({ item_id, item_name, price }) => ({ item_id, item_name, price })), [
    { item_id: 'E', item_name: '舊的風味餐名稱', price: 105 },
    { item_id: 'A', item_name: '舊的風味便當名稱', price: 115 },
    { item_id: 'FR', item_name: '非風味餐', price: 90 }
  ]);
});
