import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  assertPocTargetIsLocalOnly
} from '../scripts/poc-target-guard.mjs';
import { renderSummary } from '../scripts/benchmark-report.mjs';

const readJson = (name) => JSON.parse(fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
const formalConfig = readJson('wrangler.jsonc');
const pocConfig = readJson('wrangler-poc.jsonc');
const packageConfig = readJson('package.json');
const seedScript = fs.readFileSync(new URL('../scripts/seed-parity-poc.mjs', import.meta.url), 'utf8');
const benchmarkScript = fs.readFileSync(new URL('../scripts/benchmark-bootstrap.mjs', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const formalPlan = fs.readFileSync(new URL('../../docs/superpowers/plans/2026-09-08-formal-worker-d1-backend.md', import.meta.url), 'utf8');
const formalSpec = fs.readFileSync(new URL('../../docs/superpowers/specs/2026-09-08-formal-worker-d1-backend-design.md', import.meta.url), 'utf8');

const formalD1 = formalConfig.d1_databases?.find((binding) => binding.binding === 'DB');
const pocD1 = pocConfig.d1_databases?.find((binding) => binding.binding === 'DB');

test('default Wrangler runtime and D1 migration directory are formal', () => {
  assert.equal(formalConfig.main, 'src/formalWorker.js');
  assert.equal(formalD1?.binding, 'DB');
  assert.equal(formalD1?.database_name, 'bento-formal');
  assert.equal(formalD1?.migrations_dir, 'migrations-formal');
  assert.match(packageConfig.scripts['db:info'], /\bbento-formal\b/);
  assert.match(packageConfig.scripts['db:migrations:local'], /\bbento-formal\b/);
  assert.match(packageConfig.scripts['db:migrations:remote'], /\bbento-formal\b/);
  assert.doesNotMatch(packageConfig.scripts['db:migrations:remote'], /\bbento-poc\b/);
  assert.deepEqual(
    fs.readdirSync(new URL('../migrations-formal/', import.meta.url))
      .filter((name) => name.endsWith('.sql'))
      .sort(),
    [
      '0000_formal_initial_schema.sql',
      '0001_balance_integrity_primitives.sql',
      '0002_canonical_identity_rekey.sql',
      '0003_provisional_employee_identity.sql'
    ]
  );
});

test('legacy POC runtime is local-only and available only through explicit commands', () => {
  assert.notEqual(pocConfig.name, formalConfig.name);
  assert.equal(pocConfig.main, 'src/index.js');
  assert.equal(pocD1?.binding, 'DB');
  assert.equal(pocD1?.database_name, 'bento-poc-legacy-local');
  assert.equal(pocD1?.database_id, undefined);
  assert.equal(pocD1?.migrations_dir, 'migrations');
  assert.match(packageConfig.scripts['dev:poc'], /--config\s+wrangler-poc\.jsonc/);
  assert.match(packageConfig.scripts['db:migrations:poc:local'], /--config\s+wrangler-poc\.jsonc/);
  assert.doesNotMatch(packageConfig.scripts.dev, /wrangler-poc\.jsonc/);
  assert.doesNotMatch(packageConfig.scripts.deploy, /wrangler-poc\.jsonc/);
  assert.match(packageConfig.scripts['benchmark:poc'], /benchmark-bootstrap\.mjs/);
  assert.equal(packageConfig.scripts.benchmark, undefined);
  assert.match(benchmarkScript, /POC_WORKER_BOOTSTRAP_URL/);
  assert.match(benchmarkScript, /legacy-poc-bootstrap-parity/);
  assert.match(readme, /Legacy POC serial primary benchmark/);
  assert.match(readme, /POC_WORKER_BOOTSTRAP_URL/);
  assert.match(formalPlan, /Wave 6 real-workbook validation is complete/);
  assert.doesNotMatch(formalPlan, /Wave 6 real-workbook review remains pending/);

  const requiredStatuses = [
    '| Real LIFF authentication | NOT VERIFIED |',
    '| Cloudflare-backed non-production D1 | NOT VERIFIED |',
    '| View As and actor/effective-subject separation | NOT VERIFIED |',
    '| Production GAS contract | NOT VERIFIED |',
    '| Production Worker deployment | NOT RUN |',
    '| React cutover | NOT RUN |'
  ];
  for (const status of requiredStatuses) {
    assert.ok(formalPlan.includes(status) || formalSpec.includes(status), status);
  }
});

test('POC target guard rejects formal Worker or D1 identity collisions', () => {
  const target = assertPocTargetIsLocalOnly();
  assert.equal(target.pocWorkerName, 'bento-api-poc-legacy');
  assert.equal(target.pocDatabaseName, 'bento-poc-legacy-local');
  assert.ok(seedScript.indexOf('assertPocRemoteOperationBlocked();') < seedScript.indexOf('const result = spawnSync'));
  assert.doesNotMatch(seedScript, /['"]bento-poc['"]/);
  assert.doesNotMatch(seedScript, new RegExp(formalD1.database_id, 'i'));

  assert.throws(() => assertPocTargetIsLocalOnly({
    formalConfig,
    pocConfig: { ...pocConfig, name: formalConfig.name }
  }), /Worker name must differ/);

  assert.throws(() => assertPocTargetIsLocalOnly({
    formalConfig,
    pocConfig: {
      ...pocConfig,
      d1_databases: [{ ...pocD1, database_id: formalD1.database_id }]
    }
  }), /database ID matches/);
});

test('legacy POC remote seed fails before any Wrangler process can start', () => {
  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/seed-parity-poc.mjs');
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    encoding: 'utf8',
    shell: false
  });

  assert.equal(result.status, 1);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /Refusing remote POC operation/);
  assert.doesNotMatch(output, /Missing required environment variable/);
});

test('legacy POC benchmark reports never use a generic Worker label', () => {
  const sample = { elapsedMs: 1, payloadBytes: 2, status: 200, ok: true };
  const report = renderSummary({
    benchmark: 'legacy-poc-bootstrap-parity',
    samples: {
      GAS: { cold: [sample], warm: [sample] },
      Worker: { cold: [sample], warm: [sample] }
    }
  });
  assert.match(report, /Benchmark: legacy-poc-bootstrap-parity/);
  assert.match(report, /Legacy POC Worker \+ D1/);
  assert.match(report, /Warm samples: GAS 1, Legacy POC Worker 1/);
  assert.doesNotMatch(report, /\| Worker \+ D1 \|/);
});
