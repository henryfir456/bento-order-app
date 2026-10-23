import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  handleFormalRequest,
  profileFetch,
  request,
  seedUser,
  seedVendor
} from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-10-20T04:00:00.000Z');
const VENDOR = 'Synthetic Footprint Bento';

const call = async (database, path, { token, lineUserId } = {}) => {
  const response = await handleFormalRequest(
    request(path, { token }),
    { DB: database },
    { fetchImpl: profileFetch({ token, lineUserId, displayName: 'Synthetic Actor' }), now: NOW }
  );
  return { response, body: await response.json() };
};

const vendorUser = { token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor' };
const employee = { token: 'synthetic-employee-token', lineUserId: 'synthetic-line-employee' };

const seed = () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-fp-vendor', name: VENDOR });
  seedVendor(database, { vendorId: 'synthetic-other-vendor', name: 'Synthetic Other Bento' });
  seedUser(database, { userId: 'synthetic-vendor-user', lineUserId: vendorUser.lineUserId, employeeId: null });
  seedUser(database, { userId: 'synthetic-employee', lineUserId: employee.lineUserId, role: 'User' });
  database.run(`INSERT INTO vendor_principals (user_id, principal_role, status) VALUES ('synthetic-vendor-user', 'Vendor', 'ACTIVE')`);
  database.run(`INSERT INTO vendor_memberships (user_id, vendor_id, status) VALUES ('synthetic-vendor-user', 'synthetic-fp-vendor', 'ACTIVE')`);
  database.run('INSERT INTO menu_versions (menu_version_id, vendor, effective_date) VALUES (?, ?, ?)', 'v1', VENDOR, '2025-01-01');
  database.run(`INSERT INTO menu_items (menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name, price, enabled, source_order) VALUES ('v1-a', 'v1', 'A', 'BASE', 'Dish A', 100, 1, 1)`);
  database.run(`INSERT INTO menu_items (menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name, price, enabled, source_order) VALUES ('v1-b', 'v1', 'B', 'BASE', 'Dish B', 120, 1, 2)`);
  return database;
};

let counter = 0;
const addOrder = (database, { date, status = 'ACTIVE', vendorId = 'synthetic-fp-vendor', items }) => {
  counter += 1;
  const orderId = `fp-order-${counter}`;
  const buyer = `fp-buyer-${counter}`;
  seedUser(database, { userId: buyer, lineUserId: `synthetic-line-${buyer}`, employeeId: `FP-${counter}` });
  database.run(`
    INSERT INTO orders (order_id, user_id, display_name_snapshot, order_date, vendor, vendor_id, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode, created_at, updated_at)
    VALUES (?, ?, 'Synthetic Buyer', ?, ?, ?, '1樓', 0, ?, ?, ?, ?, ?)
  `, orderId, buyer, date, VENDOR, vendorId, status, buyer, status === 'COMPLETED' ? 'legacy_import' : 'line',
  `${date}T01:00:00.000Z`, `${date}T01:00:00.000Z`);
  items.forEach(({ menuItemId, legacyItemId, name, quantity, price }, index) => {
    database.run(`
      INSERT INTO order_items (order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, orderId, index + 1, menuItemId, legacyItemId, name, quantity, price, quantity * price);
  });
};

const dishA = (quantity = 1) => ({ menuItemId: 'v1-a', legacyItemId: 'A', name: 'Dish A', quantity, price: 100 });
const dishB = (quantity = 1) => ({ menuItemId: 'v1-b', legacyItemId: 'B', name: 'Dish B', quantity, price: 120 });

test('a vendor sees what it sold by dish, through yesterday, for the chosen period', async () => {
  const database = seed();
  addOrder(database, { date: '2026-09-15', items: [dishA(2)] });
  addOrder(database, { date: '2026-10-05', items: [dishA(1), dishB(1)] });
  addOrder(database, { date: '2026-10-06', items: [dishB(3)] });
  addOrder(database, { date: '2026-10-07', status: 'CANCELLED', items: [dishB(9)] });
  addOrder(database, { date: '2026-10-20', items: [dishA(5)] }); // today: still open
  addOrder(database, { date: '2026-10-08', vendorId: 'synthetic-other-vendor', items: [dishA(7)] });
  addOrder(database, { date: '2025-12-31', status: 'COMPLETED', items: [dishA(4)] });
  // History line without a menu identity stays its own group.
  addOrder(database, { date: '2026-10-09', items: [{ menuItemId: null, legacyItemId: 'H2', name: 'Half Rice Special', quantity: 1, price: 90 }] });
  addOrder(database, { date: '2026-10-09', items: [{ menuItemId: null, legacyItemId: 'FREE', name: '免費加飯', quantity: 1, price: 0 }] });

  const all = await call(database, '/api/vendor/footprints', vendorUser);
  assert.equal(all.response.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.period, 'all');
  assert.equal(all.body.totalPortions, 2 + 1 + 1 + 3 + 4 + 1);
  assert.equal(all.body.totalOrderDays, 5);
  assert.equal(all.body.totalMealTypes, 3);
  assert.equal(all.body.totalAmountTwd, 2 * 100 + 100 + 120 + 360 + 400 + 90);
  assert.deepEqual(all.body.items.map((item) => [item.name, item.portions]),
    [['Dish A', 7], ['Dish B', 4], ['Half Rice Special', 1]]);
  assert.equal(all.body.items[2].resolved, false);

  const year = await call(database, '/api/vendor/footprints?period=year', vendorUser);
  assert.equal(year.body.startDate, '2026-01-01');
  assert.equal(year.body.totalPortions, 2 + 1 + 1 + 3 + 1);

  const month = await call(database, '/api/vendor/footprints?period=month', vendorUser);
  assert.equal(month.body.startDate, '2026-10-01');
  assert.equal(month.body.totalPortions, 1 + 1 + 3 + 1);
  assert.deepEqual(month.body.items.map((item) => item.name), ['Dish B', 'Dish A', 'Half Rice Special']);
});

test('footprints stay read-only and vendor-only, and reject unknown queries', async () => {
  const database = seed();
  addOrder(database, { date: '2026-10-05', items: [dishA(1)] });
  assert.equal((await call(database, '/api/vendor/footprints', employee)).response.status, 403);
  assert.ok([401, 403].includes((await call(database, '/api/vendor/footprints', {})).response.status));
  assert.equal((await call(database, '/api/vendor/footprints?period=decade', vendorUser)).response.status, 400);
  assert.equal((await call(database, '/api/vendor/footprints?vendorId=synthetic-other-vendor', vendorUser)).response.status, 400);
  const mine = await call(database, '/api/vendor/footprints?period=month', vendorUser);
  assert.equal(mine.body.totalPortions, 1);
});
