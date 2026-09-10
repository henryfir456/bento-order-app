import { createHash, randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APPROVED_BACKUP_SHA256,
  EXPECTED_INTERNAL_TABLE_INVENTORY,
  FORMAL_CLEANUP_TARGET,
  compareCleanupSnapshot,
  digestRows,
  readCleanupSnapshot,
  validateCleanupBaseline
} from './lib/formal-cleanup.mjs';

const execFileAsync = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
const workerRoot = resolve(here, '..');

export const REMOTE_CLEANUP_CONFIG = resolve(workerRoot, 'wrangler.remote-cleanup.jsonc');
export const REMOTE_CLEANUP_WORKER_NAME = 'bento-formal-maintenance-loopback';
export const REMOTE_CLEANUP_ENTRYPOINT = 'maintenance/remote-cleanup-entry.mjs';
export const DEFAULT_BACKUP_PATH = resolve(
  workerRoot,
  '.local-imports',
  'bento-formal-pre-cleanup-fresh-20260910-135408.sql'
);
export const REMOTE_CLEANUP_ENDPOINT = '/__bento-maintenance/formal-cleanup';
export const REMOTE_CLEANUP_HEALTH_ENDPOINT = '/__bento-maintenance/health';
export const REMOTE_SESSION_HEADER = 'X-Bento-Maintenance-Session';
export const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

const wranglerCommand = process.execPath;
const wranglerEntryPoint = resolve(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const createSnapshotDatabase = (sql) => {
  const database = new DatabaseSync(':memory:');
  database.exec(sql);
  return {
    prepare(query) {
      return {
        bind: (...bindings) => ({
          async first() {
            return database.prepare(query).get(...bindings) ?? null;
          },
          async all() {
            return { results: database.prepare(query).all(...bindings) };
          }
        })
      };
    },
    close() {
      database.close();
    }
  };
};

const parseJsonOutput = (output) => {
  const text = String(output || '').trim();
  const firstObject = text.indexOf('{');
  const lastObject = text.lastIndexOf('}');
  if (firstObject < 0 || lastObject <= firstObject) {
    const error = new Error('Wrangler D1 info did not return JSON.');
    error.code = 'REMOTE_D1_INFO_INVALID';
    throw error;
  }
  try {
    return JSON.parse(text.slice(firstObject, lastObject + 1));
  } catch (cause) {
    const error = new Error('Wrangler D1 info returned invalid JSON.');
    error.code = 'REMOTE_D1_INFO_INVALID';
    error.cause = cause;
    throw error;
  }
};

const normalizeDatabaseInfo = (value) => {
  const candidate = value?.result || value?.database || value;
  return {
    name: candidate?.name || candidate?.database_name,
    databaseId: candidate?.uuid || candidate?.database_id || candidate?.id
  };
};

export const parseArguments = (argv = []) => {
  const args = { dryRun: true };
  const valueArguments = new Set([
    'backup',
    'config',
    'expected-backup-sha256',
    'target',
    'database-id',
    'port'
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--execute') {
      args.execute = true;
      args.dryRun = false;
      continue;
    }
    if (argument === '--dry-run') {
      args.execute = false;
      args.dryRun = true;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      args.help = true;
      continue;
    }
    if (!argument.startsWith('--')) {
      throw new Error('Remote cleanup arguments must use --name value form.');
    }
    const name = argument.slice(2);
    if (!valueArguments.has(name)) throw new Error(`Unknown remote cleanup argument --${name}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Remote cleanup argument --${name} requires a value.`);
    args[name] = value;
    index += 1;
  }
  return args;
};

export const readJsoncConfig = (configPath) => {
  const text = readFileSync(resolve(configPath), 'utf8');
  try {
    return JSON.parse(text);
  } catch (cause) {
    const error = new Error('The remote maintenance Wrangler config must be valid JSONC/JSON.');
    error.code = 'REMOTE_CONFIG_INVALID';
    error.cause = cause;
    throw error;
  }
};

export const readRemoteConfigTarget = (configPath) => {
  const config = readJsoncConfig(configPath);
  const binding = config.d1_databases?.find((candidate) => candidate.binding === 'DB');
  if (!binding) {
    const error = new Error('The remote maintenance config has no DB D1 binding.');
    error.code = 'REMOTE_CONFIG_D1_BINDING_MISSING';
    throw error;
  }
  return {
    config,
    name: binding.database_name,
    databaseId: binding.database_id,
    vars: config.vars || {}
  };
};

export const assertRemoteAdapterTarget = ({
  target,
  databaseId,
  configuredDatabaseId,
  configuredTarget
} = {}) => {
  if (String(target || '').trim() !== FORMAL_CLEANUP_TARGET.name
    || String(configuredTarget || '').trim() !== FORMAL_CLEANUP_TARGET.name) {
    const error = new Error(`Remote cleanup requires target ${FORMAL_CLEANUP_TARGET.name}.`);
    error.code = 'CLEANUP_TARGET_INVALID';
    throw error;
  }
  if (String(databaseId || '').trim() !== FORMAL_CLEANUP_TARGET.databaseId
    || String(configuredDatabaseId || '').trim() !== FORMAL_CLEANUP_TARGET.databaseId) {
    const error = new Error(`Remote cleanup requires database UUID ${FORMAL_CLEANUP_TARGET.databaseId}.`);
    error.code = 'CLEANUP_DATABASE_ID_INVALID';
    throw error;
  }
  return { ...FORMAL_CLEANUP_TARGET };
};

export const assertRemoteConfig = (configPath, {
  target = FORMAL_CLEANUP_TARGET.name,
  databaseId = FORMAL_CLEANUP_TARGET.databaseId
} = {}) => {
  const configured = readRemoteConfigTarget(configPath);
  if (configured.config.name !== REMOTE_CLEANUP_WORKER_NAME
    || configured.config.main !== REMOTE_CLEANUP_ENTRYPOINT) {
    const error = new Error('The remote maintenance config must use the bounded loopback entrypoint.');
    error.code = 'REMOTE_CONFIG_ENTRYPOINT_INVALID';
    throw error;
  }
  assertRemoteAdapterTarget({
    target,
    databaseId,
    configuredTarget: configured.name,
    configuredDatabaseId: configured.databaseId
  });
  if (configured.vars.CLEANUP_TARGET_NAME !== FORMAL_CLEANUP_TARGET.name
    || configured.vars.CLEANUP_DATABASE_ID !== FORMAL_CLEANUP_TARGET.databaseId) {
    const error = new Error('Remote maintenance vars do not identify the formal D1 target.');
    error.code = 'REMOTE_CONFIG_TARGET_VARS_INVALID';
    throw error;
  }
  if (configured.config.routes || configured.config.route || configured.config.queues?.consumers) {
    const error = new Error('The maintenance config must not declare public Worker routes.');
    error.code = 'REMOTE_CONFIG_PUBLIC_ROUTE_FORBIDDEN';
    throw error;
  }
  return configured;
};

export const sha256File = (path) => (
  createHash('sha256').update(readFileSync(resolve(path))).digest('hex')
);

export const verifyBackupArtifact = (
  backupPath,
  expectedBackupSha256,
  { approvedSha256 = APPROVED_BACKUP_SHA256 } = {}
) => {
  const absolutePath = resolve(backupPath);
  let stats;
  try {
    stats = statSync(absolutePath);
  } catch (cause) {
    const error = new Error('The approved backup export file is unavailable.');
    error.code = 'CLEANUP_BACKUP_MISSING';
    error.cause = cause;
    throw error;
  }
  if (!stats.isFile() || stats.size <= 0) {
    const error = new Error('The approved backup export must be a non-empty file.');
    error.code = 'CLEANUP_BACKUP_INVALID';
    throw error;
  }
  const expected = String(expectedBackupSha256 || '').trim().toLowerCase();
  if (!SHA256_PATTERN.test(expected)) {
    const error = new Error('EXPECTED_BACKUP_SHA256 must be a 64-character SHA256 value.');
    error.code = 'CLEANUP_BACKUP_HASH_REQUIRED';
    throw error;
  }
  if (expected !== String(approvedSha256 || '').trim().toLowerCase()) {
    const error = new Error('EXPECTED_BACKUP_SHA256 is not the approved formal pre-cleanup backup hash.');
    error.code = 'CLEANUP_BACKUP_HASH_INVALID';
    error.details = { expected, approved: approvedSha256 };
    throw error;
  }
  const actual = sha256File(absolutePath);
  if (actual !== expected) {
    const error = new Error('The approved backup export SHA256 does not match EXPECTED_BACKUP_SHA256.');
    error.code = 'CLEANUP_BACKUP_HASH_INVALID';
    error.details = { expected, actual };
    throw error;
  }
  const sql = readFileSync(absolutePath, 'utf8');
  if (!/CREATE\s+TABLE/i.test(sql) || !/INSERT\s+INTO/i.test(sql)) {
    const error = new Error('The approved backup export lacks schema/data evidence.');
    error.code = 'CLEANUP_BACKUP_CONTENT_INVALID';
    throw error;
  }
  return {
    path: absolutePath,
    size: stats.size,
    sha256: actual,
    sql
  };
};

export const buildBaselineFromBackup = async (backup) => {
  const artifact = typeof backup === 'string'
    ? verifyBackupArtifact(backup, sha256File(backup))
    : backup;
  const database = createSnapshotDatabase(artifact.sql);
  try {
    const snapshot = await readCleanupSnapshot(database, {
      target: FORMAL_CLEANUP_TARGET.name,
      databaseId: FORMAL_CLEANUP_TARGET.databaseId
    });
    // D1 export intentionally omits _cf_KV.  The approved remote preflight
    // confirmed its presence; the live adapter still compares this digest and
    // fails closed if the remote inventory differs.
    const remoteBaseline = {
      ...snapshot,
      digests: {
        ...snapshot.digests,
        internalTableInventory: digestRows(EXPECTED_INTERNAL_TABLE_INVENTORY)
      },
      protectedObjects: {
        ...snapshot.protectedObjects,
        cfKvPresent: true
      }
    };
    validateCleanupBaseline(remoteBaseline);
    return remoteBaseline;
  } finally {
    database.close();
  }
};

export const readRemoteDatabaseInfo = async ({
  target = FORMAL_CLEANUP_TARGET.name,
  configPath = REMOTE_CLEANUP_CONFIG,
  exec = execFileAsync
} = {}) => {
  const result = await exec(wranglerCommand, [
    wranglerEntryPoint, 'd1', 'info', target,
    '--json', '--config', configPath
  ], {
    cwd: workerRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return normalizeDatabaseInfo(parseJsonOutput(result.stdout));
};

export const assertRemoteDatabaseInfo = (info) => {
  if (info?.name !== FORMAL_CLEANUP_TARGET.name) {
    const error = new Error('Remote D1 info returned the wrong database name.');
    error.code = 'REMOTE_D1_NAME_INVALID';
    throw error;
  }
  if (info?.databaseId !== FORMAL_CLEANUP_TARGET.databaseId) {
    const error = new Error('Remote D1 info returned the wrong database UUID.');
    error.code = 'REMOTE_D1_UUID_INVALID';
    throw error;
  }
  return true;
};

const readFreePort = async () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    server.close((error) => (error ? reject(error) : resolvePort(port)));
  });
});

const startRemoteWorker = async ({ configPath, backupSha256, port = null } = {}) => {
  const selectedPort = port || await readFreePort();
  const sessionToken = randomBytes(32).toString('hex');
  const child = spawn(wranglerCommand, [
    wranglerEntryPoint, 'dev',
    '--remote',
    '--config', configPath,
    '--ip', '127.0.0.1',
    '--port', String(selectedPort),
    '--show-interactive-dev-session=false',
    '--log-level', 'error',
    '--var', `MAINTENANCE_SESSION_TOKEN:${sessionToken}`,
    '--var', `EXPECTED_BACKUP_SHA256:${backupSha256}`
  ], {
    cwd: workerRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  const capture = (chunk) => {
    output += String(chunk || '');
    if (output.length > 8192) output = output.slice(-8192);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const stopped = new Promise((resolveStop) => {
    child.once('exit', (code, signal) => resolveStop({ code, signal }));
    child.once('error', (error) => resolveStop({ error }));
  });

  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32' && child.pid) {
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          maxBuffer: 64 * 1024
        });
      } catch {
        // The process may have exited between the state check and taskkill.
      }
    } else {
      child.kill('SIGTERM');
    }
    await Promise.race([
      stopped,
      new Promise((resolveStop) => setTimeout(resolveStop, 3000))
    ]);
  };

  return {
    baseUrl: `http://127.0.0.1:${selectedPort}`,
    sessionToken,
    output: () => output,
    stopped,
    stop
  };
};

const fetchJson = async (url, {
  sessionToken,
  method = 'GET',
  body,
  fetchImpl = fetch,
  signal
} = {}) => {
  const response = await fetchImpl(url, {
    method,
    signal,
    headers: {
      [REMOTE_SESSION_HEADER]: sessionToken,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Remote maintenance returned HTTP ${response.status}.`);
    error.code = payload?.error?.code || 'REMOTE_MAINTENANCE_REQUEST_FAILED';
    error.details = payload?.error?.details;
    throw error;
  }
  return payload;
};

const waitForHealth = async (worker, { fetchImpl = fetch, timeoutMs = 30000 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const health = await fetchJson(`${worker.baseUrl}${REMOTE_CLEANUP_HEALTH_ENDPOINT}`, {
        sessionToken: worker.sessionToken,
        fetchImpl,
        signal: AbortSignal.timeout(3000)
      });
      assertRemoteAdapterTarget({
        target: health?.target?.name,
        databaseId: health?.target?.databaseId,
        configuredTarget: FORMAL_CLEANUP_TARGET.name,
        configuredDatabaseId: FORMAL_CLEANUP_TARGET.databaseId
      });
      return health;
    } catch (error) {
      lastError = error;
      if (worker.stopped) {
        const stopped = await Promise.race([
          worker.stopped,
          new Promise((resolveStop) => setTimeout(() => resolveStop(null), 0))
        ]);
        if (stopped) break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
  }
  const error = new Error('The loopback remote maintenance Worker did not become ready.');
  error.code = 'REMOTE_MAINTENANCE_START_FAILED';
  error.cause = lastError;
  error.details = { workerOutput: worker.output() };
  throw error;
};

const sanitizePreflight = (payload) => ({
  kind: payload?.result?.kind,
  mode: payload?.result?.mode,
  target: payload?.result?.target,
  baselineProvided: payload?.result?.baselineProvided,
  baselineMatches: payload?.result?.baselineMatches,
  baselineMismatches: payload?.result?.baselineMismatches || [],
  readyForExecute: payload?.result?.readyForExecute,
  before: payload?.result?.before,
  after: payload?.result?.after,
  reconciliation: payload?.result?.reconciliation,
  expectedBackupSha256: payload?.expectedBackupSha256
});

export const runRemoteAdapter = async ({
  argv = [],
  environment = process.env,
  getRemoteInfo = readRemoteDatabaseInfo,
  startWorker = startRemoteWorker,
  fetchImpl = fetch,
  resolveBaseline = buildBaselineFromBackup,
  approvedBackupSha256 = APPROVED_BACKUP_SHA256
} = {}) => {
  const args = Array.isArray(argv) ? parseArguments(argv) : argv;
  if (args.help) return { mode: 'help' };
  const dryRun = args.dryRun !== false && args.execute !== true;
  const configPath = resolve(args.config || REMOTE_CLEANUP_CONFIG);
  const target = args.target || FORMAL_CLEANUP_TARGET.name;
  const databaseId = args['database-id'] || FORMAL_CLEANUP_TARGET.databaseId;
  const configured = assertRemoteConfig(configPath, { target, databaseId });
  const backupPath = resolve(args.backup || DEFAULT_BACKUP_PATH);
  const expectedBackupSha256 = String(
    args['expected-backup-sha256'] || environment.EXPECTED_BACKUP_SHA256 || ''
  ).trim().toLowerCase();
  const backup = verifyBackupArtifact(backupPath, expectedBackupSha256, { approvedSha256: approvedBackupSha256 });
  const baseline = await resolveBaseline(backup);
  validateCleanupBaseline(baseline);

  const info = await getRemoteInfo({
    target: configured.name,
    configPath
  });
  assertRemoteDatabaseInfo(info);

  if (!dryRun && environment.CONFIRM_REMOTE_CLEANUP !== 'YES') {
    const error = new Error('Remote execute requires CONFIRM_REMOTE_CLEANUP=YES.');
    error.code = 'CLEANUP_CONFIRMATION_REQUIRED';
    throw error;
  }

  const worker = await startWorker({
    configPath,
    backupSha256: expectedBackupSha256,
    port: args.port ? Number(args.port) : null
  });
  try {
    const health = await waitForHealth(worker, { fetchImpl });
    const payload = await fetchJson(`${worker.baseUrl}${REMOTE_CLEANUP_ENDPOINT}`, {
      sessionToken: worker.sessionToken,
      method: 'POST',
      fetchImpl,
      body: {
        mode: dryRun ? 'dry-run' : 'execute',
        expectedBackupSha256,
        baseline,
        confirmation: dryRun ? undefined : 'CONFIRM_REMOTE_CLEANUP=YES'
      }
    });
    if (payload?.expectedBackupSha256 !== expectedBackupSha256) {
      const error = new Error('Remote maintenance did not echo the approved backup SHA256.');
      error.code = 'CLEANUP_BACKUP_HASH_INVALID';
      throw error;
    }
    const result = sanitizePreflight(payload);
    if (result.target?.name !== FORMAL_CLEANUP_TARGET.name
      || result.target?.databaseId !== FORMAL_CLEANUP_TARGET.databaseId) {
      const error = new Error('Remote maintenance returned the wrong cleanup target.');
      error.code = 'CLEANUP_TARGET_INVALID';
      throw error;
    }
    if (dryRun) {
      const comparison = compareCleanupSnapshot(result.before, baseline);
      if (!result.baselineMatches || result.baselineMismatches?.length || !comparison.matches) {
        const error = new Error('Remote preflight differs from the approved baseline.');
        error.code = 'CLEANUP_BASELINE_MISMATCH';
        error.details = {
          remoteMismatches: result.baselineMismatches,
          adapterMismatches: comparison.mismatches
        };
        throw error;
      }
    } else if (result.reconciliation?.passed !== true) {
      const error = new Error('Remote cleanup did not return a passing post-clean reconciliation.');
      error.code = 'CLEANUP_RECONCILIATION_FAILED';
      error.details = result.reconciliation;
      throw error;
    }
    return {
      mode: dryRun ? 'dry-run' : 'execute',
      target: FORMAL_CLEANUP_TARGET,
      backup: {
        path: backup.path,
        size: backup.size,
        sha256: backup.sha256
      },
      health,
      preflight: result
    };
  } finally {
    await worker.stop();
  }
};

const helpText = () => [
  'Formal bento-formal remote maintenance adapter (dry-run by default)',
  '',
  'Read-only remote preflight:',
  '  $env:EXPECTED_BACKUP_SHA256 = \'<approved SHA256>\'',
  '  node scripts/remote-cleanup-formal.mjs --dry-run',
  '',
  'A future execute requires both --execute and CONFIRM_REMOTE_CLEANUP=YES.',
  'The adapter always requires the approved backup export and exact formal D1 UUID.',
  `Target: ${FORMAL_CLEANUP_TARGET.name}`,
  `UUID: ${FORMAL_CLEANUP_TARGET.databaseId}`
].join('\n');

export const runCli = async (argv = process.argv.slice(2), environment = process.env) => {
  const args = parseArguments(argv);
  if (args.help) {
    process.stdout.write(helpText() + '\n');
    return { mode: 'help' };
  }
  const result = await runRemoteAdapter({ argv: args, environment });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runCli().catch((error) => {
    process.stderr.write(JSON.stringify({
      success: false,
      error: {
        code: error?.code || 'REMOTE_CLEANUP_FAILED',
        message: error?.message || String(error),
        details: error?.details
      }
    }, null, 2) + '\n');
    process.exitCode = 1;
  });
}
