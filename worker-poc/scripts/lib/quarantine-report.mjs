import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { cloneJson, ImportContractError } from './import-contract.mjs';
import { buildReconciliation } from './reconciliation.mjs';

export const createImportReport = (validation, options = {}) => ({
  schemaVersion: 1,
  importerVersion: validation?.importerVersion || 'unknown-version',
  sourceHash: validation?.sourceHash || 'unknown-source',
  batchId: validation?.batchId || 'unknown-batch',
  identityFoundationReadiness: cloneJson(validation?.identityFoundationReadiness || {
    status: 'BLOCKED',
    blockers: [{ code: 'IDENTITY_FOUNDATION_NOT_COMPUTED' }]
  }),
  legacyImportReadiness: cloneJson(validation?.legacyImportReadiness || validation?.readiness || {
    status: 'BLOCKED',
    blockers: [{ code: 'LEGACY_IMPORT_READINESS_NOT_COMPUTED' }]
  }),
  reconciliation: buildReconciliation(validation, options),
  warnings: cloneJson(validation?.warnings || []),
  quarantine: cloneJson(validation?.quarantine || [])
});

export const assertLocalReportPath = (outputPath) => {
  const path = resolve(outputPath);
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  if (normalized.includes('/tests/fixtures/')) {
    throw new ImportContractError(
      'REPORT_PATH_NOT_ALLOWED',
      'Importer reports cannot be written inside tracked fixtures.'
    );
  }
  return path;
};

export const writeImportReport = async (report, outputPath) => {
  const path = assertLocalReportPath(outputPath);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, JSON.stringify(report, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx'
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new ImportContractError(
        'OUTPUT_PATH_EXISTS',
        'The requested local report already exists; refusing to overwrite a user-owned import artifact.',
        { path }
      );
    }
    throw error;
  }
  return path;
};
