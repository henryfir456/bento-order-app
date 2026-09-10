import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
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
import { stageImport } from './lib/import-writer.js';
import { openLocalFormalDatabase } from './lib/local-db.mjs';
import { loadIdentityMap, resolveLegacyIdentities } from './lib/identity-mapping.mjs';
import {
  assertProductionTarget,
  assertReviewedInput,
  buildDryRunArtifact,
  buildReplacementSql,
  readReviewedArtifact,
  replaceImport,
  PRODUCTION_TARGET,
  APPROVED_TEST_ORDER_EXCLUSIONS
} from './lib/replacement-import.mjs';

export const prepareImportModel = async ({
  inputPath,
  adapter,
  importerVersion,
  ledgerPolicyApproved,
  orderExclusions = new Map(),
  identityMapPath,
  identityMap
}) => {
  const workbook = await readLegacyWorkbook(inputPath, { adapter });
  const normalized = normalizeLegacyWorkbook(workbook, {
    sourceHash: workbook.sourceHash,
    importerVersion
  });
  const resolvedMap = identityMap || await loadIdentityMap(identityMapPath);
  const mapped = resolveLegacyIdentities(normalized, { identityMap: resolvedMap });
  return validateImport(mapped, {
    ledgerPolicyApproved,
    orderExclusions,
    identityMap: resolvedMap
  });
};

const prepareValidation = prepareImportModel;

const writeFreshFile = async (path, contents) => {
  try {
    await writeFile(path, contents, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new ImportContractError(
        'OUTPUT_PATH_EXISTS',
        'The requested local artifact already exists; refusing to overwrite a user-owned import artifact.',
        { path }
      );
    }
    throw error;
  }
  return path;
};

const configuredDatabaseIdentity = async (configPath) => {
  try {
    const config = JSON.parse(await readFile(resolve(configPath), 'utf8'));
    const binding = config.d1_databases?.find((candidate) => candidate.binding === 'DB');
    return {
      name: config.name,
      databaseId: binding?.database_id
    };
  } catch (error) {
    throw new ImportContractError('WRANGLER_CONFIG_UNAVAILABLE', 'The active Wrangler production config is unavailable.', {
      cause: error?.code || error?.message || 'invalid-json'
    });
  }
};

const runWrangler = (argumentsList) => spawnSync(
  process.execPath,
  [resolve('node_modules', 'wrangler', 'bin', 'wrangler.js'), ...argumentsList],
  { encoding: 'utf8', shell: false }
);

export const runImport = async ({
  inputPath,
  mode = 'validate',
  outputPath,
  adapter,
  importerVersion = IMPORTER_VERSION,
  ledgerPolicyApproved = false,
  database,
  clock = new Date(),
  identityMapPath,
  identityMap
} = {}) => {
  if (!['validate', 'stage'].includes(mode)) {
    throw new ImportContractError(
      'IMPORT_MODE_UNAVAILABLE',
      'Importer mode must be validate or stage.'
    );
  }
  if (!asText(outputPath).trim()) {
    throw new ImportContractError(
      'REPORT_PATH_REQUIRED',
      'Validation output must be written to an explicit local report path.'
    );
  }

  const validation = await prepareValidation({
    inputPath,
    adapter,
    importerVersion,
    ledgerPolicyApproved,
    identityMapPath,
    identityMap
  });
  const staged = mode === 'stage'
    ? await stageImport(database, validation, { clock })
    : null;
  const report = createImportReport(validation, staged ? {
    balanceReconciliation: staged.balanceReconciliation,
    stagedCounts: staged.stagedCounts
  } : {});
  const writtenPath = await writeImportReport(report, outputPath);
  return {
    ...report,
    staged,
    writtenPath
  };
};

const parseJsonOutput = (output) => {
  const text = String(output || '').trim();
  const start = Math.min(...[text.indexOf('['), text.indexOf('{')].filter((index) => index >= 0));
  if (!Number.isFinite(start)) throw new Error('Wrangler returned no JSON output.');
  return JSON.parse(text.slice(start));
};

const assertRemoteSourceNotApplied = ({ target, validation, configPath }) => {
  const result = runWrangler([
    'd1', 'execute', target,
    '--remote', '--config', configPath, '--command',
    `SELECT batch_id, source_hash, status FROM import_batches WHERE batch_id = '${validation.batchId}' OR source_hash = '${validation.sourceHash}' LIMIT 2`,
    '--json'
  ], { encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) {
    throw new ImportContractError(
      'REMOTE_REPLACEMENT_PREFLIGHT_FAILED',
      'Remote replacement preflight failed; no destructive command was started.',
      { cause: result.error?.message || result.stderr || result.status }
    );
  }
  const payload = parseJsonOutput(result.stdout);
  const rows = payload?.[0]?.results || payload?.results || [];
  if (rows.length) {
    throw new ImportContractError(
      'REPLACEMENT_ALREADY_APPLIED',
      'This source fingerprint or batch identifier is already present in the remote target.',
      { existing: rows }
    );
  }
};

export const runProductionReplace = async ({
  inputPath,
  outputPath,
  sqlOutputPath,
  adapter,
  importerVersion = IMPORTER_VERSION,
  target,
  databaseId,
  reviewedArtifact,
  confirmed = false,
  dryRun = false,
  remote = false,
  database,
  clock = new Date(),
  configPath = 'wrangler.jsonc',
  identityMapPath,
  identityMap
} = {}) => {
  const configured = await configuredDatabaseIdentity(configPath);
  assertProductionTarget({
    target,
    databaseId,
    configuredDatabaseId: configured.databaseId
  });
  if (dryRun && !outputPath) {
    throw new ImportContractError('REPORT_PATH_REQUIRED', 'A dry-run or reconciliation output path is required.');
  }
  const validation = await prepareValidation({
    inputPath,
    adapter,
    importerVersion,
    ledgerPolicyApproved: false,
    orderExclusions: new Map(
      APPROVED_TEST_ORDER_EXCLUSIONS.map((item) => [item.orderId, item])
    ),
    identityMapPath,
    identityMap
  });
  const destructiveCommand = [
    'npm.cmd run import:production:replace --',
    `--input "${inputPath}"`,
    `--target ${PRODUCTION_TARGET.name}`,
    `--database-id ${PRODUCTION_TARGET.databaseId}`,
    ...(identityMapPath ? [`--identity-map "${identityMapPath}"`] : []),
    `--reviewed-artifact "${outputPath}"`,
    '--confirm-production-replace',
    '--remote',
    `--config "${configPath}"`
  ].join(' ');
  if (dryRun) {
    const artifact = buildDryRunArtifact({
      validation,
      target,
      databaseId,
      inputPath,
      destructiveCommand
    });
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFreshFile(resolve(outputPath), JSON.stringify(artifact, null, 2) + '\n');
    if (sqlOutputPath && artifact.readyForReplacement) {
      await mkdir(dirname(resolve(sqlOutputPath)), { recursive: true });
      await writeFreshFile(resolve(sqlOutputPath), buildReplacementSql(validation, { clock }));
    }
    return { mode: 'dry-run', artifact, writtenPath: resolve(outputPath) };
  }
  assertReviewedInput(validation, await readReviewedArtifact(reviewedArtifact));
  if (!confirmed) {
    throw new ImportContractError(
      'PRODUCTION_CONFIRMATION_REQUIRED',
      'Destructive production replacement requires --confirm-production-replace.'
    );
  }
  const replacementSql = buildReplacementSql(validation, { clock });
  if (remote) {
    assertRemoteSourceNotApplied({ target, validation, configPath });
    const sqlPath = resolve(sqlOutputPath || `${reviewedArtifact}.sql`);
    await mkdir(dirname(sqlPath), { recursive: true });
    await writeFile(sqlPath, replacementSql, 'utf8');
    const result = runWrangler([
      'd1', 'execute', target,
      '--remote', '--config', configPath, '--file', sqlPath, '--yes', '--json'
    ], { encoding: 'utf8', shell: false });
    if (result.error || result.status !== 0) {
      throw new ImportContractError('REMOTE_REPLACEMENT_FAILED', 'Remote replacement failed.', {
        cause: result.error?.message || result.stderr || result.status
      });
    }
    return { mode: 'remote', sourceHash: validation.sourceHash, batchId: validation.batchId, sqlPath };
  }
  if (!database) {
    throw new ImportContractError(
      'LOCAL_DATABASE_REQUIRED',
      'Local replacement requires a D1-compatible database; remote replacement requires --remote.'
    );
  }
  const reconciliation = await replaceImport(database, validation, {
    target,
    databaseId,
    confirmed,
    clock
  });
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFreshFile(resolve(outputPath), JSON.stringify(reconciliation, null, 2) + '\n');
  return { mode: 'local', reconciliation, writtenPath: resolve(outputPath) };
};

const parseArgs = (argv) => {
  const args = {};
  const booleanArguments = new Set(['confirm-production-replace', 'dry-run', 'remote', 'local']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new ImportContractError('ARGUMENT_INVALID', 'Importer arguments must use --name value form.');
    }
    const key = argument.slice(2);
    if (booleanArguments.has(key)) {
      args[key] = true;
      continue;
    }
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
  if (!args.output && args.mode !== 'production-replace') {
    throw new ImportContractError(
      'REPORT_PATH_REQUIRED',
      'Validation output must be written to an explicit local report path.'
    );
  }
  const mode = args.mode || 'validate';
  if (mode === 'production-replace') {
    const database = args.local && args.database
      ? openLocalFormalDatabase(resolve(args.database))
      : null;
    try {
      const result = await runProductionReplace({
        inputPath: args.input,
        outputPath: args.output,
        sqlOutputPath: args['sql-output'],
        mode,
        target: args.target,
        databaseId: args['database-id'],
        reviewedArtifact: args['reviewed-artifact'],
        confirmed: args['confirm-production-replace'] === true,
        dryRun: args['dry-run'] === true,
        remote: args.remote === true,
        database,
        configPath: args.config || 'wrangler.jsonc',
        identityMapPath: args['identity-map']
      });
      console.log(JSON.stringify(result, null, 2));
    } finally {
      database?.close();
    }
    return;
  }
  const database = mode === 'stage'
    ? (args.database ? openLocalFormalDatabase(resolve(args.database)) : null)
    : null;
  try {
    const result = await runImport({
      inputPath: args.input,
      mode,
      outputPath: resolve(args.output),
      importerVersion: args['importer-version'] || IMPORTER_VERSION,
      identityMapPath: args['identity-map'],
      database
    });
    console.log(JSON.stringify({
      writtenPath: result.writtenPath,
      reconciliation: result.reconciliation
    }, null, 2));
  } finally {
    database?.close();
  }
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
