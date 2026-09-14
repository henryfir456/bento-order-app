import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import {
  profileFetch,
  request,
  seedLedgerRow,
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
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES (?, ?, ?), (?, ?, ?)
  `, '2026-09-06', 'Vendor A', 'A', '2026-09-07', 'Vendor A', 'A');
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
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'order-user-1', 'user-1', 'User One', '2026-09-08', 'Vendor A', '1樓', 80, 'ACTIVE', 'user-1');
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, 'order-user-1', 1, 'menu-1', 'legacy-duplicate', 'Enabled A', 1, 80, 80);
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'order-user-1-history', 'user-1', 'User One', '2026-09-06', 'Vendor A', '1樓', 80, 'COMPLETED', 'user-1', 'legacy_import');
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, 'order-user-1-history', 1, 'menu-1', 'legacy-duplicate', 'Enabled A', 1, 80, 80);
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'order-user-1-current-completed', 'user-1', 'User One', '2026-09-07', 'Vendor A', '1樓', 80, 'COMPLETED', 'user-1', 'legacy_import');
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'order-user-2', 'user-2', 'User Two', '2026-09-08', 'Vendor A', '9樓', 90, 'ACTIVE', 'user-2');
  database.run(`
    INSERT INTO likes (order_date, user_id)
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

test('identity and bootstrap expose the latest sequenced ledger balance', async () => {
  const database = seedReadOnlyDatabase();
  seedLedgerRow(database, {
    transactionId: 'user-1-latest-balance',
    userId: 'user-1',
    amount: 98,
    balanceAfter: 88
  });

  const me = await call(
    database,
    '/api/me',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.balance, 88);

  const bootstrap = await call(
    database,
    '/api/bootstrap',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.body.user.balance, 88);
});

test('GET /api/me returns token-derived identity for an unregistered actor without creating a user', async () => {
  const database = new SqliteD1();
  const { response, body } = await call(
    database,
    '/api/me?userId=forged-user',
    { token: 'token-new' },
    { token: 'token-new', lineUserId: 'new-user', displayName: 'New User' }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    success: true,
    registered: false,
    identityState: 'UNREGISTERED',
    authMode: 'line',
    user: null,
    lineUserId: 'new-user',
    displayName: 'New User'
  });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 0);
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

test('historical completed orders are readable while current active workflow stays active-only', async () => {
  const database = seedReadOnlyDatabase();
  const bootstrap = await call(
    database,
    '/api/bootstrap',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(bootstrap.body.ordersMap['2026-09-06'], true);
  assert.equal(bootstrap.body.ordersMap['2026-09-07'], undefined);
  assert.equal(bootstrap.body.ordersMap['2026-09-08'], true);

  const orderMap = await call(
    database,
    '/api/orders/map',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(orderMap.response.status, 200);
  assert.equal(orderMap.body.ordersMap['2026-09-06'], true);
  assert.equal(orderMap.body.ordersMap['2026-09-07'], undefined);

  const historical = await call(
    database,
    '/api/order-page?targetDate=2026-09-06',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(historical.response.status, 200);
  assert.equal(historical.body.myOrder.orderId, 'order-user-1-history');
  assert.equal(historical.body.myOrder.status, 'COMPLETED');
  assert.equal(historical.body.myOrder.readOnly, true);

  const currentCompleted = await call(
    database,
    '/api/order-page?targetDate=2026-09-07',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(currentCompleted.response.status, 200);
  assert.equal(currentCompleted.body.myOrder.orderId, '');
  assert.equal(currentCompleted.body.myOrder.status, null);
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
    '/api/bootstrap/deferred?bootId=BOOT-20260907-defer1',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(deferred.response.status, 200);
  assert.equal(deferred.body.likes['2026-09-08'].isUserLiked, true);
  assert.equal(deferred.body.announcements.length, 1);
  assert.equal(deferred.body.announcement.id, 'announcement-active');
  assert.equal(deferred.body.bootId, 'BOOT-20260907-defer1');

  const independentDeferred = await call(
    database,
    '/api/bootstrap/deferred?bootId=BOOT-20260907-defer2',
    { token: 'token-user' },
    { token: 'token-user', lineUserId: 'user-1' }
  );
  assert.equal(independentDeferred.response.status, 200);
  assert.equal(independentDeferred.body.bootId, 'BOOT-20260907-defer2');
  assert.deepEqual(independentDeferred.body.likes, deferred.body.likes);
  assert.deepEqual(independentDeferred.body.announcements, deferred.body.announcements);
});

test('deferred bootstrap rejects missing and invalid boot IDs without inventing one', async () => {
  const database = seedReadOnlyDatabase();
  for (const path of [
    '/api/bootstrap/deferred',
    '/api/bootstrap/deferred?bootId=not-a-boot-id'
  ]) {
    const { response, body } = await call(
      database,
      path,
      { token: 'token-user' },
      { token: 'token-user', lineUserId: 'user-1' }
    );
    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: 'INVALID_BOOT_ID' });
  }
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
  assert.equal(registration.response.status, 409);
  assert.equal(registration.body.error, 'EMPLOYEE_BIND_REQUIRED');

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

  assert.equal(database.get("SELECT COUNT(*) AS count FROM users WHERE user_id = 'new-user'").count, 0);
});
