import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { stageImport } from '../scripts/lib/import-writer.js';
import { reconstructOrderDebit } from '../scripts/lib/reconstruct-order-debit.mjs';
import { runImport } from '../scripts/import-legacy-workbook.mjs';
import { normalizeLegacyWorkbook } from '../scripts/lib/import-normalizer.mjs';
import { validateImport } from '../scripts/lib/import-validator.mjs';
import { makeFormalWorkbook } from './fixtures/formal-workbook.js';
import { SqliteD1 } from './helpers/formal-db.js';

const validationFor = (ledgerPolicyApproved = false) => validateImport(
  normalizeLegacyWorkbook(makeFormalWorkbook(), {
    sourceHash: 'synthetic-source',
    importerVersion: 'test-version'
  }),
  { ledgerPolicyApproved }
);

const seedReconstructableOrder = (database, {
  orderId = 'post-cutoff-order',
  userId = 'canonical-105499',
  employeeId = '105499',
  balance = -100,
  totalAmount = 100
} = {}) => {
  database.run(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor, balance, role
    ) VALUES (?, ?, ?, ?, '1樓', ?, 'User')
  `, userId, employeeId, `line-${employeeId}`, `Employee ${employeeId}`, balance);
  database.run(`
    INSERT INTO import_batches (batch_id, source_hash, importer_version, status)
    VALUES ('batch-reconstruction', 'hash-reconstruction', 'test', 'STAGED')
  `);
  database.run(`
    INSERT INTO orders (
      order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, order_date, vendor, pickup_floor, total_amount,
      status, created_by_user_id, created_auth_mode, source_batch_id
    ) VALUES (?, ?, ?, ?, ?, '2026-09-14', 'Vendor A', '1樓', ?,
              'COMPLETED', ?, 'legacy_import', 'batch-reconstruction')
  `, orderId, userId, employeeId, `line-${employeeId}`, `Employee ${employeeId}`, totalAmount, userId);
};

test('stage mode writes only validated operational rows and quarantines orphans', async () => {
  const database = new SqliteD1();
  const validation = validationFor();
  const userId = validation.accepted.Users.find((row) => row.employeeId === '000001').userId;
  const first = await stageImport(database, validation, {
    clock: new Date('2026-09-08T00:00:00.000Z')
  });
  const second = await stageImport(database, validation, {
    clock: new Date('2026-09-08T00:00:00.000Z')
  });

  assert.deepEqual(first.stagedCounts, second.stagedCounts);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 2);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_items').count, 3);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE order_id = 'order-orphan'").count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM order_items').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM opening_balance_snapshots').count, 2);
  assert.equal(database.get(`
    SELECT policy_status FROM opening_balance_snapshots WHERE user_id = ?
  `, userId).policy_status, 'REQUIRED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM import_quarantine').count, 2);
  assert.equal(database.get("SELECT status FROM import_batches WHERE source_hash = 'synthetic-source'").status, 'QUARANTINED');
  assert.equal(first.balanceReconciliation.openingBalancePolicyRequiredCount, 2);
});

test('stage mode preserves signed money on completed legacy Orders', async () => {
  const database = new SqliteD1();
  const validation = validationFor();
  const sourceOrder = validation.accepted.Orders[0];
  validation.accepted.Orders = [
    {
      ...sourceOrder,
      orderId: 'completed-negative-stage-order',
      status: 'COMPLETED',
      legacyItemId: 'revert1',
      itemName: 'Fee waiver',
      unitPrice: -1,
      subtotal: -1
    },
    {
      ...sourceOrder,
      orderId: 'completed-negative-stage-order',
      status: 'COMPLETED',
      legacyItemId: 'legacy-duplicate',
      itemName: 'Synthetic Bento A',
      unitPrice: 1,
      subtotal: 1
    }
  ];

  await stageImport(database, validation, {
    clock: new Date('2026-09-08T00:00:00.000Z')
  });

  assert.equal(database.get(`
    SELECT status FROM orders WHERE order_id = ?
  `, 'completed-negative-stage-order').status, 'COMPLETED');
  const adjustment = database.get(`
    SELECT unit_price, subtotal
    FROM order_items
    WHERE order_id = ? AND legacy_item_id = ?
  `, 'completed-negative-stage-order', 'revert1');
  assert.equal(adjustment.unit_price, -1);
  assert.equal(adjustment.subtotal, -1);
});

test('stage mode refuses accepted historical ledger rows without a separate policy implementation', async () => {
  const database = new SqliteD1();
  await assert.rejects(
    stageImport(database, validationFor(true)),
    (error) => error.code === 'HISTORICAL_LEDGER_POLICY_REQUIRED'
  );
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
});

test('post-cutoff reconstruction applies one canonical debit and reruns as a no-op', async () => {
  const database = new SqliteD1();
  seedReconstructableOrder(database);
  database.run(`
    INSERT INTO balance_ledger (
      transaction_id, user_id, amount, balance_after, type, reference_id,
      auth_mode, occurred_at
    ) VALUES ('txn-reconstruction-opening', 'canonical-105499', 1115, 1015,
              'ADJUSTMENT', 'opening-reconstruction', 'legacy_import',
              '2026-09-13T00:00:00.000Z')
  `);

  const first = await reconstructOrderDebit(database, 'post-cutoff-order', {
    sourceBatchId: 'batch-reconstruction',
    occurredAt: '2026-09-14T12:00:00.000Z'
  });
  const retry = await reconstructOrderDebit(database, 'post-cutoff-order', {
    sourceBatchId: 'batch-reconstruction',
    occurredAt: '2026-09-14T12:00:00.000Z'
  });

  assert.equal(first.status, 'APPLIED');
  assert.equal(first.balanceBefore, 1015);
  assert.equal(first.amount, -100);
  assert.equal(first.balanceAfter, 915);
  assert.equal(first.newBalance, 915);
  assert.equal(retry.status, 'NO_OP');
  assert.equal(retry.newBalance, 915);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'canonical-105499'").balance, 915);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM balance_ledger
    WHERE user_id = 'canonical-105499' AND type = 'ORDER'
      AND reference_id = 'post-cutoff-order'
  `).count, 1);
  const ledger = database.get(`
    SELECT amount, balance_after, note, source_batch_id
    FROM balance_ledger
    WHERE reference_id = 'post-cutoff-order'
  `);
  assert.deepEqual({ ...ledger }, {
    amount: -100,
    balance_after: 915,
    note: 'POST_CUTOFF_ORDER_RECONSTRUCTION',
    source_batch_id: 'batch-reconstruction'
  });
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM balance_ledger_sequence bls
    JOIN balance_ledger bl ON bl.transaction_id = bls.transaction_id
    WHERE bl.reference_id = 'post-cutoff-order'
  `).count, 1);
});

test('reconstruction fails closed when an order reference already has conflicting finance', async () => {
  const database = new SqliteD1();
  seedReconstructableOrder(database, { orderId: 'conflicting-post-cutoff-order' });
  database.run(`
    INSERT INTO balance_ledger (
      transaction_id, user_id, amount, balance_after, type, reference_id,
      auth_mode, occurred_at
    ) VALUES ('txn-conflicting-reconstruction', 'canonical-105499', -90, 10,
              'ORDER', 'conflicting-post-cutoff-order', 'legacy_import',
              '2026-09-14T12:00:00.000Z')
  `);

  await assert.rejects(
    reconstructOrderDebit(database, 'conflicting-post-cutoff-order'),
    (error) => error.code === 'RECONSTRUCTION_REFERENCE_CONFLICT'
  );
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'canonical-105499'").balance, -100);
  assert.equal(database.get(`
    SELECT COUNT(*) AS count
    FROM balance_ledger
    WHERE reference_id = 'conflicting-post-cutoff-order'
  `).count, 1);
});

test('runImport stage mode writes a local reconciliation report without needing an XLSX dependency', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bento-import-stage-'));
  const inputPath = join(directory, 'synthetic.xlsx');
  const outputPath = join(directory, 'report.json');
  const database = new SqliteD1();
  await writeFile(inputPath, 'synthetic workbook bytes', 'utf8');
  try {
    const result = await runImport({
      inputPath,
      outputPath,
      mode: 'stage',
      database,
      adapter: { read: async () => makeFormalWorkbook() }
    });
    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(result.reconciliation.stagedCounts.Orders, 1);
    assert.equal(report.reconciliation.balanceReconciliation.openingBalancePolicyRequiredCount, 2);
    assert.equal(report.reconciliation.orphanOrderCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
