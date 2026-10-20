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
    actorUserId: 'admin-1',
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
        WHERE user_id = ? AND ${guard.sql}
      `, [amount, occurredAt, 'user-1', ...guard.params]),
      prepareStatement(database, `
        INSERT INTO balance_ledger (
          transaction_id, user_id, amount, balance_after, type,
          reference_id, operator_user_id, note, occurred_at
        )
        SELECT ?, user_id, ?, balance, 'TOPUP', ?, 'admin-1', 'TEST_TOPUP', ?
        FROM users
        WHERE user_id = ? AND ${guard.sql}
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

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const waitWithTimeout = (promise, label) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), 5000);
  promise.then(
    (value) => {
      clearTimeout(timeout);
      resolve(value);
    },
    (error) => {
      clearTimeout(timeout);
      reject(error);
    }
  );
});

const capture = (promise) => promise.then(
  (value) => ({ value }),
  (error) => ({ error })
);

const unwrap = (outcome, label) => {
  assert.equal(outcome?.error, undefined, `${label} unexpectedly rejected`);
  return outcome.value;
};

const holdMutationBatches = (database) => {
  const originalBatch = database.batch.bind(database);
  const arrivals = [deferred(), deferred()];
  const releases = [];
  let batchCount = 0;

  database.batch = async (statements) => {
    const index = batchCount;
    batchCount += 1;
    assert.ok(index < arrivals.length, 'only the replacement and cancellation batches are expected');
    const release = deferred();
    releases[index] = release;
    arrivals[index].resolve();
    await release.promise;
    return originalBatch(statements);
  };

  return {
    waitFor: (index) => waitWithTimeout(arrivals[index].promise, `mutation batch ${index + 1}`),
    release: (index) => {
      assert.ok(releases[index], `mutation batch ${index + 1} has not arrived`);
      releases[index].resolve();
    },
    releaseAll: () => releases.forEach((release) => release?.resolve())
  };
};

const runReplacementCancellationRace = async (winner) => {
  const initialBalance = 100;
  const database = seedOrderDatabase({ balance: initialBalance });
  const originalOrder = await create(database, 'race-replace-cancel-create', 'menu-a');
  const originalOrderId = originalOrder.body.orderId;
  const gate = holdMutationBatches(database);
  const replacementOutcome = capture(create(database, 'race-replace-cancel-replace', 'menu-b'));
  let cancellationOutcome;

  try {
    // The replacement has already read the active order and built its guarded
    // mutation, but its D1 batch is held before it can commit.
    await gate.waitFor(0);
    cancellationOutcome = capture(cancel(database, originalOrderId, 'race-replace-cancel-cancel'));
    // Reaching the second batch proves both requests prepared against the same
    // still-active order. Releasing either batch now chooses the commit winner.
    await gate.waitFor(1);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE status = 'ACTIVE'").count, 1);

    const winnerIndex = winner === 'replacement' ? 0 : 1;
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    gate.release(winnerIndex);
    const winnerOutcome = winner === 'replacement'
      ? await replacementOutcome
      : await cancellationOutcome;
    unwrap(winnerOutcome, `${winner} request`);

    gate.release(loserIndex);
    const loserOutcome = winner === 'replacement'
      ? await cancellationOutcome
      : await replacementOutcome;
    unwrap(loserOutcome, `${winner === 'replacement' ? 'cancellation' : 'replacement'} request`);
  } finally {
    gate.releaseAll();
  }

  const replacement = unwrap(await replacementOutcome, 'replacement request');
  const cancellation = unwrap(await cancellationOutcome, 'cancellation request');
  assert.equal(replacement.response.status, winner === 'replacement' ? 200 : 409);
  assert.equal(cancellation.response.status, winner === 'cancellation' ? 200 : 409);
  if (winner === 'replacement') {
    assert.equal(cancellation.body.error, 'IDEMPOTENCY_FAILED');
  } else {
    assert.equal(replacement.body.error, 'IDEMPOTENCY_FAILED');
  }

  const replacementAmount = database.get(
    'SELECT price FROM menu_items WHERE menu_item_id = ?',
    'menu-b'
  ).price;
  return { database, initialBalance, originalOrderId, replacementAmount, replacement, cancellation };
};

const assertOrderRaceLedger = (database, {
  initialBalance,
  expectedBalance,
  expectedOrderStates,
  refundedOrderId,
  refundNote,
  expectedOrderCount
}) => {
  const orders = database.database.prepare(`
    SELECT order_id, total_amount, status
    FROM orders
    WHERE user_id = 'user-1' AND order_date = ?
    ORDER BY order_id
  `).all(ORDER_DATE);
  assert.equal(orders.length, expectedOrderCount);
  assert.deepEqual(
    orders.map((order) => [order.order_id, order.status]),
    [...expectedOrderStates]
      .map(({ orderId, status }) => [orderId, status])
      .sort(([left], [right]) => left.localeCompare(right))
  );

  const ledger = database.database.prepare(`
    SELECT bl.type, bl.amount, bl.balance_after, bl.reference_id, bl.note,
           bls.sequence_number
    FROM balance_ledger bl
    JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
    WHERE bl.user_id = 'user-1'
    ORDER BY bls.sequence_number
  `).all();
  const orderEntries = ledger.filter((entry) => entry.type === 'ORDER');
  const refunds = ledger.filter((entry) => entry.type === 'REFUND');
  assert.equal(orderEntries.length, expectedOrderCount);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].reference_id, refundedOrderId);
  assert.equal(refunds[0].note, refundNote);

  for (const order of orders) {
    const entries = orderEntries.filter((entry) => entry.reference_id === order.order_id);
    assert.equal(entries.length, 1, `order ${order.order_id} has one matching ORDER ledger entry`);
    assert.equal(entries[0].amount, -order.total_amount);
  }
  const refundedOrder = orders.find((order) => order.order_id === refunds[0].reference_id);
  assert.ok(refundedOrder, 'refund references an existing order');
  assert.equal(refundedOrder.status, 'CANCELLED');
  assert.equal(refunds[0].amount, refundedOrder.total_amount);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM balance_ledger bl
    LEFT JOIN orders o ON o.order_id = bl.reference_id
    WHERE bl.user_id = 'user-1' AND bl.type IN ('ORDER', 'REFUND')
      AND (o.order_id IS NULL OR o.user_id <> bl.user_id)
  `).count, 0, 'every order and refund ledger reference resolves to this user\'s order');

  let ledgerBalance = initialBalance;
  for (const entry of ledger) {
    ledgerBalance += entry.amount;
    assert.equal(entry.balance_after, ledgerBalance, `ledger sequence ${entry.sequence_number} balance`);
  }
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-1'").balance, expectedBalance);
  assert.equal(ledgerBalance, expectedBalance);
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
    WHERE user_id = 'user-1' AND order_date = ? AND status = 'ACTIVE'
  `, ORDER_DATE);
  const user = database.get("SELECT balance FROM users WHERE user_id = 'user-1'");
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
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-1'").balance, 100);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM order_status_history
    WHERE order_id = ? AND from_status = 'ACTIVE' AND to_status = 'CANCELLED'
  `, created.body.orderId).count, 1);
});

test('replacement commits first when both operations observed the same active order', async () => {
  const race = await runReplacementCancellationRace('replacement');
  const { database, initialBalance, originalOrderId, replacementAmount, replacement, cancellation } = race;
  const replacementOrderId = replacement.body.orderId;
  assert.notEqual(replacementOrderId, originalOrderId);
  assert.equal(database.get("SELECT status FROM orders WHERE order_id = ?", originalOrderId).status, 'CANCELLED');
  assert.equal(database.get("SELECT status FROM orders WHERE order_id = ?", replacementOrderId).status, 'ACTIVE');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE status = 'ACTIVE'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'ORDER'").count, 2);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'").count, 1);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM order_status_history
    WHERE order_id = ? AND from_status = 'ACTIVE' AND to_status = 'CANCELLED'
      AND reason = 'ORDER_REPLACED'
  `, originalOrderId).count, 1);
  assert.equal(cancellation.response.status, 409);
  assertOrderRaceLedger(database, {
    initialBalance,
    expectedBalance: initialBalance - replacementAmount,
    expectedOrderStates: [
      { orderId: originalOrderId, status: 'CANCELLED' },
      { orderId: replacementOrderId, status: 'ACTIVE' }
    ],
    refundedOrderId: originalOrderId,
    refundNote: 'ORDER_REPLACED',
    expectedOrderCount: 2
  });
});

test('cancellation commits first when both operations observed the same active order', async () => {
  const race = await runReplacementCancellationRace('cancellation');
  const { database, initialBalance, originalOrderId, replacement, cancellation } = race;
  assert.equal(cancellation.body.orderId, originalOrderId);
  assert.equal(database.get("SELECT status FROM orders WHERE order_id = ?", originalOrderId).status, 'CANCELLED');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE status = 'ACTIVE'").count, 0);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'ORDER'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'").count, 1);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM order_status_history
    WHERE order_id = ? AND from_status = 'ACTIVE' AND to_status = 'CANCELLED'
      AND reason = 'ORDER_CANCELLED'
  `, originalOrderId).count, 1);
  assert.equal(replacement.response.status, 409);
  assertOrderRaceLedger(database, {
    initialBalance,
    expectedBalance: initialBalance,
    expectedOrderStates: [{ orderId: originalOrderId, status: 'CANCELLED' }],
    refundedOrderId: originalOrderId,
    refundNote: 'ORDER_CANCELLED',
    expectedOrderCount: 1
  });
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
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-1'").balance, 20);
});

test('competing top-up-shaped balance mutations preserve every ledger delta', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const results = await Promise.all([
    syntheticTopUp(database, 'race-topup-a', 10),
    syntheticTopUp(database, 'race-topup-b', 20)
  ]);
  assert.deepEqual(results.map((result) => result.success), [true, true]);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-1'").balance, 130);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'TOPUP'",).count, 2);
  assert.equal(database.get(`
    SELECT SUM(amount) AS amount
    FROM balance_ledger
    WHERE user_id = 'user-1'
  `).amount, 30);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM balance_ledger
    WHERE type = 'TOPUP' AND reference_id IN ('topup-race-topup-a', 'topup-race-topup-b')
  `).count, 2);
});
