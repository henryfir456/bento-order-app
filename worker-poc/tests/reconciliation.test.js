import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { makeFormalWorkbook } from './fixtures/formal-workbook.js';
import { normalizeLegacyWorkbook } from '../scripts/lib/import-normalizer.mjs';
import { createImportReport } from '../scripts/lib/quarantine-report.mjs';
import { validateImport } from '../scripts/lib/import-validator.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(readFileSync(
  join(here, 'fixtures', 'formal-import-expected.json'),
  'utf8'
));

test('reconciliation report classifies accepted, warning, and quarantine rows', () => {
  const normalized = normalizeLegacyWorkbook(makeFormalWorkbook(), {
    sourceHash: 'synthetic-source',
    importerVersion: 'test-version'
  });
  const report = createImportReport(validateImport(normalized));

  assert.deepEqual(report.reconciliation.sourceCounts, expected.sourceCounts);
  assert.deepEqual(report.reconciliation.acceptedCounts, expected.acceptedCounts);
  assert.deepEqual(report.reconciliation.quarantineByReason, expected.quarantineByReason);
  assert.deepEqual(report.reconciliation.warningByCode, expected.warningByCode);
  assert.equal(report.reconciliation.duplicateMenuWarnings.length, 1);
  assert.equal(report.reconciliation.orphanOrderCount, 1);
  assert.equal(report.reconciliation.incompleteLedgerCount, 1);
});
