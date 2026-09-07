import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import {
  profileFetch,
  request,
  seedMenuVersion,
  seedUser
} from './helpers/formal-fixtures.js';

const NOW = new Date('2026-09-07T01:00:00.000Z');

const seedReadOnlyDatabase = () => {
  const database = new SqliteD1();
  seedUser(database, {
    lineUserId: 'user-1',
    displayName: 'User One',
    pickupFloor: '1樓',
    balance: -10
  });
  seedUser(database, {
    lineUserId: 'user-2',
    displayName: 'User Two',
    pickupFloor: '9樓'
  });
  seedUser(database, {
    lineUserId: 'admin-1',
    displayName: 'Admin One',
    pickupFloor: '1樓',
    role: 'Admin'
  });
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES (?, ?, ?)
  `, '2026-09-08', 'Vendor A', 'A');
  seedMenuVersion(database, {
    menuVersionId: 'version-1',
    vendor: 'Vendor A',
    effectiveDate: '2026-09-01'
  });
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, enabled, source_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, 'menu-1', 'version-1', 'legacy-duplicate', 'Enabled A', 80, 1, 1);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, enabled, source_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, 'menu-2', 'version-1', 'legacy-duplicate', 'Enabled B', 90, 1, 2);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, enabled, source_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, 'menu-disabled', 'version-1', 'legacy-disabled', 'Disabled', 100, 0, 3);
  database.run(`
    INSERT INTO announcements (
      announcement_id, title, content, start_date, end_date, enabled, source_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, 'announcement-active', 'Active', 'Visible', '2026-09-01', '2026-09-30', 1, 1);
  database.run(`
    INSERT INTO announcements (
      announcement_id, title, content, start_date, end_date, enabled, source_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, 'announcement-disabled', 'Disabled', 'Hidden', '2026-09-01', '2026-09-30', 0, 2);
  database.run(`
    INSERT INTO orders (
      order_id, line_user_id, order_date, vendor, pickup_floor, total_amount, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, 'order-user-1', 'user-1', '2026-09-08', 'Vendor A', '1樓', 80, 'ACTIVE');
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, 'order-user-1', 1, 'menu-1', 'legacy-duplicate', 'Enabled A', 1, 80, 80);
  database.run(`
    INSERT INTO orders (
      order_id, line_user_id, order_date, vendor, pickup_floor, total_amount, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, 'order-user-2', 'user-2', '2026-09-08', 'Vendor A', '9樓', 90, 'ACTIVE');
  database.run(`
    INSERT INTO likes (order_date, line_user_id)
    VALUES (?, ?)
  `, '2026-09-08', 'user-1');
  return database;
};

const call = async (database, path, options = {}, profile = {}) => {
  const response = await handleFormalRequest(
    request(path, options),
    { DB: database },
    {
      fetchImpl: profileFetch(profile),
      now: NOW
    }
  );
  return {
    response,
    body: await response.json()
  };
};

test('GET /api/me returns canonical user and ignores forged userId', async () => {
  const database = seedReadOnlyDatabase();
  const { response, body } = await call(
    database,
    '/api/me?userId=admin-1',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1', displayName: 'Forged Name' }
  );
  assert.equal(response.status, 200);
  assert.equal(body.user.userId, 'user-1');
  assert.equal(body.user.name, 'User One');
  assert.equal(body.user.role, 'User');
});

test('GET /api/order-page exposes enabled menu rows with stable internal keys', async () => {
  const database = seedReadOnlyDatabase();
  const { response, body } = await call(
    database,
    '/api/order-page?targetDate=2026-09-08&userId=admin-1',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(response.status, 200);
  assert.equal(body.menu.length, 2);
  assert.deepEqual(body.menu.map((item) => item.menu_item_id), ['menu-1', 'menu-2']);
  assert.deepEqual(body.menu.map((item) => item.item_id), [
    'legacy-duplicate',
    'legacy-duplicate'
  ]);
  assert.equal(body.myOrder.orderId, 'order-user-1');
  assert.equal(body.myOrder.items[0].menu_item_id, 'menu-1');
});

test('bootstrap and deferred responses are actor-scoped and preserve split data', async () => {
  const database = seedReadOnlyDatabase();
  const primary = await call(
    database,
    '/api/bootstrap?targetDate=2026-09-08',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(primary.response.status, 200);
  assert.equal(primary.body.ordersMap['2026-09-08'], true);
  assert.deepEqual(primary.body.calendar.announcements, []);

  const deferred = await call(
    database,
    '/api/bootstrap/deferred',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(deferred.response.status, 200);
  assert.equal(deferred.body.likes['2026-09-08'].isUserLiked, true);
  assert.equal(deferred.body.announcements.length, 1);
  assert.equal(deferred.body.announcement.id, 'announcement-active');
});

test('admin View As changes read subject but never authorization actor', async () => {
  const database = seedReadOnlyDatabase();
  const { response, body } = await call(
    database,
    '/api/orders/map?viewAs=user-2&userId=user-1',
    { token: 'token-admin' },
    { token: 'token-admin', lineUserId: 'admin-1' }
  );
  assert.equal(response.status, 200);
  assert.equal(body.ordersMap['2026-09-08'], true);

  const forbiddenResponse = await call(
    database,
    '/api/orders/map?viewAs=user-2',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(forbiddenResponse.response.status, 403);
  assert.equal(forbiddenResponse.body.error, 'VIEW_AS_FORBIDDEN');
});

test('formal route registration and floor update retain canonical identity', async () => {
  const database = seedReadOnlyDatabase();
  const registration = await call(
    database,
    '/api/register',
    {
      method: 'POST',
      token: 'token-new',
      body: { pickupFloor: '9樓', role: 'Admin', balance: 999 }
    },
    { token: 'token-new', lineUserId: 'new-user', displayName: 'New User' }
  );
  assert.equal(registration.response.status, 201);
  assert.equal(registration.body.user.userId, 'new-user');
  assert.equal(registration.body.user.role, 'User');
  assert.equal(registration.body.user.balance, 0);

  const floor = await call(
    database,
    '/api/me/pickup-floor',
    {
      method: 'PATCH',
      token: 'token-user',
      body: { pickupFloor: '9樓' }
    },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(floor.response.status, 200);
  assert.equal(floor.body.user.floor, '9樓');
});
