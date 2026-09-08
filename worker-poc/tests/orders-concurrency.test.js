import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hashRequest,
  mutationResponseSpec,
  runIdempotentMutation
} from '../src/db/idempotency.js';
import { prepareStatement } from '../src/db/transactions.js';
import {
  callOrderRoute,
  ORDER_DATE,
  seedOrderDatabase,
  userProfile
} from './helpers/order-fixtures.js';

const create = (database, key, menuItemId = 'menu-a') => callOrderRoute(
  database,
  '/api/orders',
  {
    method: 'POST',
    body: {
      targetDate: ORDER_DATE,
      pickupFloor: '1樓',
      items: [{ menu_item_id: menuItemId, quantity: 1 }]
    },
    headers: { 'Idempotency-Key': key }
  },
  userProfile()
);

const cancel = (database, orderId, key) => callOrderRoute(
  database,
  `/api/orders/${encodeURIComponent(orderId)}/cancel`,
  {
    method: 'POST',
    headers: { 'Idempotency-Key': key }
  },
  userProfile()
);

const syntheticTopUp = async (database, key, amount) => {
  const requestHash = await hashRequest({ amount });
  const occurredAt = '2026-09-07T01:00:00.000Z';
  return runIdempotentMutation(database, {
    actorLineUserId: 'admin-1',
    operation: 'TEST_TOPUP',
    idempotencyKey: key,
    requestHash,
    claimToken: 'claim-' + key,
    occurredAt,
    responseSpec: mutationResponseSpec({
      message: 'TOPUP_TEST',
      orderId: '',
      balanceUserId: 'user-1'
    }),
    buildStatements: ({ guard }) => [
      prepareStatement(database, `
        UPDATE users
        SET balance = balance + ?, updated_at = ?
        WHERE line_user_id = ? AND ${guard.sql}
      `, [amount, occurredAt, 'user-1', ...guard.params]),
      prepareStatement(database, `
        INSERT INTO balance_ledger (
          transaction_id, line_user_id, amount, balance_after, type,
          reference_id, operator_line_user_id, note, occurred_at
        )
        SELECT ?, line_user_id, ?, balance, 'TOPUP', ?, 'admin-1', 'TEST_TOPUP', ?
        FROM users
        WHERE line_user_id = ? AND ${guard.sql}
      `, [
        'txn-' + key,
        amount,
        'topup-' + key,
        occurredAt,
        'user-1',
        ...guard.params
      ])
    ]
  });
};

test('competing replacements serialize without lost balance updates or two active orders', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const results = await Promise.all([
    create(database, 'race-replace-a', 'menu-a'),
    create(database, 'race-replace-b', 'menu-b')
  ]);
  assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 200]);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE status = 'ACTIVE'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE status = 'CANCELLED'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'ORDER'").count, 2);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'").count, 1);

  const active = database.get(`
    SELECT order_id, total_amount
    FROM orders
    WHERE line_user_id = 'user-1' AND order_date = ? AND status = 'ACTIVE'
  `, ORDER_DATE);
  const user = database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'");
  assert.equal(user.balance, 100 - active.total_amount);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM balance_ledger bl
    LEFT JOIN orders o ON o.order_id = bl.reference_id
    WHERE bl.type IN ('ORDER', 'REFUND') AND o.order_id IS NULL
  `).count, 0);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status = 'ACTIVE' AND oi.order_id IS NULL
  `).count, 0);
});

test('competing cancellations commit at most one refund and keep order state consistent', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const created = await create(database, 'race-cancel-create', 'menu-a');
  const results = await Promise.all([
    cancel(database, created.body.orderId, 'race-cancel-a'),
    cancel(database, created.body.orderId, 'race-cancel-b')
  ]);
  assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 409]);
  assert.equal(database.get("SELECT status FROM orders WHERE order_id = ?", created.body.orderId).status, 'CANCELLED');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'",).count, 1);
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 100);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM order_status_history
    WHERE order_id = ? AND from_status = 'ACTIVE' AND to_status = 'CANCELLED'
  `, created.body.orderId).count, 1);
});

test('replacement racing with cancellation leaves one consistent active-order outcome', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const created = await create(database, 'race-replace-cancel-create', 'menu-a');
  const results = await Promise.all([
    create(database, 'race-replace-cancel-replace', 'menu-b'),
    cancel(database, created.body.orderId, 'race-replace-cancel-cancel')
  ]);
  assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 200]);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE status = 'ACTIVE'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'",).count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'ORDER'",).count, 2);
  const active = database.get("SELECT total_amount FROM orders WHERE status = 'ACTIVE'");
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 100 - active.total_amount);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM balance_ledger bl
    JOIN orders o ON o.order_id = bl.reference_id
    WHERE bl.type = 'REFUND' AND o.status <> 'CANCELLED'
  `).count, 0);
});

test('competing retries with one idempotency key return one order and one deduction', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const results = await Promise.all([
    create(database, 'race-same-key', 'menu-a'),
    create(database, 'race-same-key', 'menu-a')
  ]);
  assert.deepEqual(results.map((result) => result.response.status), [200, 200]);
  assert.equal(results[0].body.orderId, results[1].body.orderId);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'ORDER'",).count, 1);
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 20);
});

test('competing top-up-shaped balance mutations preserve every ledger delta', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const results = await Promise.all([
    syntheticTopUp(database, 'race-topup-a', 10),
    syntheticTopUp(database, 'race-topup-b', 20)
  ]);
  assert.deepEqual(results.map((result) => result.success), [true, true]);
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 130);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'TOPUP'",).count, 2);
  assert.equal(database.get(`
    SELECT SUM(amount) AS amount
    FROM balance_ledger
    WHERE line_user_id = 'user-1'
  `).amount, 30);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM balance_ledger
    WHERE type = 'TOPUP' AND reference_id IN ('topup-race-topup-a', 'topup-race-topup-b')
  `).count, 2);
});
