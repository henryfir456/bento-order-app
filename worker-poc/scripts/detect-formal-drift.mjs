// Read-only detector for formal Worker source and D1 migration drift.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(workerRoot, '..');
const workerName = 'bento-api-poc';
// This legacy Version predates workers/commit_sha annotations. The deployment
// ID/time were read from Cloudflare, and its main SHA was resolved from the
// linked GitHub deployment record; require both IDs to match before using it.
const LEGACY_DEPLOYMENT_SOURCE_BASELINES = Object.freeze({
  '76fb47f0-6e26-4cee-a29e-b43d7eb7b91c': Object.freeze({
    versionId: 'b86d02b8-ed29-4a6c-ad23-f2164b9407f6',
    sourceSha: '7beb6d68e5e0c2167653579c998c8cf2dddbaf6d'
  })
});
const migrationName = (name) => String(name || '').replace(/\.sql$/i, '');
const normalizeList = (values) => [...new Set((values || []).map(migrationName))].sort();

export const isFormalRuntimeFile = (file) => (
  /^worker-poc\/(src\/|migrations-formal\/|wrangler\.jsonc$|package\.json$|package-lock\.json$)/.test(file)
);

export const resolveDeployedSourceSha = ({ annotations = {}, deploymentId, versionId } = {}) => {
  const annotated = annotations['workers/commit_sha'] || annotations.commit_sha || annotations.source_sha;
  if (/^[a-f0-9]{40}$/i.test(String(annotated || ''))) return String(annotated);
  const baseline = LEGACY_DEPLOYMENT_SOURCE_BASELINES[deploymentId];
  return baseline?.versionId === versionId ? baseline.sourceSha : null;
};

export const compareFormalReleaseState = ({
  sourceSha,
  deployedSourceSha,
  changedFiles,
  expectedMigrations,
  appliedMigrations,
  deploymentId = null,
  versionId = null,
  extraBlockers = []
} = {}) => {
  const expected = normalizeList(expectedMigrations);
  const applied = normalizeList(appliedMigrations);
  const validSha = (value) => /^[a-f0-9]{40}$/i.test(String(value || ''));
  const runtimeChanges = (changedFiles || []).filter(isFormalRuntimeFile).sort();
  const workerReleaseRequired = runtimeChanges.length > 0;
  const missingMigrations = expected.filter((name) => !applied.includes(name));
  const unexpectedMigrations = applied.filter((name) => !expected.includes(name));
  const blockers = [...extraBlockers];
  if (!validSha(sourceSha)) blockers.push('CURRENT_SOURCE_SHA_UNAVAILABLE');
  if (!validSha(deployedSourceSha)) blockers.push('DEPLOYED_SOURCE_SHA_UNAVAILABLE');
  if (!Array.isArray(expectedMigrations) || !Array.isArray(appliedMigrations)) {
    blockers.push('MIGRATION_METADATA_UNAVAILABLE');
  }

  const workerStatus = blockers.includes('DEPLOYED_SOURCE_SHA_UNAVAILABLE')
    ? 'BLOCKED'
    : workerReleaseRequired && sourceSha !== deployedSourceSha
      ? 'RELEASE_REQUIRED'
      : 'NO_RUNTIME_CHANGE';
  const databaseStatus = blockers.includes('MIGRATION_METADATA_UNAVAILABLE')
    ? 'BLOCKED'
    : missingMigrations.length || unexpectedMigrations.length
      ? 'DRIFT'
      : 'IN_SYNC';
  const status = blockers.length
    ? 'BLOCKED'
    : workerStatus === 'RELEASE_REQUIRED' || databaseStatus === 'DRIFT'
      ? 'DRIFT'
      : 'IN_SYNC';
  const actions = [];
  if (databaseStatus === 'DRIFT') {
    actions.push('D1 migration state differs from current main; pass the approved backup and restore gate, then reconcile migrations sequentially before deploying the Worker.');
  }
  if (workerStatus === 'RELEASE_REQUIRED') {
    actions.push('Formal Worker changes are present on main; after the D1 gate passes, build and deploy the complete bundle directly with Wrangler or the Cloudflare API.');
  }
  if (blockers.length) {
    actions.push('Resolve the listed metadata blocker; do not infer production state from CI or a local build.');
  }
  if (!actions.length) actions.push('No formal Worker or D1 release drift detected.');

  return {
    status,
    sourceSha: validSha(sourceSha) ? sourceSha : null,
    worker: {
      status: workerStatus,
      deploymentId,
      versionId,
      deployedSourceSha: validSha(deployedSourceSha) ? deployedSourceSha : null,
      changedRuntimeFiles: runtimeChanges,
      releaseRequired: workerStatus === 'RELEASE_REQUIRED'
    },
    database: {
      status: databaseStatus,
      expectedLatestMigration: expected.at(-1) || null,
      appliedLatestMigration: applied.at(-1) || null,
      missingMigrations,
      unexpectedMigrations
    },
    blockers,
    actions
  };
};

export const assertFormalReleaseD1Ready = (report) => {
  if (report?.status === 'BLOCKED'
    || report?.worker?.status === 'BLOCKED'
    || report?.database?.status !== 'IN_SYNC') {
    throw new Error('BLOCKED: formal release requires verified source metadata and D1 migration state in sync');
  }
  return true;
};

const runGit = (args) => execFileSync('git', args, {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore']
}).trim();

const cloudflareJson = async (fetchImpl, base, token, path, init = {}) => {
  const response = await fetchImpl(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers
    }
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`CLOUDFLARE_INVALID_RESPONSE_${response.status}`); }
  if (!response.ok || payload?.success !== true) {
    throw new Error(`CLOUDFLARE_API_FAILED_${response.status}`);
  }
  return payload.result;
};

const migrationFiles = () => readdirSync(join(workerRoot, 'migrations-formal'))
  .filter((name) => name.endsWith('.sql'))
  .map(migrationName)
  .sort();

export const runFormalDrift = async ({ env = process.env, fetchImpl = globalThis.fetch } = {}) => {
  const branch = runGit(['branch', '--show-current']);
  const sourceSha = runGit(['rev-parse', 'HEAD']);
  const upstreamSha = runGit(['rev-parse', 'origin/main']);
  if (branch !== 'main' || runGit(['status', '--porcelain']) || sourceSha !== upstreamSha) {
    return {
      status: 'BLOCKED',
      sourceSha,
      blockers: ['CLEAN_UP_TO_DATE_ORIGIN_MAIN_REQUIRED'],
      actions: ['Run the detector from a clean local main that is already aligned with origin/main. No production state was queried.']
    };
  }
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    return {
      status: 'BLOCKED',
      sourceSha,
      blockers: ['READ_ONLY_CLOUDFLARE_CREDENTIALS_REQUIRED'],
      actions: ['Provide a read-only Cloudflare API token and account ID through the managed secret environment.']
    };
  }

  const config = JSON.parse(readFileSync(join(workerRoot, 'wrangler.jsonc'), 'utf8'));
  const databaseId = config.d1_databases?.find(({ binding }) => binding === 'DB')?.database_id;
  if (config.name !== workerName || !databaseId) throw new Error('FORMAL_WORKER_CONFIG_UNAVAILABLE');
  const base = 'https://api.cloudflare.com/client/v4';
  const scriptPath = `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${workerName}`;
  const deploymentsResult = await cloudflareJson(fetchImpl, base, token, `${scriptPath}/deployments`);
  const active = (deploymentsResult.deployments || []).find((deployment) => (
    (deployment.versions || []).some((version) => Number(version.percentage) === 100)
  ));
  const activeVersion = active?.versions?.find((version) => Number(version.percentage) === 100);
  if (!active?.id || !activeVersion?.version_id) throw new Error('ACTIVE_WORKER_DEPLOYMENT_METADATA_UNAVAILABLE');
  const version = await cloudflareJson(
    fetchImpl,
    base,
    token,
    `${scriptPath}/versions/${encodeURIComponent(activeVersion.version_id)}`
  );
  const annotations = version.annotations || version.metadata?.annotations || {};
  const deployedSourceSha = resolveDeployedSourceSha({
    annotations,
    deploymentId: active.id,
    versionId: activeVersion.version_id
  });

  const queryResult = await cloudflareJson(
    fetchImpl,
    base,
    token,
    `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    {
      method: 'POST',
      body: JSON.stringify({ sql: 'SELECT name FROM d1_migrations ORDER BY name', params: [] })
    }
  );
  const rows = Array.isArray(queryResult) ? queryResult[0]?.results : queryResult?.results;
  if (!Array.isArray(rows) || rows.some((row) => typeof row?.name !== 'string')) {
    throw new Error('D1_MIGRATION_METADATA_UNAVAILABLE');
  }
  let changedFiles = [];
  if (/^[a-f0-9]{40}$/i.test(String(deployedSourceSha || ''))) {
    try {
      changedFiles = runGit(['diff', '--name-only', `${deployedSourceSha}..${sourceSha}`])
        .split('\n')
        .filter(Boolean);
    } catch {
      return compareFormalReleaseState({
        sourceSha,
        deployedSourceSha,
        changedFiles,
        expectedMigrations: migrationFiles(),
        appliedMigrations: rows.map(({ name }) => name),
        deploymentId: active.id,
        versionId: activeVersion.version_id,
        extraBlockers: ['DEPLOYED_SOURCE_COMMIT_UNAVAILABLE']
      });
    }
  }
  return compareFormalReleaseState({
    sourceSha,
    deployedSourceSha,
    changedFiles,
    expectedMigrations: migrationFiles(),
    appliedMigrations: rows.map(({ name }) => name),
    deploymentId: active.id,
    versionId: activeVersion.version_id
  });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFormalDrift().then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'IN_SYNC') process.exitCode = 1;
  }).catch((error) => {
    // Deliberately print only the sanitized failure code, never request or auth data.
    console.error(JSON.stringify({
      status: 'BLOCKED',
      blockers: [String(error?.message || 'FORMAL_DRIFT_CHECK_FAILED').replace(/[^A-Z0-9_:-]/gi, '_').slice(0, 96)],
      actions: ['Resolve the read-only metadata query failure before claiming formal release status.']
    }, null, 2));
    process.exitCode = 1;
  });
}
