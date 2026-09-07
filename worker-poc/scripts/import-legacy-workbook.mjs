import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  IMPORTER_VERSION,
  ImportContractError,
  asText
} from './lib/import-contract.mjs';
import { normalizeLegacyWorkbook } from './lib/import-normalizer.mjs';
import { createImportReport, writeImportReport } from './lib/quarantine-report.mjs';
import { validateImport } from './lib/import-validator.mjs';
import { readLegacyWorkbook } from './lib/workbook-reader.mjs';

export const runImport = async ({
  inputPath,
  mode = 'validate',
  outputPath,
  adapter,
  importerVersion = IMPORTER_VERSION,
  ledgerPolicyApproved = false
} = {}) => {
  if (mode !== 'validate') {
    throw new ImportContractError(
      'IMPORT_MODE_UNAVAILABLE',
      'Wave 1 supports validation only; staging requires a later policy gate.'
    );
  }
  if (!asText(outputPath).trim()) {
    throw new ImportContractError(
      'REPORT_PATH_REQUIRED',
      'Validation output must be written to an explicit local report path.'
    );
  }

  const workbook = await readLegacyWorkbook(inputPath, { adapter });
  const normalized = normalizeLegacyWorkbook(workbook, {
    sourceHash: workbook.sourceHash,
    importerVersion
  });
  const validation = validateImport(normalized, { ledgerPolicyApproved });
  const report = createImportReport(validation);
  const writtenPath = await writeImportReport(report, outputPath);
  return {
    ...report,
    writtenPath
  };
};

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new ImportContractError('ARGUMENT_INVALID', 'Importer arguments must use --name value form.');
    }
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new ImportContractError('ARGUMENT_VALUE_REQUIRED', 'Importer argument requires a value.', {
        argument
      });
    }
    args[key] = value;
    index += 1;
  }
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) {
    throw new ImportContractError(
      'REPORT_PATH_REQUIRED',
      'Validation output must be written to an explicit local report path.'
    );
  }
  const result = await runImport({
    inputPath: args.input,
    mode: args.mode || 'validate',
    outputPath: resolve(args.output),
    importerVersion: args['importer-version'] || IMPORTER_VERSION
  });
  console.log(JSON.stringify({
    writtenPath: result.writtenPath,
    reconciliation: result.reconciliation
  }, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    const code = error?.code || 'IMPORT_FAILED';
    console.error(JSON.stringify({
      error: code,
      message: error?.message || 'Importer failed.'
    }));
    process.exitCode = 1;
  });
}
