import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendAuditEvent } from '../src/db/audit.js';
import { appendLedgerEntry } from '../src/db/ledgerQueries.js';
import { seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = '2026-09-07T09:00:00.000Z';

const seedOrder = (database, orderId = 'order-ledger') => {
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
  `, orderId, 'user-1', 'User One', '2026-09-08', 'Vendor A', '1樓', 30, 'user-1');
};

test('ledger appends integer order/refund rows and conserves the user snapshot', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 100 });
  seedOrder(database);

  const order = await appendLedgerEntry(database, {
    transactionId: 'txn-order',
    userId: 'user-1',
    amount: -30,
    balanceAfter: 70,
    type: 'ORDER',
    referenceId: 'order-ledger',
    operatorUserId: 'user-1',
    note: 'order',
    occurredAt: NOW
  });
  const refund = await appendLedgerEntry(database, {
    transactionId: 'txn-refund',
    userId: 'user-1',
    amount: 30,
    balanceAfter: 100,
    type: 'REFUND',
    referenceId: 'order-ledger',
    operatorUserId: 'user-1',
    note: 'refund',
    occurredAt: '2026-09-07T10:00:00.000Z'
  });

  assert.equal(order.balance_after, 70);
  assert.equal(refund.balance_after, 100);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-1'").balance, 100);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 2);
});

test('top-up ledger rows require an audited admin operation', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 10 });
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });

  await assert.rejects(
    appendLedgerEntry(database, {
      transactionId: 'txn-unattributed-topup',
      userId: 'user-1',
      amount: 20,
      balanceAfter: 30,
      type: 'TOPUP',
      referenceId: 'missing-audit',
      operatorUserId: 'admin-1',
      occurredAt: NOW
    }),
    (error) => error.code === 'LEDGER_AUDIT_REFERENCE_INVALID'
  );

  await appendAuditEvent(database, {
    auditId: 'audit-topup',
    actorUserId: 'admin-1',
    targetUserId: 'user-1',
    action: 'BALANCE_TOP_UP',
    metadata: { amount: 20 },
    occurredAt: NOW
  });
  const row = await appendLedgerEntry(database, {
    transactionId: 'txn-topup',
    userId: 'user-1',
    amount: 20,
    balanceAfter: 30,
    type: 'TOPUP',
    referenceId: 'audit-topup',
    operatorUserId: 'admin-1',
    occurredAt: NOW
  });

  assert.equal(row.type, 'TOPUP');
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-1'").balance, 30);
});

test('ledger rejects fractional amounts, orphan order references, and balance mismatches', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 100 });

  await assert.rejects(
    appendLedgerEntry(database, {
      transactionId: 'txn-fractional',
      userId: 'user-1',
      amount: 1.5,
      balanceAfter: 101.5,
      type: 'REFUND',
      referenceId: 'missing-order',
      occurredAt: NOW
    }),
    (error) => error.code === 'LEDGER_AMOUNT_INTEGER_REQUIRED'
  );
  await assert.rejects(
    appendLedgerEntry(database, {
      transactionId: 'txn-orphan',
      userId: 'user-1',
      amount: -10,
      balanceAfter: 90,
      type: 'ORDER',
      referenceId: 'missing-order',
      occurredAt: NOW
    }),
    (error) => error.code === 'LEDGER_ORDER_REFERENCE_INVALID'
  );
  seedOrder(database, 'order-mismatch');
  await assert.rejects(
    appendLedgerEntry(database, {
      transactionId: 'txn-mismatch',
    userId: 'user-1',
      amount: -10,
      balanceAfter: 91,
      type: 'ORDER',
      referenceId: 'order-mismatch',
      occurredAt: NOW
    }),
    (error) => error.code === 'LEDGER_INVARIANT_VIOLATION'
  );
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-1'").balance, 100);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
});

test('adjustment ledger rows remain behind the explicit opening-balance policy gate', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 0 });
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  await assert.rejects(
    appendLedgerEntry(database, {
      transactionId: 'txn-adjustment',
      userId: 'user-1',
      amount: 100,
      balanceAfter: 100,
      type: 'ADJUSTMENT',
      referenceId: 'missing-policy-audit',
      operatorUserId: 'admin-1',
      occurredAt: NOW
    }),
    (error) => error.code === 'OPENING_BALANCE_POLICY_REQUIRED'
  );
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
});
