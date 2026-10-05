import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCanonicalIdentityRepairPlan,
  bindCanonicalIdentityRepairPlan,
  buildCanonicalIdentityRepairPostconditionQuery
} from '../scripts/lib/canonical-identity-repair.mjs';
import { seedLedgerRow, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const expected = () => ({
  employeeId: 'employee-canonical',
  lineUserId: 'line-source',
  canonicalUserId: 'user-canonical',
  sourceUserId: 'user-legacy',
  sourceEmployeeId: 'employee-misbound',
  sourceDisplayName: 'Legacy employee fixture',
  sourceMirrorBalance: -200,
  displayName: 'Canonical Fixture',
  canonicalCurrentDisplayName: 'Canonical Old Fixture',
  canonicalBalance: 200,
  canonicalLatestBalance: 200,
  canonicalLedgerCount: 2,
  canonicalLatestSequence: 2,
  canonicalUpdatedAt: '2026-09-01T00:00:00.000Z',
  sourceUpdatedAt: '2026-10-07T03:00:00.000Z',
  sourceLatestSequence: 4,
  globalLatestSequence: 4,
  operatorUpdatedAt: '2026-09-01T00:00:00.000Z',
  operatorVerificationStatus: 'UNVERIFIED',
  preservedOrders: [
    { orderId: 'order-canonical-06', orderDate: '2026-10-06', debitTransactionId: 'canonical-debit-06', debitSequenceNumber: 1, debitBalanceAfter: 300 },
    { orderId: 'order-canonical-07', orderDate: '2026-10-07', debitTransactionId: 'canonical-debit-07', debitSequenceNumber: 2, debitBalanceAfter: 200 }
  ],
  operatorUserId: 'user-admin',
  operatorEmployeeId: 'employee-admin',
  operatorLineUserId: 'line-admin',
  operatorDisplayName: 'Admin Fixture',
  occurredAt: '2026-10-08T02:00:00.000Z',
  auditId: 'audit-identity-repair',
  guestSessionIds: ['guest-source-1', 'guest-provisional-source'],
  refunds: [
    {
      orderId: 'order-legacy-06',
      orderDate: '2026-10-06',
      debitTransactionId: 'order-debit-06',
      debitSequenceNumber: 3,
      debitBalanceAfter: -100,
      transactionId: 'refund-legacy-06',
      transitionId: 'transition-legacy-06'
    },
    {
      orderId: 'order-legacy-07',
      orderDate: '2026-10-07',
      debitTransactionId: 'order-debit-07',
      debitSequenceNumber: 4,
      debitBalanceAfter: -200,
      transactionId: 'refund-legacy-07',
      transitionId: 'transition-legacy-07'
    }
  ]
});

const fixture = () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'user-canonical', employeeId: 'employee-canonical', lineUserId: null,
    displayName: 'Canonical Old Fixture', balance: 200
  });
  seedUser(database, {
    userId: 'user-legacy', employeeId: 'employee-misbound', lineUserId: 'line-source',
    displayName: 'Legacy employee fixture', balance: -200
  });
  database.run(`UPDATE users SET updated_at = '2026-09-01T00:00:00.000Z' WHERE user_id = 'user-canonical'`);
  database.run(`UPDATE users SET updated_at = '2026-10-07T03:00:00.000Z' WHERE user_id = 'user-legacy'`);
  seedUser(database, {
    userId: 'user-admin', employeeId: 'employee-admin', lineUserId: 'line-admin',
    displayName: 'Admin Fixture', role: 'Admin', verificationStatus: 'UNVERIFIED'
  });
  database.run(`UPDATE users SET updated_at = '2026-09-01T00:00:00.000Z' WHERE user_id = 'user-admin'`);
  for (const order of expected().refunds) {
    database.run(`
      INSERT INTO orders (
        order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
        display_name_snapshot, order_date, vendor, pickup_floor, total_amount,
        status, created_by_user_id, created_auth_mode
      ) VALUES (?, ?, ?, ?, ?, ?, 'Fixture Vendor', '1樓', 100, 'ACTIVE', ?, 'line')
    `, order.orderId, 'user-legacy', 'employee-misbound', 'line-source',
    'Legacy employee fixture', order.orderDate, 'user-legacy');
  }
  for (const order of expected().preservedOrders) {
    database.run(`
      INSERT INTO orders (
        order_id, user_id, employee_id_snapshot, display_name_snapshot,
        order_date, vendor, pickup_floor, total_amount, status, created_by_user_id,
        created_auth_mode
      ) VALUES (?, 'user-canonical', 'employee-canonical', 'Canonical Fixture', ?,
        'Fixture Vendor', '1樓', 100, 'ACTIVE', 'user-canonical', 'employee_guest')
    `, order.orderId, order.orderDate);
  }
  seedLedgerRow(database, {
    transactionId: 'canonical-debit-06', userId: 'user-canonical', amount: -100,
    balanceAfter: 300, type: 'ORDER', referenceId: 'order-canonical-06',
    note: 'ORDER_CREATED', occurredAt: '2026-10-06T02:00:00.000Z'
  });
  seedLedgerRow(database, {
    transactionId: 'canonical-debit-07', userId: 'user-canonical', amount: -100,
    balanceAfter: 200, type: 'ORDER', referenceId: 'order-canonical-07',
    note: 'ORDER_CREATED', occurredAt: '2026-10-07T02:00:00.000Z'
  });
  seedLedgerRow(database, {
    transactionId: 'order-debit-06', userId: 'user-legacy', amount: -100,
    balanceAfter: -100, type: 'ORDER', referenceId: 'order-legacy-06',
    note: 'ORDER_CREATED', occurredAt: '2026-10-06T03:00:00.000Z'
  });
  seedLedgerRow(database, {
    transactionId: 'order-debit-07', userId: 'user-legacy', amount: -100,
    balanceAfter: -200, type: 'ORDER', referenceId: 'order-legacy-07',
    note: 'ORDER_CREATED', occurredAt: '2026-10-07T03:00:00.000Z'
  });
  database.run(`
    INSERT INTO employee_guest_sessions(session_id, token_hash, user_id, employee_id, expires_at)
    VALUES ('guest-source-1', 'synthetic-token-hash', 'user-legacy', 'employee-misbound', '2026-10-09T00:00:00.000Z')
  `);
  database.run(`
    INSERT INTO employee_guest_sessions(session_id, token_hash, employee_id, expires_at)
    VALUES ('guest-provisional-source', 'synthetic-provisional-token', 'employee-misbound', '2026-10-09T00:00:00.000Z')
  `);
  return database;
};

const runPlan = async (database, plan) => database.batch(
  bindCanonicalIdentityRepairPlan(database, plan)
);
const stateSnapshot = (database) => Object.fromEntries([
  ['users', 'user_id'], ['orders', 'order_id'], ['balance_ledger', 'transaction_id'],
  ['balance_ledger_sequence', 'transaction_id'], ['employee_guest_sessions', 'session_id'],
  ['order_status_history', 'transition_id'], ['admin_audit_log', 'audit_id']
].map(([table, key]) => [table, database.database.prepare(`SELECT * FROM ${table} ORDER BY ${key}`)
  .all().map((row) => ({ ...row }))]));

test('identity repair cancels only duplicate orders, refunds sequentially, and preserves history', async () => {
  const database = fixture();
  const oldLedger = database.database.prepare(`
    SELECT bl.*, sequence_number FROM balance_ledger bl
    JOIN balance_ledger_sequence USING (transaction_id)
    ORDER BY sequence_number
  `).all();
  const plan = buildCanonicalIdentityRepairPlan(expected());

  await runPlan(database, plan);

  assert.deepEqual(database.database.prepare(`
    SELECT order_id, status, user_id, display_name_snapshot
    FROM orders WHERE user_id = 'user-legacy' ORDER BY order_date
  `).all().map((row) => ({ ...row })), [
    { order_id: 'order-legacy-06', status: 'CANCELLED', user_id: 'user-legacy', display_name_snapshot: 'Legacy employee fixture' },
    { order_id: 'order-legacy-07', status: 'CANCELLED', user_id: 'user-legacy', display_name_snapshot: 'Legacy employee fixture' }
  ]);
  assert.deepEqual(database.database.prepare(`
    SELECT order_id, user_id, status, total_amount FROM orders
    WHERE user_id = 'user-canonical' ORDER BY order_date
  `).all().map((row) => ({ ...row })), [
    { order_id: 'order-canonical-06', user_id: 'user-canonical', status: 'ACTIVE', total_amount: 100 },
    { order_id: 'order-canonical-07', user_id: 'user-canonical', status: 'ACTIVE', total_amount: 100 }
  ]);
  assert.deepEqual(database.database.prepare(`
    SELECT transaction_id, user_id, amount, balance_after, type, reference_id
    FROM balance_ledger WHERE type = 'REFUND' ORDER BY occurred_at, transaction_id
  `).all().map((row) => ({ ...row })), [
    { transaction_id: 'refund-legacy-06', user_id: 'user-legacy', amount: 100, balance_after: -100, type: 'REFUND', reference_id: 'order-legacy-06' },
    { transaction_id: 'refund-legacy-07', user_id: 'user-legacy', amount: 100, balance_after: 0, type: 'REFUND', reference_id: 'order-legacy-07' }
  ]);
  assert.deepEqual(database.database.prepare(`
    SELECT user_id, employee_id, line_user_id, display_name, active, balance
    FROM users WHERE user_id IN ('user-canonical', 'user-legacy') ORDER BY user_id
  `).all().map((row) => ({ ...row })), [
    { user_id: 'user-canonical', employee_id: 'employee-canonical', line_user_id: 'line-source', display_name: 'Canonical Fixture', active: 1, balance: 200 },
    { user_id: 'user-legacy', employee_id: 'employee-misbound', line_user_id: null, display_name: 'Legacy employee fixture', active: 0, balance: 0 }
  ]);
  assert.deepEqual(database.database.prepare(`
    SELECT bl.*, sequence_number FROM balance_ledger bl
    JOIN balance_ledger_sequence USING(transaction_id)
    WHERE transaction_id IN ('canonical-debit-06', 'canonical-debit-07', 'order-debit-06', 'order-debit-07')
    ORDER BY sequence_number
  `).all().map((row) => ({ ...row })), oldLedger.map((row) => ({ ...row })));
  assert.equal(database.get(`
    SELECT balance FROM users WHERE user_id = 'user-canonical'
  `).balance, 200);
  assert.equal(database.get(`
    SELECT revoked_reason FROM employee_guest_sessions WHERE session_id = 'guest-source-1'
  `).revoked_reason, 'admin_revoke');
  assert.equal(database.get(`
    SELECT revoked_reason FROM employee_guest_sessions WHERE session_id = 'guest-provisional-source'
  `).revoked_reason, 'admin_revoke');
  assert.equal(database.get(`SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'CANONICAL_IDENTITY_SPLIT_REPAIRED'`).count, 1);
  assert.equal(database.get(`SELECT COUNT(*) AS count FROM order_status_history WHERE to_status = 'CANCELLED'`).count, 2);
});

test('stale frozen state fails closed and leaves every row unchanged', async () => {
  const database = fixture();
  database.run(`UPDATE orders SET total_amount = 90 WHERE order_id = 'order-legacy-07'`);
  const before = database.database.prepare('SELECT * FROM users ORDER BY user_id').all();

  await assert.rejects(runPlan(database, buildCanonicalIdentityRepairPlan(expected())));

  assert.deepEqual(database.database.prepare('SELECT * FROM users ORDER BY user_id').all(), before);
  assert.equal(database.get(`SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'`).count, 0);
  assert.equal(database.get(`SELECT COUNT(*) AS count FROM order_status_history`).count, 0);
});

test('unexpected extra active source order fails before any repair writes', async () => {
  const database = fixture();
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, status, created_by_user_id
    ) VALUES ('order-extra', 'user-legacy', 'Legacy employee fixture', '2026-10-08',
      'Fixture Vendor', '1樓', 100, 'ACTIVE', 'user-legacy')
  `);

  await assert.rejects(runPlan(database, buildCanonicalIdentityRepairPlan(expected())));

  assert.equal(database.get(`SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'`).count, 0);
  assert.equal(database.get(`SELECT active FROM users WHERE user_id = 'user-legacy'`).active, 1);
});

test('changed canonical order, canonical profile, operator, or newly issued guest session fails closed', async (t) => {
  const cases = [
    ['retained order changed', (database) => database.run(`UPDATE orders SET status = 'CANCELLED' WHERE order_id = 'order-canonical-06'`)],
    ['canonical profile changed', (database) => database.run(`UPDATE users SET display_name = 'Changed Fixture' WHERE user_id = 'user-canonical'`)],
    ['source order dates no longer match their IDs', (database) => {
      database.run(`UPDATE orders SET order_date = '2026-10-08' WHERE order_id = 'order-legacy-06'`);
      database.run(`UPDATE orders SET order_date = '2026-10-06' WHERE order_id = 'order-legacy-07'`);
      database.run(`UPDATE orders SET order_date = '2026-10-07' WHERE order_id = 'order-legacy-06'`);
    }],
    ['source ORDER debit changed', (database) => database.run(`UPDATE balance_ledger SET amount = -90 WHERE transaction_id = 'order-debit-07'`)],
    ['operator no longer active admin', (database) => database.run(`UPDATE users SET active = 0 WHERE user_id = 'user-admin'`)],
    ['new provisional wrong-ID session', (database) => database.run(`
      INSERT INTO employee_guest_sessions(session_id, token_hash, employee_id, expires_at)
      VALUES ('guest-new-source', 'synthetic-new-token', 'employee-misbound', '2026-10-09T00:00:00.000Z')
    `)]
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const database = fixture();
      mutate(database);
      const before = stateSnapshot(database);
      await assert.rejects(runPlan(database, buildCanonicalIdentityRepairPlan(expected())));
      assert.deepEqual(stateSnapshot(database), before);
    });
  }
});

test('a mid-batch constraint failure rolls back the first refund and every earlier write', async () => {
  const database = fixture();
  const before = stateSnapshot(database);
  const plan = buildCanonicalIdentityRepairPlan(expected());
  const statements = bindCanonicalIdentityRepairPlan(database, plan);
  const injectedFailure = database.prepare(`
    INSERT INTO employee_guest_sessions(session_id, token_hash, user_id, expires_at)
    VALUES ('synthetic-fault', NULL, 'user-legacy', '2026-10-09T00:00:00.000Z')
  `).bind();

  await assert.rejects(database.batch([...statements.slice(0, 5), injectedFailure, ...statements.slice(5)]));

  assert.deepEqual(stateSnapshot(database), before);
});

test('read-only postcondition proves the no-op replay state and does not trust a caller flag', async () => {
  const database = fixture();
  await runPlan(database, buildCanonicalIdentityRepairPlan(expected()));
  const check = buildCanonicalIdentityRepairPostconditionQuery(expected());
  assert.equal(database.get(check.sql, ...check.params).is_applied, 1);
  assert.throws(() => buildCanonicalIdentityRepairPlan({ ...expected(), state: 'already-applied' }), /postcondition query/);
});

test('invalid or ambiguous repair requests are rejected before SQL is generated', () => {
  assert.throws(() => buildCanonicalIdentityRepairPlan({
    ...expected(), refunds: expected().refunds.slice(0, 1)
  }), /exactly two/);
  assert.throws(() => buildCanonicalIdentityRepairPlan({
    ...expected(), canonicalUserId: 'user-legacy'
  }), /distinct/);
  assert.throws(() => buildCanonicalIdentityRepairPlan({
    ...expected(), employeeId: 'employee-misbound'
  }), /different/);
});

test('frozen-state guards stay split and within the deterministic SQL expression budget', () => {
  const plan = buildCanonicalIdentityRepairPlan(expected());
  const guards = plan.statements.filter(({ kind }) => kind === 'precondition');
  assert.ok(guards.length >= 5);
  for (const { sql, params } of guards) {
    const booleanOperators = (sql.match(/\b(?:AND|OR)\b/gi) || []).length;
    const maxParenDepth = (() => {
      let depth = 0;
      let maxDepth = 0;
      for (const char of sql) {
        if (char === '(') { depth += 1; maxDepth = Math.max(maxDepth, depth); }
        if (char === ')') depth -= 1;
      }
      return maxDepth;
    })();
    assert.ok(booleanOperators + maxParenDepth <= 40, `guard exceeds expression budget: ${booleanOperators}+${maxParenDepth}`);
    assert.ok(params.length <= 80, `guard has too many parameters: ${params.length}`);
  }
  assert.ok(plan.statements.slice(0, guards.length).every(({ kind }) => kind === 'precondition'));
});
