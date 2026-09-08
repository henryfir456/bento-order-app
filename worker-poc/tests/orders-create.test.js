import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prepareStatement } from '../src/db/transactions.js';
import {
  callOrderRoute,
  ORDER_DATE,
  seedOrderDatabase,
  userProfile
} from './helpers/order-fixtures.js';

const create = (database, body, key, profile = userProfile()) => callOrderRoute(
  database,
  '/api/orders',
  {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': key }
  },
  profile
);

test('order creation uses server menu prices and preserves negative balances', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const result = await create(database, {
    targetDate: ORDER_DATE,
    pickupFloor: '1樓',
    userId: 'forged-user',
    items: [
      { menu_item_id: 'menu-a', quantity: 2, unit_price: 1, subtotal: 1 },
      { menu_item_id: 'menu-b', quantity: 1, unit_price: 1, subtotal: 1 }
    ],
    note: 'server pricing'
  }, 'create-price');

  assert.equal(result.response.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.newBalance, -90);
  const order = database.get(`
    SELECT order_id, line_user_id, total_amount, status
    FROM orders
    WHERE line_user_id = ?
  `, 'user-1');
  assert.equal(order.total_amount, 190);
  assert.equal(order.status, 'ACTIVE');
  const items = database.database.prepare(`
    SELECT menu_item_id, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal
    FROM order_items
    WHERE order_id = ?
    ORDER BY line_no
  `).all(order.order_id);
  assert.deepEqual(items.map((item) => ({
    menu_item_id: item.menu_item_id,
    legacy_item_id: item.legacy_item_id,
    item_name_snapshot: item.item_name_snapshot,
    quantity: item.quantity,
    unit_price: item.unit_price,
    subtotal: item.subtotal
  })), [
    {
      menu_item_id: 'menu-a',
      legacy_item_id: 'legacy-duplicate',
      item_name_snapshot: 'Item A',
      quantity: 2,
      unit_price: 80,
      subtotal: 160
    },
    {
      menu_item_id: 'menu-b',
      legacy_item_id: 'legacy-duplicate',
      item_name_snapshot: 'Item B',
      quantity: 1,
      unit_price: 30,
      subtotal: 30
    }
  ]);
  const ledger = database.get(`
    SELECT amount, balance_after, type, reference_id
    FROM balance_ledger
    WHERE type = 'ORDER'
  `);
  assert.deepEqual({
    amount: ledger.amount,
    balance_after: ledger.balance_after,
    type: ledger.type,
    reference_id: ledger.reference_id
  }, { amount: -190, balance_after: -90, type: 'ORDER', reference_id: order.order_id });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM order_status_history').count, 1);
});

test('duplicate legacy item IDs remain selectable by distinct internal keys', async () => {
  const database = seedOrderDatabase();
  const result = await create(database, {
    target_date: ORDER_DATE,
    pickup_floor: '1樓',
    items: [
      { menu_item_id: 'menu-a', quantity: 1 },
      { menu_item_id: 'menu-b', quantity: 1 }
    ]
  }, 'create-duplicate-internal');
  assert.equal(result.response.status, 200);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM order_items').count, 2);
  assert.equal(database.get('SELECT total_amount FROM orders WHERE status = \'ACTIVE\'').total_amount, 110);
});

test('legacy duplicate item IDs are rejected as ambiguous and disabled rows are not orderable', async () => {
  const database = seedOrderDatabase();
  const ambiguous = await create(database, {
    targetDate: ORDER_DATE,
    pickupFloor: '1樓',
    items: [{ item_id: 'legacy-duplicate', quantity: 1 }]
  }, 'create-ambiguous');
  assert.equal(ambiguous.response.status, 400);
  assert.equal(ambiguous.body.error, 'MENU_ITEM_AMBIGUOUS');

  const disabled = await create(database, {
    targetDate: ORDER_DATE,
    pickupFloor: '1樓',
    items: [{ menu_item_id: 'menu-disabled', quantity: 1 }]
  }, 'create-disabled');
  assert.equal(disabled.response.status, 400);
  assert.equal(disabled.body.error, 'MENU_ITEM_DISABLED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 0);
});

test('replacement refunds the old order and charges the new order atomically', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const first = await create(database, {
    targetDate: ORDER_DATE,
    pickupFloor: '1樓',
    items: [{ menu_item_id: 'menu-a', quantity: 1 }]
  }, 'replace-first');
  const second = await create(database, {
    targetDate: ORDER_DATE,
    pickupFloor: '9樓',
    items: [{ menu_item_id: 'menu-b', quantity: 1 }]
  }, 'replace-second');
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.newBalance, 70);
  assert.notEqual(first.body.orderId, second.body.orderId);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE status = 'ACTIVE'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE status = 'CANCELLED'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'ORDER'").count, 2);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'").count, 1);
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 70);
  assert.equal(database.get(`
    SELECT SUM(amount) AS amount
    FROM balance_ledger
    WHERE line_user_id = 'user-1'
  `).amount, -30);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM order_status_history
    WHERE order_id = ? AND from_status = 'ACTIVE' AND to_status = 'CANCELLED'
  `, first.body.orderId).count, 1);
});

test('same order request returns the stored response without another deduction', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const body = {
    targetDate: ORDER_DATE,
    pickupFloor: '1樓',
    items: [{ menu_item_id: 'menu-a', quantity: 1 }]
  };
  const first = await create(database, body, 'create-retry');
  const retry = await create(database, { ...body, unit_price: 999 }, 'create-retry');
  assert.equal(first.response.status, 200);
  assert.equal(retry.response.status, 200);
  assert.deepEqual(retry.body, first.body);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 1);
  assert.equal(database.get('SELECT balance FROM users WHERE line_user_id = \'user-1\'').balance, 20);

  const conflict = await create(database, {
    ...body,
    items: [{ menu_item_id: 'menu-b', quantity: 1 }]
  }, 'create-retry');
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error, 'IDEMPOTENCY_CONFLICT');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 1);
});

test('order, balance, status, and idempotency rows roll back together on a late failure', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const originalBatch = database.batch.bind(database);
  database.batch = (statements) => originalBatch([
    ...statements,
    prepareStatement(database, `
      INSERT INTO users (line_user_id, display_name, pickup_floor, balance, role)
      VALUES (?, ?, ?, ?, ?)
    `, ['user-1', 'duplicate', '1樓', 999, 'User'])
  ]);
  const result = await create(database, {
    targetDate: ORDER_DATE,
    pickupFloor: '1樓',
    items: [{ menu_item_id: 'menu-a', quantity: 1 }]
  }, 'order-rollback');
  assert.equal(result.response.status, 409);
  assert.equal(result.body.error, 'MUTATION_CONFLICT');
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 100);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM order_items').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM order_status_history').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM idempotency_keys').count, 0);
});

test('mutation rejects View As instead of changing the mutation actor', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const result = await callOrderRoute(
    database,
    '/api/orders?viewAs=user-1',
    {
      method: 'POST',
      body: {
        targetDate: ORDER_DATE,
        pickupFloor: '1樓',
        items: [{ menu_item_id: 'menu-a', quantity: 1 }]
      },
      headers: { 'Idempotency-Key': 'view-as-mutation' }
    },
    { ...userProfile('admin-1', 'token-admin') }
  );
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, 'VIEW_AS_FORBIDDEN');
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'admin-1'").balance, 0);
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 100);
});
