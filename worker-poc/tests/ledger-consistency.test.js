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
    occurredAt: '2026-08-31T23:59:00.000Z'
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
