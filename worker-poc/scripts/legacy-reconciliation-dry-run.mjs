import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { IMPORTER_VERSION, ImportContractError, asText } from './lib/import-contract.mjs';
import { normalizeLegacyWorkbook } from './lib/import-normalizer.mjs';
import { resolveLegacyIdentities } from './lib/identity-mapping.mjs';
import { buildLegacyReconciliationPlan } from './lib/legacy-reconciliation.mjs';
import { readLegacySqlDump } from './lib/legacy-sql-adapter.mjs';
import { validateImport } from './lib/import-validator.mjs';
import { readLegacyWorkbook } from './lib/workbook-reader.mjs';

const rejectedArguments = new Set([
  'remote', 'apply', 'execute', 'deploy', 'migration', 'migrate', 'write',
  'production', 'production-write', 'remote-write'
]);

const writeFreshReport = async (outputPath, report) => {
  const path = resolve(outputPath);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new ImportContractError(
        'OUTPUT_PATH_EXISTS',
        'The dry-run report already exists; refusing to overwrite it.',
        { path }
      );
    }
    throw error;
  }
  return path;
};

const readSnapshot = async (snapshotPath) => {
  if (!asText(snapshotPath).trim()) return undefined;
  try {
    return JSON.parse(await readFile(resolve(snapshotPath), 'utf8'));
  } catch (error) {
    throw new ImportContractError(
      'D1_SNAPSHOT_UNAVAILABLE',
      'The local offline D1 snapshot could not be read; no remote fallback is allowed.',
      { cause: error?.code || error?.message || 'invalid-json' }
    );
  }
};

export const runLegacyReconciliationDryRun = async ({
  inputPath,
  sqlDumpPath,
  historicalFacts,
  d1SnapshotPath,
  d1Snapshot,
  outputPath,
  adapter,
  importerVersion = IMPORTER_VERSION
} = {}) => {
  if (!asText(inputPath).trim()) {
    throw new ImportContractError('WORKBOOK_PATH_REQUIRED', 'A local workbook path is required.');
  }
  if (!asText(outputPath).trim()) {
    throw new ImportContractError('REPORT_PATH_REQUIRED', 'An explicit local report path is required.');
  }
  const workbook = await readLegacyWorkbook(inputPath, { adapter });
  const normalized = normalizeLegacyWorkbook(workbook, {
    sourceHash: workbook.sourceHash,
    importerVersion
  });
  const mapped = resolveLegacyIdentities(normalized);
  const validation = validateImport(mapped, { ledgerPolicyApproved: false });
  const snapshot = d1Snapshot === undefined ? await readSnapshot(d1SnapshotPath) : d1Snapshot;
  const parsedHistoricalFacts = historicalFacts === undefined
    ? (asText(sqlDumpPath).trim() ? await readLegacySqlDump(sqlDumpPath) : {
        historicalOrderFacts: [],
        historicalLikeFacts: [],
        historicalWalletFacts: [],
        historicalMenuFacts: [],
        historicalTypeFacts: [],
        sourceShapeIssues: [],
        sourceHash: 'unknown-sql-source'
      })
    : historicalFacts;
  const report = buildLegacyReconciliationPlan({
    currentSnapshot: {
      normalized: mapped,
      workbook,
      sourceHash: workbook.sourceHash
    },
    historicalFacts: parsedHistoricalFacts,
    validation,
    d1Snapshot: snapshot,
    sourceHashes: {
      excel: workbook.sourceHash,
      sql: parsedHistoricalFacts.sourceHash || 'unknown-sql-source'
    },
    importerVersion
  });
  const writtenPath = await writeFreshReport(outputPath, report);
  return { ...report, writtenPath };
};

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new ImportContractError('ARGUMENT_INVALID', 'Arguments must use --name value form.');
    }
    const key = argument.slice(2);
    if (rejectedArguments.has(key)) {
      throw new ImportContractError(
        'DRY_RUN_MUTATION_ARGUMENT_REJECTED',
        `--${key} is prohibited by the reconciliation dry-run safety contract.`
      );
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new ImportContractError('ARGUMENT_VALUE_REQUIRED', 'Argument requires a value.', { argument });
    }
    args[key] = value;
    index += 1;
  }
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const sqlDumpPath = args['sql-dump'] || args.sql;
  if (!asText(sqlDumpPath).trim()) {
    throw new ImportContractError(
      'SQL_DUMP_PATH_REQUIRED',
      'The local historical SQL dump path is required for the two-source dry run.'
    );
  }
  if (!asText(args['d1-snapshot']).trim()) {
    throw new ImportContractError(
      'D1_SNAPSHOT_PATH_REQUIRED',
      'The local offline D1 snapshot path is required; remote fallback is prohibited.'
    );
  }
  const result = await runLegacyReconciliationDryRun({
    inputPath: args.input || args.workbook,
    sqlDumpPath,
    d1SnapshotPath: args['d1-snapshot'],
    outputPath: args.output,
    importerVersion: args['importer-version'] || IMPORTER_VERSION
  });
  console.log(JSON.stringify({
    writtenPath: result.writtenPath,
    planHash: result.planHash,
    summary: result.summary,
    dryRunSafety: result.dryRunSafety
  }, null, 2));
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      error: error?.code || 'LEGACY_RECONCILIATION_FAILED',
      message: error?.message || 'Legacy reconciliation dry-run failed.'
    }));
    process.exitCode = 1;
  });
}
