import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertOpeningBalancePolicy,
  isApprovedOpeningBalancePolicy
} from '../src/domain/ledger.js';
import { appendLedgerEntry } from '../src/db/ledgerQueries.js';
import { topUpBalance } from '../src/routes/balance.js';
import { reconcileBalances } from '../scripts/reconcile-balances.mjs';
import { getBalanceHistory } from '../src/domain/ledger.js';
import { seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const markImportedSnapshot = (database, {
  lineUserId,
  balance,
  batchId
}) => {
  seedUser(database, { lineUserId, balance });
  database.run(`
    INSERT INTO import_batches (batch_id, source_hash, importer_version, status)
    VALUES (?, ?, ?, 'QUARANTINED')
  `, batchId, 'snapshot-source-' + batchId, 'test-version');
  database.run(`
    INSERT INTO opening_balance_snapshots (
      line_user_id, snapshot_balance, source_batch_id, policy_status, created_at
    ) VALUES (?, ?, ?, 'REQUIRED', ?)
  `, lineUserId, balance, batchId, '2026-09-08T00:00:00.000Z');
};

const seedOrder = (database, orderId, totalAmount) => database.run(`
  INSERT INTO orders (
    order_id, line_user_id, order_date, vendor, pickup_floor, total_amount, status
  ) VALUES (?, 'user-1', '2026-09-08', 'Vendor A', '1樓', ?, 'ACTIVE')
`, orderId, totalAmount);

test('opening balance promotion fails closed without reviewed policy metadata', () => {
  assert.equal(isApprovedOpeningBalancePolicy(undefined), false);
  assert.equal(isApprovedOpeningBalancePolicy({ approved: true }), false);
  assert.throws(
    () => assertOpeningBalancePolicy({ approved: true }),
    (error) => error.code === 'OPENING_BALANCE_POLICY_REQUIRED'
  );
});

test('opening balance promotion requires explicit reviewer, policy, date, and reference', () => {
  const policy = {
    approved: true,
    policyId: 'opening-balance-v1',
    approvedBy: 'admin-1',
    approvedAt: '2026-09-08T00:00:00.000Z',
    reference: 'POLICY-REVIEW-001'
  };
  assert.equal(isApprovedOpeningBalancePolicy(policy), true);
  assert.deepEqual(assertOpeningBalancePolicy(policy), policy);
});

test('negative imported snapshot remains policy-bound after a top-up to zero', async () => {
  const database = new SqliteD1();
  markImportedSnapshot(database, {
    lineUserId: 'user-1',
    balance: -50,
    batchId: 'snapshot-negative'
  });
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  const actor = { lineUserId: 'admin-1', role: 'Admin', registered: true };
  await topUpBalance(
    database,
    { actor, authorizationActor: actor, effectiveSubject: actor },
    { targetUserId: 'user-1', amount: 50, idempotencyKey: 'snapshot-negative-topup' },
    new Date('2026-09-08T00:00:00.000Z')
  );

  await assert.rejects(
    () => getBalanceHistory(database, 'user-1', '2026-09'),
    (error) => error.code === 'OPENING_BALANCE_POLICY_REQUIRED'
  );
  const reconciliation = await reconcileBalances(database);
  const user = reconciliation.users.find((row) => row.lineUserId === 'user-1');
  assert.equal(user.status, 'OPENING_BALANCE_POLICY_REQUIRED');
  assert.equal(user.openingBalancePolicyStatus, 'REQUIRED');
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 0);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'ADJUSTMENT'").count, 0);
});

test('positive imported snapshot remains policy-bound after a later deduction', async () => {
  const database = new SqliteD1();
  markImportedSnapshot(database, {
    lineUserId: 'user-1',
    balance: 100,
    batchId: 'snapshot-deduction'
  });
  seedOrder(database, 'snapshot-deduction-order', 30);
  await appendLedgerEntry(database, {
    transactionId: 'snapshot-deduction-tx',
    lineUserId: 'user-1',
    amount: -30,
    balanceAfter: 70,
    type: 'ORDER',
    referenceId: 'snapshot-deduction-order',
    occurredAt: '2026-09-08T00:00:00.000Z'
  });

  await assert.rejects(
    () => getBalanceHistory(database, 'user-1', '2026-09'),
    (error) => error.code === 'OPENING_BALANCE_POLICY_REQUIRED'
  );
  const user = (await reconcileBalances(database)).users.find((row) => row.lineUserId === 'user-1');
  assert.equal(user.status, 'OPENING_BALANCE_POLICY_REQUIRED');
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 70);
});

test('imported snapshot remains policy-bound through deduction and refund', async () => {
  const database = new SqliteD1();
  markImportedSnapshot(database, {
    lineUserId: 'user-1',
    balance: 30,
    batchId: 'snapshot-refund'
  });
  seedOrder(database, 'snapshot-refund-order', 30);
  await appendLedgerEntry(database, {
    transactionId: 'snapshot-refund-order-tx',
    lineUserId: 'user-1',
    amount: -30,
    balanceAfter: 0,
    type: 'ORDER',
    referenceId: 'snapshot-refund-order',
    occurredAt: '2026-09-08T00:00:00.000Z'
  });
  await appendLedgerEntry(database, {
    transactionId: 'snapshot-refund-refund-tx',
    lineUserId: 'user-1',
    amount: 30,
    balanceAfter: 30,
    type: 'REFUND',
    referenceId: 'snapshot-refund-order',
    occurredAt: '2026-09-08T00:00:01.000Z'
  });

  await assert.rejects(
    () => getBalanceHistory(database, 'user-1', '2026-09'),
    (error) => error.code === 'OPENING_BALANCE_POLICY_REQUIRED'
  );
  const user = (await reconcileBalances(database)).users.find((row) => row.lineUserId === 'user-1');
  assert.equal(user.status, 'OPENING_BALANCE_POLICY_REQUIRED');
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 30);
});
