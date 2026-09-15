import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendAuditEvent } from '../src/db/audit.js';
import { appendLedgerEntry } from '../src/db/ledgerQueries.js';
import { getBalanceHistory } from '../src/domain/ledger.js';
import { reconcileBalances } from '../scripts/reconcile-balances.mjs';
import { seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const seedOrder = (database) => database.run(`
  INSERT INTO orders (
    order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
    total_amount, status, created_by_user_id
  ) VALUES ('history-order', 'user-1', 'User One', '2026-09-08', 'Vendor A', '1樓', 30, 'ACTIVE', 'user-1')
`);

test('balance history filters by UTC month and preserves business-date context', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 100 });
  seedOrder(database);
  await appendLedgerEntry(database, {
    transactionId: 'history-order-tx',
    userId: 'user-1',
    amount: -30,
    balanceAfter: 70,
    type: 'ORDER',
    referenceId: 'history-order',
    occurredAt: '2026-09-01T00:00:00.000Z'
  });
  await appendAuditEvent(database, {
    auditId: 'history-audit',
    actorUserId: 'user-1',
    targetUserId: 'user-1',
    action: 'BALANCE_TOP_UP',
    metadata: { amount: 10 },
    occurredAt: '2026-09-10T00:00:00.000Z'
  });
  await appendLedgerEntry(database, {
    transactionId: 'history-topup-tx',
    userId: 'user-1',
    amount: 10,
    balanceAfter: 80,
    type: 'TOPUP',
    referenceId: 'history-audit',
    operatorUserId: 'user-1',
    occurredAt: '2026-09-10T00:00:00.000Z'
  });
  await appendAuditEvent(database, {
    auditId: 'history-audit-october',
    actorUserId: 'user-1',
    targetUserId: 'user-1',
    action: 'BALANCE_TOP_UP',
    metadata: { amount: 5 },
    occurredAt: '2026-10-01T00:00:00.000Z'
  });
  await appendLedgerEntry(database, {
    transactionId: 'history-october-tx',
    userId: 'user-1',
    amount: 5,
    balanceAfter: 85,
    type: 'TOPUP',
    referenceId: 'history-audit-october',
    operatorUserId: 'user-1',
    occurredAt: '2026-10-01T00:00:00.000Z'
  });

  const result = await getBalanceHistory(database, 'user-1', '2026-09');
  assert.equal(result.openingBalance, 100);
  assert.equal(result.totalCredit, 10);
  assert.equal(result.totalDebit, 30);
  assert.equal(result.closingBalance, 80);
  assert.deepEqual(result.transactions.map((row) => row.transactionId), [
    'history-topup-tx',
    'history-order-tx'
  ]);
  assert.equal(result.transactions[1].businessDate, '2026-09-08');
});

test('order ledger history projects Chinese labels and historical order item snapshots', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 100 });
  seedOrder(database);
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    ) VALUES
      ('history-order', 1, 'legacy-a', '小而美舊名', 1, 10, 10),
      ('history-order', 2, 'legacy-b', '紫米飯', 2, 10, 20)
  `);
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES ('current-menu', 'Vendor A', '2026-09-09')
  `);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, note, image_url, source_order
    ) VALUES ('current-menu-a', 'current-menu', 'legacy-a', '小而美新名', 10, 1, '', '', 1)
  `);
  await appendLedgerEntry(database, {
    transactionId: 'history-created-tx',
    userId: 'user-1',
    amount: -30,
    balanceAfter: 70,
    type: 'ORDER',
    referenceId: 'history-order',
    note: 'ORDER_CREATED',
    occurredAt: '2026-09-08T01:00:00.000Z'
  });
  await appendLedgerEntry(database, {
    transactionId: 'history-cancelled-tx',
    userId: 'user-1',
    amount: 30,
    balanceAfter: 100,
    type: 'REFUND',
    referenceId: 'history-order',
    note: 'ORDER_CANCELLED',
    occurredAt: '2026-09-08T02:00:00.000Z'
  });

  const result = await getBalanceHistory(database, 'user-1', '2026-09');
  assert.deepEqual(result.transactions.map((row) => row.description), ['取消點餐', '點餐']);
  assert.deepEqual(result.transactions[0].order, {
    orderDate: '2026-09-08',
    vendorName: 'Vendor A',
    items: [
      { name: '小而美舊名', quantity: 1 },
      { name: '紫米飯', quantity: 2 }
    ]
  });
  assert.deepEqual(result.transactions[1].order, result.transactions[0].order);
  assert.equal(result.transactions[0].order.items[0].name, '小而美舊名');
});

test('history returns an explicit policy boundary for an imported balance without ledger evidence', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 100 });
  await assert.rejects(
    getBalanceHistory(database, 'user-1', '2026-09'),
    (error) => error.code === 'OPENING_BALANCE_POLICY_REQUIRED'
  );
});

test('history follows committed ledger sequence across reversed timestamps and month boundaries', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 100 });
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  database.run(`
  INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
  `, 'before-month-order', 'user-1', 'User One', '2026-08-31', 'Vendor A', '1樓', 5, 'user-1');
  database.run(`
  INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
  `, 'reversed-month-order', 'user-1', 'User One', '2026-09-01', 'Vendor A', '1樓', 10, 'user-1');

  await appendLedgerEntry(database, {
    transactionId: 'txn-before-month',
    userId: 'user-1',
    amount: -5,
    balanceAfter: 95,
    type: 'ORDER',
    referenceId: 'before-month-order',
    occurredAt: '2026-08-31T23:59:00.000Z'
  });
  await appendAuditEvent(database, {
    auditId: 'audit-reversed-late',
    actorUserId: 'admin-1',
    targetUserId: 'user-1',
    action: 'BALANCE_TOP_UP',
    metadata: { amount: 20 },
    occurredAt: '2026-09-30T00:00:00.000Z'
  });
  await appendLedgerEntry(database, {
    transactionId: 'txn-reversed-late',
    userId: 'user-1',
    amount: 20,
    balanceAfter: 115,
    type: 'TOPUP',
    referenceId: 'audit-reversed-late',
    operatorUserId: 'admin-1',
    occurredAt: '2026-09-30T00:00:00.000Z'
  });
  await appendLedgerEntry(database, {
    transactionId: 'txn-reversed-early',
    userId: 'user-1',
    amount: -10,
    balanceAfter: 105,
    type: 'ORDER',
    referenceId: 'reversed-month-order',
    occurredAt: '2026-09-01T00:00:00.000Z'
  });

  const result = await getBalanceHistory(database, 'user-1', '2026-09');
  assert.equal(result.openingBalance, 95);
  assert.equal(result.totalCredit, 20);
  assert.equal(result.totalDebit, 10);
  assert.equal(result.closingBalance, 105);
  assert.deepEqual(result.transactions.map((row) => row.transactionId), [
    'txn-reversed-early',
    'txn-reversed-late'
  ]);

  const reconciliation = await reconcileBalances(database);
  const user = reconciliation.users.find((row) => row.lineUserId === 'user-1');
  assert.equal(user.status, 'CONSISTENT');
  assert.equal(user.difference, 0);
});
