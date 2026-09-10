import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  assertRemoteAdapterTarget,
  assertRemoteDatabaseInfo,
  assertRemoteConfig,
  parseArguments,
  runRemoteAdapter,
  verifyBackupArtifact
} from '../scripts/remote-cleanup-formal.mjs';
import {
  REMOTE_CLEANUP_HEALTH_PATH,
  REMOTE_CLEANUP_PATH,
  REMOTE_CLEANUP_SESSION_HEADER,
  createRemoteCleanupHandler
} from '../maintenance/remote-cleanup-worker.mjs';
import {
  APPROVED_BACKUP_SHA256,
  FORMAL_CLEANUP_TARGET,
  PRE_CLEANUP_COUNTS,
  PRE_CLEANUP_LEDGER_BY_TYPE
} from '../scripts/lib/formal-cleanup.mjs';

const backupSql = `
CREATE TABLE users (line_user_id TEXT);
INSERT INTO users VALUES ('fixture');
`;

const createBackup = () => {
  const directory = mkdtempSync(join(tmpdir(), 'bento-remote-adapter-'));
  const path = join(directory, 'backup.sql');
  writeFileSync(path, backupSql, 'utf8');
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  return { directory, path, hash };
};

const configPath = fileURLToPath(new URL('../wrangler.remote-cleanup.jsonc', import.meta.url));

const baseline = {
  kind: 'bento-formal-test-cleanup-preflight',
  target: { ...FORMAL_CLEANUP_TARGET },
  counts: { ...PRE_CLEANUP_COUNTS },
  metrics: {
    usersBalanceTotal: -480,
    ledgerByType: structuredClone(PRE_CLEANUP_LEDGER_BY_TYPE)
  },
  digests: Object.fromEntries([
    'usersIdentity',
    'menuVersions',
    'menuItems',
    'announcements',
    'importBatches',
    'importQuarantine',
    'd1Migrations',
    'sqliteSequence',
    'internalTableInventory'
  ].map((name) => [name, 'a'.repeat(64)])),
  foreignKeys: { enabled: 1, violations: [] },
  protectedObjects: { cfKvPresent: true, sqliteSequencePresent: true }
};

const authorizedEnv = (hash = APPROVED_BACKUP_SHA256) => ({
  DB: { prepare() {}, batch() {} },
  MAINTENANCE_SESSION_TOKEN: 'session-token',
  CLEANUP_TARGET_NAME: FORMAL_CLEANUP_TARGET.name,
  CLEANUP_DATABASE_ID: FORMAL_CLEANUP_TARGET.databaseId,
  EXPECTED_BACKUP_SHA256: hash
});

test('remote adapter defaults to dry-run and keeps the formal target fixed', () => {
  assert.deepEqual(parseArguments([]), { dryRun: true });
  assert.deepEqual(parseArguments(['--execute']), { dryRun: false, execute: true });
  assert.throws(
    () => assertRemoteAdapterTarget({
      target: 'bento-poc',
      databaseId: FORMAL_CLEANUP_TARGET.databaseId,
      configuredTarget: FORMAL_CLEANUP_TARGET.name,
      configuredDatabaseId: FORMAL_CLEANUP_TARGET.databaseId
    }),
    (error) => error.code === 'CLEANUP_TARGET_INVALID'
  );
  assert.throws(
    () => assertRemoteDatabaseInfo({
      name: FORMAL_CLEANUP_TARGET.name,
      databaseId: 'wrong'
    }),
    (error) => error.code === 'REMOTE_D1_UUID_INVALID'
  );
});

test('remote config has the exact formal UUID and no public routes', () => {
  const config = assertRemoteConfig(configPath);
  assert.equal(config.name, FORMAL_CLEANUP_TARGET.name);
  assert.equal(config.databaseId, FORMAL_CLEANUP_TARGET.databaseId);
});

test('backup verification requires the exact approved SHA256', () => {
  const fixture = createBackup();
  try {
    assert.deepEqual(verifyBackupArtifact(fixture.path, fixture.hash, {
      approvedSha256: fixture.hash
    }), {
      path: fixture.path,
      size: backupSql.length,
      sha256: fixture.hash,
      sql: backupSql
    });
    assert.throws(
      () => verifyBackupArtifact(fixture.path, '0'.repeat(64), { approvedSha256: fixture.hash }),
      (error) => error.code === 'CLEANUP_BACKUP_HASH_INVALID'
    );
    assert.throws(
      () => verifyBackupArtifact(fixture.path, undefined, { approvedSha256: fixture.hash }),
      (error) => error.code === 'CLEANUP_BACKUP_HASH_REQUIRED'
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('remote Worker defaults to dry-run and execute requires explicit confirmation', async () => {
  const calls = [];
  const cleanup = async (...args) => {
    calls.push(args);
    return {
      kind: 'bento-formal-test-cleanup-preflight',
      mode: 'dry-run',
      target: { ...FORMAL_CLEANUP_TARGET },
      baselineProvided: true,
      baselineMatches: true,
      baselineMismatches: [],
      before: { counts: {}, metrics: {}, digests: {}, foreignKeys: {}, protectedObjects: {} }
    };
  };
  const fetch = createRemoteCleanupHandler({ cleanup });
  const env = authorizedEnv();
  const dryRun = await fetch(new Request(`http://127.0.0.1${REMOTE_CLEANUP_PATH}`, {
    method: 'POST',
    headers: {
      [REMOTE_CLEANUP_SESSION_HEADER]: env.MAINTENANCE_SESSION_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      expectedBackupSha256: env.EXPECTED_BACKUP_SHA256,
      baseline
    })
  }), env);
  assert.equal(dryRun.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].dryRun, true);
  assert.equal(calls[0][1].executionMode, 'remote');
  assert.equal(calls[0][1].remoteExecutionAuthorized, true);

  const executeWithoutConfirmation = await fetch(new Request(`http://127.0.0.1${REMOTE_CLEANUP_PATH}`, {
    method: 'POST',
    headers: {
      [REMOTE_CLEANUP_SESSION_HEADER]: env.MAINTENANCE_SESSION_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      mode: 'execute',
      expectedBackupSha256: env.EXPECTED_BACKUP_SHA256,
      baseline
    })
  }), env);
  assert.equal(executeWithoutConfirmation.status, 400);
  assert.equal(calls.length, 1);
});

test('remote Worker rejects wrong target, UUID, and backup hash before core', async () => {
  let calls = 0;
  const fetch = createRemoteCleanupHandler({
    cleanup: async () => {
      calls += 1;
      throw new Error('must not call core');
    }
  });
  const baseRequest = (env) => new Request(`http://127.0.0.1${REMOTE_CLEANUP_HEALTH_PATH}`, {
    headers: { [REMOTE_CLEANUP_SESSION_HEADER]: env.MAINTENANCE_SESSION_TOKEN }
  });
  const wrongTarget = authorizedEnv();
  wrongTarget.CLEANUP_TARGET_NAME = 'bento-poc';
  assert.equal((await fetch(baseRequest(wrongTarget), wrongTarget)).status, 409);
  const wrongUuid = authorizedEnv();
  wrongUuid.CLEANUP_DATABASE_ID = 'wrong';
  assert.equal((await fetch(baseRequest(wrongUuid), wrongUuid)).status, 409);
  const wrongHash = authorizedEnv();
  const request = new Request(`http://127.0.0.1${REMOTE_CLEANUP_PATH}`, {
    method: 'POST',
    headers: {
      [REMOTE_CLEANUP_SESSION_HEADER]: wrongHash.MAINTENANCE_SESSION_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ expectedBackupSha256: 'b'.repeat(64), baseline })
  });
  assert.equal((await fetch(request, wrongHash)).status, 409);
  assert.equal(calls, 0);
});

test('adapter fails closed on baseline and preserved-digest drift without execute', async () => {
  const fixture = createBackup();
  let invoked = 0;
  try {
    await assert.rejects(
      () => runRemoteAdapter({
        argv: {
          dryRun: true,
          backup: fixture.path,
          'expected-backup-sha256': fixture.hash
        },
        getRemoteInfo: async () => ({ ...FORMAL_CLEANUP_TARGET, databaseId: FORMAL_CLEANUP_TARGET.databaseId }),
        resolveBaseline: async () => baseline,
        approvedBackupSha256: fixture.hash,
        startWorker: async () => ({
          baseUrl: 'http://loopback',
          sessionToken: 'session',
          stopped: Promise.resolve({ code: 0 }),
          output: () => '',
          stop: async () => { invoked += 1; }
        }),
        fetchImpl: async (url) => ({
          ok: true,
          status: 200,
          async json() {
            if (url.endsWith(REMOTE_CLEANUP_HEALTH_PATH)) {
              return { success: true, target: { ...FORMAL_CLEANUP_TARGET } };
            }
            return {
              success: true,
              expectedBackupSha256: fixture.hash,
              result: {
                kind: 'bento-formal-test-cleanup-preflight',
                mode: 'dry-run',
                target: { ...FORMAL_CLEANUP_TARGET },
                baselineMatches: false,
                baselineMismatches: [{ field: 'digests.usersIdentity' }],
                before: {}
              }
            };
          }
        })
      }),
      (error) => error.code === 'CLEANUP_BASELINE_MISMATCH'
    );
    assert.equal(invoked, 1);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test('execute path hands the bounded Worker to cleanup core exactly once', async () => {
  let calls = 0;
  const database = { prepare() {}, batch() {} };
  const cleanup = async (database, options) => {
    calls += 1;
    assert.equal(database, env.DB);
    assert.equal(options.dryRun, false);
    assert.equal(options.confirmed, true);
    return { mode: 'execute', target: { ...FORMAL_CLEANUP_TARGET } };
  };
  const fetch = createRemoteCleanupHandler({ cleanup });
  const env = { ...authorizedEnv(), DB: database };
  const response = await fetch(new Request(`http://127.0.0.1${REMOTE_CLEANUP_PATH}`, {
    method: 'POST',
    headers: {
      [REMOTE_CLEANUP_SESSION_HEADER]: env.MAINTENANCE_SESSION_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      mode: 'execute',
      expectedBackupSha256: env.EXPECTED_BACKUP_SHA256,
      baseline,
      confirmation: 'CONFIRM_REMOTE_CLEANUP=YES'
    })
  }), env);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('adapter and maintenance entrypoint contain no second cleanup SQL definition', () => {
  const adapterSource = readFileSync(new URL('../scripts/remote-cleanup-formal.mjs', import.meta.url), 'utf8');
  const workerSource = readFileSync(new URL('../maintenance/remote-cleanup-worker.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(adapterSource, /DELETE\s+FROM/i);
  assert.doesNotMatch(workerSource, /DELETE\s+FROM/i);
});
