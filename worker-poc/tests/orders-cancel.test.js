import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  callOrderRoute,
  ORDER_DATE,
  ORDER_NOW,
  seedOrderDatabase,
  userProfile
} from './helpers/order-fixtures.js';

const create = (database, key) => callOrderRoute(
  database,
  '/api/orders',
  {
    method: 'POST',
    body: {
      targetDate: ORDER_DATE,
      pickupFloor: '1樓',
      items: [{ menu_item_id: 'menu-a', quantity: 1 }]
    },
    headers: { 'Idempotency-Key': key }
  },
  userProfile()
);

const cancel = (database, orderId, key, profile = userProfile(), now = ORDER_NOW) => callOrderRoute(
  database,
  `/api/orders/${encodeURIComponent(orderId)}/cancel`,
  {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    now
  },
  profile
);

test('cancellation refunds the stored total and appends one status and ledger transition', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const created = await create(database, 'cancel-create');
  const cancelled = await cancel(database, created.body.orderId, 'cancel-once');

  assert.equal(created.response.status, 200);
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.success, true);
  assert.equal(cancelled.body.orderId, created.body.orderId);
  assert.equal(cancelled.body.newBalance, 100);
  assert.equal(database.get("SELECT status FROM orders WHERE order_id = ?", created.body.orderId).status, 'CANCELLED');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'",).count, 1);
  assert.equal(database.get(`
    SELECT amount, balance_after, reference_id
    FROM balance_ledger
    WHERE type = 'REFUND'
  `).amount, 80);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM order_status_history
    WHERE order_id = ? AND from_status = 'ACTIVE' AND to_status = 'CANCELLED'
  `, created.body.orderId).count, 1);
});

test('repeated cancellation returns the stored result without a duplicate refund', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const created = await create(database, 'cancel-retry-create');
  const first = await cancel(database, created.body.orderId, 'cancel-retry');
  const retry = await cancel(database, created.body.orderId, 'cancel-retry');
  assert.equal(first.response.status, 200);
  assert.equal(retry.response.status, 200);
  assert.deepEqual(retry.body, first.body);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'",).count, 1);

  const differentKey = await cancel(database, created.body.orderId, 'cancel-different-key');
  assert.equal(differentKey.response.status, 409);
  assert.equal(differentKey.body.error, 'ORDER_ALREADY_CANCELLED');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'",).count, 1);
});

test('cancellation is actor-bound and View As cannot redirect it', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const created = await create(database, 'cancel-owner');
  const foreign = await cancel(
    database,
    created.body.orderId,
    'cancel-foreign',
    userProfile('user-2', 'token-user-2')
  );
  assert.equal(foreign.response.status, 403);
  assert.equal(foreign.body.error, 'ORDER_FORBIDDEN');
  assert.equal(database.get("SELECT status FROM orders WHERE order_id = ?", created.body.orderId).status, 'ACTIVE');

  const viewAs = await callOrderRoute(
    database,
    `/api/orders/${encodeURIComponent(created.body.orderId)}/cancel?viewAs=user-1`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': 'cancel-view-as' }
    },
    userProfile('admin-1', 'token-admin')
  );
  assert.equal(viewAs.response.status, 403);
  assert.equal(viewAs.body.error, 'VIEW_AS_FORBIDDEN');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'",).count, 0);
});

test('cancellation after the server deadline leaves order and balance unchanged', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const created = await create(database, 'cancel-deadline-create');
  const closed = await cancel(
    database,
    created.body.orderId,
    'cancel-after-deadline',
    userProfile(),
    new Date('2026-09-08T02:00:00.001Z')
  );
  assert.equal(closed.response.status, 400);
  assert.equal(closed.body.error, 'DEADLINE_CLOSED');
  assert.equal(database.get("SELECT status FROM orders WHERE order_id = ?", created.body.orderId).status, 'ACTIVE');
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 20);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'",).count, 0);
});
