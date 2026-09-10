import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { makeFormalWorkbook } from './fixtures/formal-workbook.js';
import {
  REASON_CODES,
  parseBoolean,
  parseDateOnly,
  parseInteger,
  parseTimestamp
} from '../scripts/lib/import-contract.mjs';
import { normalizeLegacyWorkbook } from '../scripts/lib/import-normalizer.mjs';
import { validateImport } from '../scripts/lib/import-validator.mjs';
import { readLegacyWorkbook } from '../scripts/lib/workbook-reader.mjs';
import { runImport } from '../scripts/import-legacy-workbook.mjs';

test('primitive import parsing is strict and keeps negative integer balances valid', () => {
  assert.equal(parseInteger('100'), 100);
  assert.equal(parseInteger('-20'), -20);
  assert.equal(parseInteger('1.5'), null);
  assert.equal(parseBoolean(true), true);
  assert.equal(parseBoolean(false), false);
  assert.equal(parseBoolean('unknown'), null);
  assert.equal(parseBoolean(''), null);
  assert.equal(parseDateOnly('2026-09-08'), '2026-09-08');
  assert.equal(parseDateOnly('2026-02-30'), null);
  assert.equal(
    parseTimestamp('2026-09-07T10:00:00+08:00'),
    '2026-09-07T02:00:00.000Z'
  );
});

test('normalizing the same workbook twice keeps stable internal menu IDs', () => {
  const first = normalizeLegacyWorkbook(makeFormalWorkbook(), {
    sourceHash: 'synthetic-source',
    importerVersion: 'test-version'
  });
  const second = normalizeLegacyWorkbook(makeFormalWorkbook(), {
    sourceHash: 'synthetic-source',
    importerVersion: 'test-version'
  });

  assert.deepEqual(
    first.Menu.map((item) => item.menuItemId),
    second.Menu.map((item) => item.menuItemId)
  );
  assert.notEqual(first.Menu[0].menuItemId, first.Menu[1].menuItemId);
  assert.equal(first.Menu[0].legacyItemId, first.Menu[1].legacyItemId);
  assert.equal(first.Users[1].balance, -20);
});

test('validation accepts duplicate and disabled menu rows but quarantines orphan orders', () => {
  const normalized = normalizeLegacyWorkbook(makeFormalWorkbook(), {
    sourceHash: 'synthetic-source',
    importerVersion: 'test-version'
  });
  const validation = validateImport(normalized);

  assert.equal(validation.summary.acceptedCounts.Menu, 3);
  assert.equal(validation.summary.acceptedCounts.Orders, 1);
  assert.equal(validation.summary.quarantineByReason[REASON_CODES.ORPHAN_ORDER_USER], 1);
  assert.equal(
    validation.summary.quarantineByReason[REASON_CODES.INCOMPLETE_LEDGER_POLICY],
    1
  );
  assert.equal(validation.summary.warningByCode[REASON_CODES.DUPLICATE_MENU_WARNING], 1);
  assert.equal(validation.summary.warningByCode.INFERRED_MODE, 1);

  const orphan = validation.quarantine.find(
    (item) => item.reasonCode === REASON_CODES.ORPHAN_ORDER_USER
  );
  assert.equal(orphan.normalizedPayload.orderId, 'order-orphan');
  assert.equal(orphan.normalizedPayload.lineUserId, null);
  assert.equal(validation.accepted.TopupHistory.length, 0);
});

test('ledger policy approval is the only switch that can accept ledger-like rows', () => {
  const normalized = normalizeLegacyWorkbook(makeFormalWorkbook(), {
    sourceHash: 'synthetic-source',
    importerVersion: 'test-version'
  });
  const validation = validateImport(normalized, { ledgerPolicyApproved: true });

  assert.equal(validation.accepted.TopupHistory.length, 1);
  assert.equal(validation.quarantine.length, 1);
  assert.equal(validation.quarantine[0].reasonCode, REASON_CODES.ORPHAN_ORDER_USER);
  assert.equal(validation.readiness.status, 'BLOCKED');
  assert.ok(validation.readiness.blockers.some((item) => (
    item.code === REASON_CODES.HISTORICAL_LEDGER_POLICY_REQUIRED
  )));
});

test('missing workbook sheets become explicit shape quarantine records', () => {
  const workbook = makeFormalWorkbook();
  delete workbook.sheets.Menu;
  const normalized = normalizeLegacyWorkbook({
    ...workbook,
    shapeIssues: [{
      code: REASON_CODES.MISSING_SHEET,
      sheet: 'Menu'
    }]
  }, {
    sourceHash: 'missing-menu',
    importerVersion: 'test-version'
  });
  const validation = validateImport(normalized);

  assert.equal(validation.summary.quarantineByReason[REASON_CODES.MISSING_SHEET], 1);
  assert.equal(validation.accepted.Menu.length, 0);
});

test('reader adapter preserves local source hash and canonicalizes rows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bento-import-reader-'));
  const inputPath = join(directory, 'synthetic.xlsx');
  await writeFile(inputPath, 'synthetic workbook bytes', 'utf8');
  try {
    const workbook = await readLegacyWorkbook(inputPath, {
      adapter: {
        read: async () => makeFormalWorkbook()
      }
    });
    assert.equal(workbook.sheets.Menu.rows.length, 3);
    assert.match(workbook.sourceHash, /^[a-f0-9]{64}$/);
    assert.equal(workbook.sheets.Orders.rows[1].source.row, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runImport writes a local report without staging operational rows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bento-import-report-'));
  const inputPath = join(directory, 'synthetic.xlsx');
  const outputPath = join(directory, 'report.json');
  await writeFile(inputPath, 'synthetic workbook bytes', 'utf8');
  try {
    const result = await runImport({
      inputPath,
      outputPath,
      adapter: {
        read: async () => makeFormalWorkbook()
      }
    });
    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(result.writtenPath, outputPath);
    assert.equal(report.reconciliation.orphanOrderCount, 1);
    assert.equal(report.reconciliation.incompleteLedgerCount, 1);
    assert.equal(report.reconciliation.acceptedCounts.Orders, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
