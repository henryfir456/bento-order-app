import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertFormalReleaseD1Ready,
  compareFormalReleaseState,
  isFormalRuntimeFile,
  resolveDeployedSourceSha
} from '../scripts/detect-formal-drift.mjs';

const sourceSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const deployedSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('formal release classifier requires a release for Worker, D1, config, and dependency changes', () => {
  for (const file of [
    'worker-poc/src/domain/ordersRead.js',
    'worker-poc/migrations-formal/0020_example.sql',
    'worker-poc/wrangler.jsonc',
    'worker-poc/package.json',
    'worker-poc/package-lock.json'
  ]) assert.equal(isFormalRuntimeFile(file), true, file);
  assert.equal(isFormalRuntimeFile('src/App.jsx'), false);
  assert.equal(isFormalRuntimeFile('worker-poc/tests/formal-drift.test.js'), false);
  assert.equal(isFormalRuntimeFile('worker-poc/scripts/detect-formal-drift.mjs'), false);
});

test('formal drift report blocks Worker deployment when D1 migration state is behind', () => {
  const report = compareFormalReleaseState({
    sourceSha,
    deployedSourceSha: deployedSha,
    changedFiles: ['worker-poc/src/domain/ordersRead.js', 'worker-poc/migrations-formal/0019_vendor_order_settlements.sql'],
    expectedMigrations: ['0018_vendor_principals_and_memberships', '0019_vendor_order_settlements.sql'],
    appliedMigrations: ['0018_vendor_principals_and_memberships'],
    deploymentId: 'synthetic-deployment',
    versionId: 'synthetic-version'
  });

  assert.equal(report.status, 'DRIFT');
  assert.equal(report.worker.status, 'RELEASE_REQUIRED');
  assert.equal(report.worker.releaseRequired, true);
  assert.equal(report.database.status, 'DRIFT');
  assert.deepEqual(report.database.missingMigrations, ['0019_vendor_order_settlements']);
  assert.ok(report.actions.some((action) => action.includes('backup and restore gate')));
  assert.ok(report.actions.some((action) => action.includes('directly with Wrangler')));
});

test('formal drift report does not request Worker release for frontend-only source changes', () => {
  const report = compareFormalReleaseState({
    sourceSha,
    deployedSourceSha: deployedSha,
    changedFiles: ['src/App.jsx', 'src/api/apiErrors.js'],
    expectedMigrations: ['0018_vendor_principals_and_memberships'],
    appliedMigrations: ['0018_vendor_principals_and_memberships'],
    deploymentId: 'synthetic-deployment',
    versionId: 'synthetic-version'
  });

  assert.equal(report.status, 'IN_SYNC');
  assert.equal(report.worker.status, 'NO_RUNTIME_CHANGE');
  assert.equal(report.worker.releaseRequired, false);
  assert.equal(report.database.status, 'IN_SYNC');
});

test('formal drift report fails closed when deployment source SHA metadata is missing', () => {
  const report = compareFormalReleaseState({
    sourceSha,
    deployedSourceSha: null,
    changedFiles: ['worker-poc/src/formalWorker.js'],
    expectedMigrations: ['0019_vendor_order_settlements'],
    appliedMigrations: ['0019_vendor_order_settlements']
  });

  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.worker.status, 'BLOCKED');
  assert.deepEqual(report.blockers, ['DEPLOYED_SOURCE_SHA_UNAVAILABLE']);
  assert.equal(report.worker.releaseRequired, false);
});

test('formal drift report detects unexpected production migrations instead of hiding drift', () => {
  const report = compareFormalReleaseState({
    sourceSha,
    deployedSourceSha: sourceSha,
    changedFiles: [],
    expectedMigrations: ['0019_vendor_order_settlements'],
    appliedMigrations: ['0018_unexpected', '0019_vendor_order_settlements']
  });

  assert.equal(report.status, 'DRIFT');
  assert.deepEqual(report.database.unexpectedMigrations, ['0018_unexpected']);
});

test('formal release refuses to deploy when source metadata or D1 migration state is blocked', () => {
  assert.doesNotThrow(() => assertFormalReleaseD1Ready({
    status: 'DRIFT',
    worker: { status: 'RELEASE_REQUIRED' },
    database: { status: 'IN_SYNC' }
  }));
  assert.throws(() => assertFormalReleaseD1Ready({
    status: 'DRIFT',
    worker: { status: 'RELEASE_REQUIRED' },
    database: { status: 'DRIFT' }
  }), /BLOCKED/);
  assert.throws(() => assertFormalReleaseD1Ready({
    status: 'BLOCKED',
    worker: { status: 'BLOCKED' },
    database: { status: 'IN_SYNC' }
  }), /BLOCKED/);
});

test('legacy deployment source mapping requires the exact verified deployment and version IDs', () => {
  const resolved = resolveDeployedSourceSha({
    annotations: { 'workers/alias': 'main' },
    deploymentId: '76fb47f0-6e26-4cee-a29e-b43d7eb7b91c',
    versionId: 'b86d02b8-ed29-4a6c-ad23-f2164b9407f6'
  });
  assert.match(resolved || '', /^[a-f0-9]{40}$/i);
  assert.equal(resolveDeployedSourceSha({
    annotations: {},
    deploymentId: '76fb47f0-6e26-4cee-a29e-b43d7eb7b91c',
    versionId: 'different-version'
  }), null);
  assert.equal(resolveDeployedSourceSha({
    annotations: { 'workers/commit_sha': sourceSha },
    deploymentId: 'other-deployment',
    versionId: 'other-version'
  }), sourceSha);
});
