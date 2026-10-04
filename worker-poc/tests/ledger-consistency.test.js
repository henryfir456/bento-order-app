import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendAuditEvent } from '../src/db/audit.js';
import { appendLedgerEntry, getLedgerRows } from '../src/db/ledgerQueries.js';
import { getBalanceHistory } from '../src/domain/ledger.js';
import { analyzeLedgerRows } from '../src/domain/ledgerConsistency.js';
import { seedLedgerRow, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const adjustmentPolicy = (policyId) => ({
  approved: true,
  policyId,
  approvedBy: 'admin-1',
  approvedAt: '2026-09-15T07:47:03.247Z',
  reference: `audit-${policyId}`
});

const seedOrder = (database, { orderId, userId, amount }) => {
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)
  `, orderId, userId, userId, '2026-09-15', 'Vendor A', '1樓', amount, userId);
};

test('legacy cutoff adjustment is part of the canonical chain before the next order', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: '070214-user',
    employeeId: '070214',
    displayName: 'Employee 070214',
    balance: 0
  });
  seedUser(database, { userId: 'admin-1', lineUserId: 'admin-1', role: 'Admin' });
  await appendAuditEvent(database, {
    auditId: 'audit-BAL-AI-20260915-01',
    actorUserId: 'admin-1',
    targetUserId: '070214-user',
    action: 'BALANCE_ADJUSTMENT',
    metadata: {
      policy_id: 'BAL-AI-20260915-01',
      reason: 'restore_missing_legacy_cutoff_balance',
      cutoff_date: '2026-09-10'
    },
    occurredAt: '2026-09-15T07:47:03.247Z'
  });
  await appendLedgerEntry(database, {
    transactionId: 'restore-070214',
    userId: '070214-user',
    amount: 800,
    balanceAfter: 800,
    type: 'ADJUSTMENT',
    referenceId: 'audit-BAL-AI-20260915-01',
    operatorUserId: 'admin-1',
    note: 'restore_missing_legacy_cutoff_balance policy_id=BAL-AI-20260915-01 cutoff_date=2026-09-10',
    occurredAt: '2026-09-15T07:47:03.247Z',
    policy: adjustmentPolicy('BAL-AI-20260915-01')
  });
  seedOrder(database, { orderId: '070214-order', userId: '070214-user', amount: 100 });
  await appendLedgerEntry(database, {
    transactionId: 'order-after-restore-070214',
    userId: '070214-user',
    amount: -100,
    balanceAfter: 700,
    type: 'ORDER',
    referenceId: '070214-order',
    occurredAt: '2026-09-15T08:00:00.000Z'
  });

  const result = await getBalanceHistory(database, '070214-user', '2026-09');
  assert.equal(result.openingBalance, 0);
  assert.equal(result.totalCredit, 800);
  assert.equal(result.totalDebit, 100);
  assert.equal(result.closingBalance, 700);
  assert.equal(result.reconciliation.status, 'CONSISTENT');
  assert.equal(result.reconciliation.adjustmentRows.length, 1);
});

test('070214 reproduction reports one origin and a propagated broken chain', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: '070214-user',
    employeeId: '070214',
    displayName: 'Employee 070214',
    balance: 0
  });
  seedLedgerRow(database, {
    transactionId: '070214-cutoff',
    userId: '070214-user',
    amount: 800,
    balanceAfter: 800,
    occurredAt: '2026-09-10T00:00:00.000Z'
  });
  seedLedgerRow(database, {
    transactionId: '070214-origin',
    userId: '070214-user',
    amount: -100,
    balanceAfter: -100,
    type: 'ORDER',
    referenceId: '070214-origin-order',
    occurredAt: '2026-09-15T05:51:45.480Z'
  });
  seedLedgerRow(database, {
    transactionId: '070214-propagated-adjustment',
    userId: '070214-user',
    amount: 800,
    balanceAfter: 700,
    type: 'ADJUSTMENT',
    note: 'restore_missing_legacy_cutoff_balance policy_id=BAL-AI-20260915-01',
    occurredAt: '2026-09-15T07:47:03.247Z'
  });

  const rows = await getLedgerRows(database, '070214-user');
  const report = analyzeLedgerRows(rows);
  assert.equal(report.sequenceDiscontinuities.length, 1);
  assert.equal(report.sequenceDiscontinuities[0].type, 'ORDER');
  assert.equal(report.sequenceDiscontinuities[0].delta, -800);
  assert.equal(report.propagatedRows.length, 1);
  assert.equal(report.propagatedRows[0].type, 'ADJUSTMENT');
  assert.equal(report.propagatedRows[0].chainOffset, -800);

  const summary = await getBalanceHistory(database, '070214-user', '2026-09');
  assert.equal(summary.closingBalance, 700);
  assert.equal(summary.reconciliation.status, 'LEDGER_CHAIN_DISCONTINUITY');
  assert.equal(summary.reconciliation.sequenceDiscontinuities.length, 1);
  assert.equal(summary.reconciliation.propagatedRows.length, 1);
});

test('121254 reproduction identifies the origin separately from propagated rows', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: '121254-user',
    employeeId: '121254',
    displayName: 'Employee 121254',
    balance: 0
  });
  seedLedgerRow(database, {
    transactionId: '121254-cutoff',
    userId: '121254-user',
    amount: 800,
    balanceAfter: 800,
    occurredAt: '2026-09-10T00:00:00.000Z'
  });
  seedLedgerRow(database, {
    transactionId: '121254-origin',
    userId: '121254-user',
    amount: -120,
    balanceAfter: -120,
    type: 'ORDER',
    referenceId: '121254-origin-order',
    occurredAt: '2026-09-14T17:23:16.908Z'
  });
  seedLedgerRow(database, {
    transactionId: '121254-propagated-refund',
    userId: '121254-user',
    amount: 120,
    balanceAfter: 0,
    type: 'REFUND',
    referenceId: '121254-origin-order',
    occurredAt: '2026-09-14T17:23:27.899Z'
  });

  const report = analyzeLedgerRows(await getLedgerRows(database, '121254-user'));
  assert.equal(report.sequenceDiscontinuities.length, 1);
  assert.equal(report.sequenceDiscontinuities[0].sequenceNumber, 2);
  assert.equal(report.propagatedRows.length, 1);
  assert.equal(report.propagatedRows[0].sequenceNumber, 3);
  assert.equal(report.propagatedRows[0].chainOffset, -800);

  const summary = await getBalanceHistory(database, '121254-user', '2026-09');
  assert.equal(summary.reconciliation.status, 'LEDGER_CHAIN_DISCONTINUITY');
  assert.equal(summary.reconciliation.sequenceDiscontinuities[0].sequenceNumber, 2);
});

test('monthly summary exposes out-of-period rows interleaved by sequence', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'boundary-user',
    employeeId: '147398',
    displayName: 'Employee 147398',
    balance: 0
  });
  seedLedgerRow(database, {
    transactionId: 'boundary-opening',
    userId: 'boundary-user',
    amount: 100,
    balanceAfter: 100,
    occurredAt: '2026-08-31T00:00:00.000Z'
  });
  seedLedgerRow(database, {
    transactionId: 'boundary-september-first',
    userId: 'boundary-user',
    amount: -10,
    balanceAfter: 90,
    type: 'ORDER',
    occurredAt: '2026-09-01T00:00:00.000Z'
  });
  seedLedgerRow(database, {
    transactionId: 'boundary-late-august',
    userId: 'boundary-user',
    amount: -5,
    balanceAfter: 85,
    type: 'ORDER',
    occurredAt: '2026-08-31T15:59:00.000Z'
  });
  seedLedgerRow(database, {
    transactionId: 'boundary-september-last',
    userId: 'boundary-user',
    amount: -5,
    balanceAfter: 80,
    type: 'ORDER',
    occurredAt: '2026-09-02T00:00:00.000Z'
  });

  const result = await getBalanceHistory(database, 'boundary-user', '2026-09');
  assert.equal(result.closingBalance, 80);
  assert.equal(result.reconciliation.status, 'SEQUENCE_DATE_BOUNDARY_MISMATCH');
  assert.equal(result.reconciliation.monthlyDelta, 10);
  assert.deepEqual(
    result.reconciliation.outOfPeriodSequenceRows.map((row) => row.transactionId),
    ['boundary-late-august']
  );
});

test('balance history assigns transaction timestamps to Asia/Taipei months', async () => {
  const database = new SqliteD1();
  const userId = 'taipei-month-user';
  seedUser(database, { userId, employeeId: 'month-test', displayName: 'Month Test', balance: 27 });
  const rows = [
    { transactionId: 'taipei-september-last', amount: 25, balanceAfter: 25, occurredAt: '2026-09-30T15:59:59.999Z' },
    { transactionId: 'taipei-october-first', amount: -10, balanceAfter: 15, occurredAt: '2026-09-30T16:00:00.000Z' },
    { transactionId: 'issue-23-timestamp', amount: -5, balanceAfter: 10, occurredAt: '2026-09-30T17:35:45.510Z' },
    { transactionId: 'taipei-october-last', amount: 20, balanceAfter: 30, occurredAt: '2026-10-31T15:59:59.999Z' },
    { transactionId: 'taipei-november-first', amount: -3, balanceAfter: 27, occurredAt: '2026-10-31T16:00:00.000Z' }
  ];
  for (const row of rows) seedLedgerRow(database, { ...row, userId });

  const september = await getBalanceHistory(database, userId, '2026-09');
  const october = await getBalanceHistory(database, userId, '2026-10');
  const november = await getBalanceHistory(database, userId, '2026-11');
  const december = await getBalanceHistory(database, userId, '2026-12');

  const transactionIds = (history) => history.transactions.map((transaction) => transaction.transactionId);
  assert.deepEqual(transactionIds(september), ['taipei-september-last']);
  assert.deepEqual(transactionIds(october), [
    'taipei-october-last',
    'issue-23-timestamp',
    'taipei-october-first'
  ]);
  assert.equal(october.transactions[1].occurredAt, '2026-09-30T17:35:45.510Z');
  assert.equal(october.openingBalance, 25);
  assert.equal(october.totalCredit, 20);
  assert.equal(october.totalDebit, 15);
  assert.equal(october.closingBalance, 30);
  assert.equal(october.reconciliation.status, 'CONSISTENT');
  assert.deepEqual(transactionIds(november), ['taipei-november-first']);
  assert.deepEqual(transactionIds(december), []);
  assert.equal(december.openingBalance, 27);
  assert.equal(december.closingBalance, 27);
});

test('balance history handles Taipei year-end month rollover', async () => {
  const database = new SqliteD1();
  const userId = 'taipei-year-rollover-user';
  seedUser(database, { userId, employeeId: 'year-test', displayName: 'Year Test', balance: 7 });
  seedLedgerRow(database, {
    transactionId: 'taipei-december-last',
    userId,
    amount: 12,
    balanceAfter: 12,
    occurredAt: '2026-12-31T15:59:59.999Z'
  });
  seedLedgerRow(database, {
    transactionId: 'taipei-january-first',
    userId,
    amount: -5,
    balanceAfter: 7,
    occurredAt: '2026-12-31T16:00:00.000Z'
  });

  const december = await getBalanceHistory(database, userId, '2026-12');
  const january = await getBalanceHistory(database, userId, '2027-01');

  assert.deepEqual(december.transactions.map((transaction) => transaction.transactionId), ['taipei-december-last']);
  assert.equal(december.closingBalance, 12);
  assert.deepEqual(january.transactions.map((transaction) => transaction.transactionId), ['taipei-january-first']);
  assert.equal(january.openingBalance, 12);
  assert.equal(january.closingBalance, 7);
});

test('balance history handles Taipei leap-February boundaries and still requires a month', async () => {
  const database = new SqliteD1();
  const userId = 'taipei-leap-year-user';
  seedUser(database, { userId, employeeId: 'leap-test', displayName: 'Leap Test', balance: 5 });
  const rows = [
    { transactionId: 'taipei-january-last', amount: 5, balanceAfter: 5, occurredAt: '2024-01-31T15:59:59.999Z' },
    { transactionId: 'taipei-february-first', amount: -2, balanceAfter: 3, occurredAt: '2024-01-31T16:00:00.000Z' },
    { transactionId: 'taipei-february-last', amount: 3, balanceAfter: 6, occurredAt: '2024-02-29T15:59:59.999Z' },
    { transactionId: 'taipei-march-first', amount: -1, balanceAfter: 5, occurredAt: '2024-02-29T16:00:00.000Z' }
  ];
  for (const row of rows) seedLedgerRow(database, { ...row, userId });

  const february = await getBalanceHistory(database, userId, '2024-02');
  const march = await getBalanceHistory(database, userId, '2024-03');

  assert.deepEqual(
    february.transactions.map((transaction) => transaction.transactionId),
    ['taipei-february-last', 'taipei-february-first']
  );
  assert.equal(february.openingBalance, 5);
  assert.equal(february.totalCredit, 3);
  assert.equal(february.totalDebit, 2);
  assert.equal(february.closingBalance, 6);
  assert.deepEqual(march.transactions.map((transaction) => transaction.transactionId), ['taipei-march-first']);

  await assert.rejects(
    getBalanceHistory(database, userId, ''),
    (error) => error.code === 'INVALID_MONTH' && error.status === 400
  );
});
