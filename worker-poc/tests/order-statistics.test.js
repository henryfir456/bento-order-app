import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedLedgerRow, seedUser } from './helpers/formal-fixtures.js';

const NOW = new Date('2026-02-01T15:30:00.000Z');

const addOrder = (database, {
  orderId,
  userId = 'user-1',
  createdByUserId = userId,
  date,
  vendor = '店家甲',
  status = 'ACTIVE',
  items
}) => {
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'line')
  `, orderId, userId, userId, date, vendor, '1樓',
  items.reduce((sum, item) => sum + item.quantity * item.price, 0),
  status, createdByUserId);
  items.forEach((item, index) => database.run(`
    INSERT INTO order_items (
      order_id, line_no, item_name_snapshot, quantity, unit_price, subtotal
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, orderId, index + 1, item.name, item.quantity, item.price, item.quantity * item.price));
};

const stats = async (database, path = '/api/orders/statistics?period=all', profile = {}) => {
  const response = await handleFormalRequest(
    request(path, { token: profile.token || 'token-user' }),
    { DB: database },
    {
      fetchImpl: profileFetch(profile),
      now: NOW
    }
  );
  return { response, body: await response.json() };
};

const seedStatisticsDatabase = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', displayName: 'Purchaser' });
  seedUser(database, { lineUserId: 'user-2', displayName: 'Other Purchaser' });
  seedUser(database, { lineUserId: 'admin-1', displayName: 'Order Operator', role: 'Admin' });

  addOrder(database, {
    orderId: 'old-year',
    date: '2025-12-31',
    vendor: '店家舊',
    status: 'COMPLETED',
    items: [{ name: '舊年度餐點', quantity: 4, price: 80 }]
  });
  addOrder(database, {
    orderId: 'multi-quantity',
    date: '2026-01-31',
    vendor: '店家甲',
    status: 'COMPLETED',
    items: [
      { name: '便當甲', quantity: 2, price: 80 },
      { name: '便當甲', quantity: 1, price: 80 },
      { name: '手續費減免', quantity: 1, price: 0 },
      { name: '免費加飯', quantity: 1, price: 0 },
      { name: '1元', quantity: 1, price: 1 }
    ]
  });
  addOrder(database, {
    orderId: 'delegated-purchase',
    userId: 'user-1',
    createdByUserId: 'admin-1',
    date: '2026-02-01',
    vendor: '店家乙',
    items: [
      { name: '便當乙', quantity: 2, price: 90 },
      { name: '套餐加價1元', quantity: 1, price: 91 }
    ]
  });
  addOrder(database, {
    orderId: 'special-only-day',
    date: '2026-01-29',
    vendor: '店家乙',
    items: [
      { name: '手續費減免', quantity: 1, price: 0 },
      { name: '免費加飯', quantity: 1, price: 0 },
      { name: '1元', quantity: 1, price: 1 }
    ]
  });
  addOrder(database, {
    orderId: 'future',
    date: '2026-02-02',
    items: [{ name: '未來餐點', quantity: 9, price: 90 }]
  });
  addOrder(database, {
    orderId: 'cancelled',
    date: '2026-01-15',
    status: 'CANCELLED',
    items: [{ name: '取消餐點', quantity: 7, price: 70 }]
  });
  addOrder(database, {
    orderId: 'refunded',
    date: '2026-01-20',
    items: [{ name: '退款餐點', quantity: 6, price: 60 }]
  });
  seedLedgerRow(database, {
    transactionId: 'refund-statistics',
    userId: 'user-1',
    amount: 60,
    balanceAfter: 60,
    type: 'REFUND',
    referenceId: 'refunded'
  });
  addOrder(database, {
    orderId: 'another-user',
    userId: 'user-2',
    date: '2026-02-01',
    items: [{ name: '其他人的便當', quantity: 8, price: 80 }]
  });
  return database;
};

test('all-time statistics exclude exact special snapshots, cancelled/refunded/future orders and count actual purchaser', async () => {
  const { response, body } = await stats(seedStatisticsDatabase());
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.period, 'all');
  assert.equal(body.endDate, '2026-02-01', 'UTC time is converted to the current Taipei date');
  assert.equal(body.totalPortions, 10);
  assert.equal(body.totalOrderDays, 3);
  assert.equal(body.totalMealTypes, 5, 'unverified snapshot lines remain separate meal types');
  assert.deepEqual(Object.fromEntries(body.vendors.map(({ name, portions }) => [name, portions])), {
    店家舊: 4,
    店家甲: 3,
    店家乙: 3
  });
  const matchingSnapshots = body.items.filter(({ name }) => name === '便當甲');
  assert.equal(matchingSnapshots.length, 2);
  assert.deepEqual(matchingSnapshots.map((item) => item.portions), [2, 1]);
  assert.equal(matchingSnapshots[0].vendor, '店家甲');
  assert.equal(matchingSnapshots[0].variantKey, '');
  assert.notEqual(matchingSnapshots[0].identityKey, matchingSnapshots[1].identityKey);
  assert.ok(matchingSnapshots.every((item) => item.resolved === false
    && item.resolutionStatus === 'not_found'));
  assert.ok(!body.items.some(({ name }) => ['手續費減免', '免費加飯', '1元', '退款餐點', '未來餐點', '取消餐點', '其他人的便當'].includes(name)));
});

test('year and month statistics use server-authoritative Taipei date boundaries', async () => {
  const database = seedStatisticsDatabase();
  const year = await stats(database, '/api/orders/statistics?period=year');
  const month = await stats(database, '/api/orders/statistics?period=month');
  assert.equal(year.body.startDate, '2026-01-01');
  assert.equal(year.body.endDate, '2026-02-01');
  assert.equal(year.body.totalPortions, 6);
  assert.equal(year.body.totalOrderDays, 2);
  assert.equal(year.body.totalMealTypes, 4, 'the two unverified January lines remain separate identities');
  assert.equal(month.body.startDate, '2026-02-01');
  assert.equal(month.body.endDate, '2026-02-01');
  assert.equal(month.body.totalPortions, 3);
  assert.equal(month.body.totalOrderDays, 1);
  assert.equal(month.body.totalMealTypes, 2);
});

test('statistics endpoint binds to the authenticated purchaser and rejects caller-selected identities', async () => {
  const database = seedStatisticsDatabase();
  const valid = await stats(database);
  assert.equal(valid.body.totalPortions, 10);
  const forged = await stats(database, '/api/orders/statistics?period=all&userId=user-2');
  assert.equal(forged.response.status, 400);
  assert.equal(forged.body.error, 'INVALID_QUERY');
  const target = await stats(database, '/api/orders/statistics?targetUserId=user-2');
  assert.equal(target.response.status, 400);
  assert.equal(target.body.error, 'INVALID_QUERY');
});

test('empty history returns a zeroed summary without vendor or item rows', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', displayName: 'Purchaser' });
  const { response, body } = await stats(database, '/api/orders/statistics?period=month');
  assert.equal(response.status, 200);
  assert.equal(body.totalPortions, 0);
  assert.equal(body.totalOrderDays, 0);
  assert.equal(body.totalMealTypes, 0);
  assert.deepEqual(body.vendors, []);
  assert.deepEqual(body.items, []);
});


test('Admin View As reads selected purchaser; normal User cannot forge View As', async () => {
  const database = seedStatisticsDatabase();
  const admin = { token: 'admin-token', lineUserId: 'admin-1' };
  const own = await stats(database, '/api/orders/statistics', admin);
  assert.equal(own.response.status, 200);
  assert.equal(own.body.totalPortions, 0);
  const userOne = await stats(database, '/api/orders/statistics?viewAs=user-1', admin);
  assert.equal(userOne.response.status, 200);
  assert.equal(userOne.body.totalPortions, 10);
  const userTwo = await stats(database, '/api/orders/statistics?viewAs=user-2', admin);
  assert.equal(userTwo.response.status, 200);
  assert.equal(userTwo.body.totalPortions, 8);
  const forbidden = await stats(database, '/api/orders/statistics?viewAs=user-2');
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.body.error, 'VIEW_AS_FORBIDDEN');
  const ambiguous = await stats(database, '/api/orders/statistics?viewAs=user-1&viewAs=user-2', admin);
  assert.equal(ambiguous.response.status, 400);
});
