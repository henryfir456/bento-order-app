import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openLocalCleanupDatabase } from './lib/local-db.mjs';
import {
  FORMAL_CLEANUP_TARGET,
  assertFormalCleanupTarget,
  confirmationEnvironmentVariable,
  runFormalCleanup
} from './lib/formal-cleanup.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));

export const parseArguments = (argv) => {
  const args = { dryRun: true };
  const valueArguments = new Set(['database', 'config', 'target', 'database-id', 'baseline', 'snapshot-output']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--execute') {
      args.execute = true;
      args.dryRun = false;
      continue;
    }
    if (argument === '--dry-run') {
      args.dryRun = true;
      args.execute = false;
      continue;
    }
    if (argument === '--remote') {
      args.remote = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      args.help = true;
      continue;
    }
    if (!argument.startsWith('--')) {
      throw new Error('Cleanup arguments must use --name value form.');
    }
    const name = argument.slice(2);
    if (!valueArguments.has(name)) throw new Error(`Unknown cleanup argument --${name}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Cleanup argument --${name} requires a value.`);
    args[name] = value;
    index += 1;
  }
  return args;
};

const helpText = () => [
  'Formal test-data cleanup runner (local-only in this release)',
  '',
  'Dry-run (default):',
  '  npm.cmd run cleanup:formal -- --database <local-db-path> --snapshot-output <path>',
  '',
  'Local disposable execution:',
  "  $env:CONFIRM_LOCAL_CLEANUP = 'YES'; npm.cmd run cleanup:formal -- --execute",
  '    --database <local-db-path> --baseline <preflight-json>',
  '',
  'Remote execution is intentionally rejected by this runner.',
  `Required formal target: ${FORMAL_CLEANUP_TARGET.name}`,
  `Required database UUID: ${FORMAL_CLEANUP_TARGET.databaseId}`
].join('\n');

const readConfigTarget = (configPath) => {
  const config = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
  const binding = config.d1_databases?.find((candidate) => candidate.binding === 'DB');
  if (!binding) throw new Error('The Wrangler config has no DB D1 binding.');
  return {
    name: binding.database_name,
    databaseId: binding.database_id
  };
};

const readJson = (path, code) => {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    const wrapped = new Error(`Unable to read ${code}.`);
    wrapped.code = code;
    wrapped.cause = error?.code || error?.message || 'invalid-json';
    throw wrapped;
  }
};

const canonicalPath = (path) => {
  const absolutePath = resolve(path);
  try {
    return realpathSync.native(absolutePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return join(realpathSync.native(dirname(absolutePath)), basename(absolutePath));
  }
};

export const assertSnapshotOutputPath = (databasePath, snapshotOutputPath) => {
  if (!snapshotOutputPath) return true;
  const databaseKey = canonicalPath(databasePath).toLowerCase();
  const outputKey = canonicalPath(snapshotOutputPath).toLowerCase();
  if (databaseKey === outputKey) {
    const error = new Error('Snapshot output must not be the cleanup database path.');
    error.code = 'CLEANUP_SNAPSHOT_OUTPUT_INVALID';
    throw error;
  }
  return true;
};

export const runCli = async (argv = process.argv.slice(2), environment = process.env) => {
  const args = parseArguments(argv);
  if (args.help) {
    process.stdout.write(helpText() + '\n');
    return { mode: 'help' };
  }
  if (args.remote) {
    const error = new Error('Remote cleanup is intentionally disabled in this runner.');
    error.code = 'REMOTE_CLEANUP_DISABLED';
    throw error;
  }
  if (!args.database) {
    const error = new Error('--database is required for local dry-run or execution.');
    error.code = 'LOCAL_DATABASE_REQUIRED';
    throw error;
  }

  const configPath = args.config || resolve(here, '..', 'wrangler.jsonc');
  const configured = readConfigTarget(configPath);
  const target = args.target || configured.name;
  const databaseId = args['database-id'] || configured.databaseId;
  assertFormalCleanupTarget({
    target,
    databaseId,
    configuredDatabaseId: configured.databaseId
  });

  const baseline = args.baseline ? readJson(args.baseline, 'cleanup baseline') : null;
  const databasePath = resolve(args.database);
  const snapshotOutputPath = args['snapshot-output'] ? resolve(args['snapshot-output']) : null;
  assertSnapshotOutputPath(databasePath, snapshotOutputPath);
  const database = openLocalCleanupDatabase(databasePath, { readOnly: args.dryRun });
  try {
    const executionMode = 'local';
    const confirmed = environment[confirmationEnvironmentVariable(executionMode)] === 'YES';
    const result = await runFormalCleanup(database, {
      target,
      databaseId,
      configuredDatabaseId: configured.databaseId,
      baseline,
      dryRun: args.dryRun,
      confirmed,
      executionMode
    });
    if (args['snapshot-output']) {
      const snapshot = result.mode === 'dry-run' ? result.before : result.after;
      writeFileSync(snapshotOutputPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {
    database.close();
  }
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runCli().catch((error) => {
    process.stderr.write(JSON.stringify({
      success: false,
      error: {
        code: error?.code || 'CLEANUP_FAILED',
        message: error?.message || String(error),
        details: error?.details || undefined
      }
    }, null, 2) + '\n');
    process.exitCode = 1;
  });
}
