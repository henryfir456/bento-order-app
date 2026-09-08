import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appendAuditEvent } from '../src/db/audit.js';
import { appendLedgerEntry } from '../src/db/ledgerQueries.js';
import { getBalanceHistory } from '../src/domain/ledger.js';
import { seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const seedOrder = (database) => database.run(`
  INSERT INTO orders (
    order_id, line_user_id, order_date, vendor, pickup_floor, total_amount, status
  ) VALUES ('history-order', 'user-1', '2026-09-08', 'Vendor A', '1樓', 30, 'ACTIVE')
`);

test('balance history filters by UTC month and preserves business-date context', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 100 });
  seedOrder(database);
  await appendLedgerEntry(database, {
    transactionId: 'history-order-tx',
    lineUserId: 'user-1',
    amount: -30,
    balanceAfter: 70,
    type: 'ORDER',
    referenceId: 'history-order',
    occurredAt: '2026-09-01T00:00:00.000Z'
  });
  await appendAuditEvent(database, {
    auditId: 'history-audit',
    actorLineUserId: 'user-1',
    targetLineUserId: 'user-1',
    action: 'BALANCE_TOP_UP',
    metadata: { amount: 10 },
    occurredAt: '2026-09-10T00:00:00.000Z'
  });
  await appendLedgerEntry(database, {
    transactionId: 'history-topup-tx',
    lineUserId: 'user-1',
    amount: 10,
    balanceAfter: 80,
    type: 'TOPUP',
    referenceId: 'history-audit',
    operatorLineUserId: 'user-1',
    occurredAt: '2026-09-10T00:00:00.000Z'
  });
  await appendAuditEvent(database, {
    auditId: 'history-audit-october',
    actorLineUserId: 'user-1',
    targetLineUserId: 'user-1',
    action: 'BALANCE_TOP_UP',
    metadata: { amount: 5 },
    occurredAt: '2026-10-01T00:00:00.000Z'
  });
  await appendLedgerEntry(database, {
    transactionId: 'history-october-tx',
    lineUserId: 'user-1',
    amount: 5,
    balanceAfter: 85,
    type: 'TOPUP',
    referenceId: 'history-audit-october',
    operatorLineUserId: 'user-1',
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

test('history returns an explicit policy boundary for an imported balance without ledger evidence', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 100 });
  await assert.rejects(
    getBalanceHistory(database, 'user-1', '2026-09'),
    (error) => error.code === 'OPENING_BALANCE_POLICY_REQUIRED'
  );
});
