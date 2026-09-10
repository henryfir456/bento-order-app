import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeLegacyWorkbook } from '../scripts/lib/import-normalizer.mjs';
import { buildImportOperations } from '../scripts/lib/import-writer.js';
import { buildReplacementSql } from '../scripts/lib/replacement-import.mjs';
import { validateImport } from '../scripts/lib/import-validator.mjs';
import { makeFormalWorkbook } from './fixtures/formal-workbook.js';

const workbookWithoutEmployeeId = () => {
  const workbook = makeFormalWorkbook();
  workbook.shapeIssues = [{
    code: 'EMPLOYEE_ID_FIELD_MISSING',
    sheet: 'Users',
    expectedColumns: ['employee_id'],
    actualColumns: ['UserID', 'DisplayName', '樓層', 'Balance', 'Role']
  }];
  workbook.sheets.Users.headers = ['UserID', 'DisplayName', '樓層', 'Balance', 'Role'];
  workbook.sheets.Users.rows = workbook.sheets.Users.rows.map((row) => {
    const { employee_id: unusedEmployeeId, ...rawWithoutEmployeeId } = row.raw;
    const { employee_id: unusedNormalizedEmployeeId, ...rowWithoutEmployeeId } = row;
    return {
      ...rowWithoutEmployeeId,
      raw: rawWithoutEmployeeId
    };
  });
  return workbook;
};

test('missing Users.employee_id makes final replacement readiness BLOCKED', () => {
  const validation = validateImport(
    normalizeLegacyWorkbook(workbookWithoutEmployeeId(), {
      sourceHash: 'missing-employee-source',
      importerVersion: 'readiness-test'
    })
  );

  assert.equal(validation.readiness.status, 'BLOCKED');
  assert.ok(validation.readiness.blockers.some((item) => (
    item.code === 'EMPLOYEE_ID_FIELD_MISSING'
  )));
  assert.equal(validation.readiness.financialSummary.unexplainedOffsets.length, 0);
  const operations = buildImportOperations(validation).operations;
  assert.equal(operations.some((operation) => /ADJUSTMENT|offset/i.test(operation.query)), false);
  assert.throws(
    () => buildReplacementSql(validation),
    (error) => error.code === 'REPLACEMENT_NOT_READY'
  );
});

test('readiness reports financial evidence gaps instead of manufacturing a balancing offset', () => {
  const workbook = makeFormalWorkbook();
  workbook.sheets.Orders.rows = workbook.sheets.Orders.rows.slice(0, 1);
  workbook.sheets.Likes.rows = [];
  workbook.sheets.TopupHistory.rows = [];
  const validation = validateImport(
    normalizeLegacyWorkbook(workbook, {
      sourceHash: 'nonzero-balance-source',
      importerVersion: 'readiness-test'
    })
  );

  assert.equal(validation.readiness.status, 'BLOCKED');
  assert.ok(validation.readiness.blockers.some((item) => (
    item.code === 'OPENING_BALANCE_POLICY_REQUIRED'
  )));
  assert.equal(validation.readiness.financialSummary.unexplainedOffsets.length, 2);
  assert.equal(validation.readiness.financialSummary.unexplainedOffsets.every((item) => (
    item.status === 'OPENING_BALANCE_POLICY_REQUIRED'
  )), true);
  assert.equal(buildImportOperations(validation).operations.some((operation) => (
    /ADJUSTMENT|offset/i.test(operation.query)
  )), false);
});
