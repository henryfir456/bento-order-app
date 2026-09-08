import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { stageImport } from '../scripts/lib/import-writer.js';
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

test('stage mode writes only validated operational rows and quarantines orphans', async () => {
  const database = new SqliteD1();
  const validation = validationFor();
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
    SELECT policy_status FROM opening_balance_snapshots WHERE line_user_id = 'user-1'
  `).policy_status, 'REQUIRED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM import_quarantine').count, 2);
  assert.equal(database.get("SELECT status FROM import_batches WHERE source_hash = 'synthetic-source'").status, 'QUARANTINED');
  assert.equal(first.balanceReconciliation.openingBalancePolicyRequiredCount, 2);
});

test('stage mode refuses accepted historical ledger rows without a separate policy implementation', async () => {
  const database = new SqliteD1();
  await assert.rejects(
    stageImport(database, validationFor(true)),
    (error) => error.code === 'HISTORICAL_LEDGER_POLICY_REQUIRED'
  );
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
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
