import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { cloneJson, ImportContractError } from './import-contract.mjs';
import { buildReconciliation } from './reconciliation.mjs';

export const createImportReport = (validation, options = {}) => ({
  schemaVersion: 1,
  importerVersion: validation?.importerVersion || 'unknown-version',
  sourceHash: validation?.sourceHash || 'unknown-source',
  batchId: validation?.batchId || 'unknown-batch',
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
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return path;
};
