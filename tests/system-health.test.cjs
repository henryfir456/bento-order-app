const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('./helpers/app-source.cjs').readAppSource();
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

async function load() { return import('../scripts/generate-dependency-health.mjs'); }

test('buildHealth marks vulnerable, outdated and ok packages', async () => {
  const { buildHealth } = await load();
  const h = buildHealth({
    keyPackages: ['a', 'b', 'c'],
    installed: { a: '1.0.0', b: '2.0.0', c: '3.0.0' },
    outdated: { b: { latest: '2.1.0' } },
    audit: { vulnerabilities: {
      a: { severity: 'high', via: [{ title: 'Bad', url: 'https://x', severity: 'high' }, 'dep'] },
      z: { severity: 'low', via: [] }
    } }
  });
  assert.deepEqual(h.packages.map((p) => p.status), ['vulnerable', 'outdated', 'ok']);
  assert.equal(h.packages[0].advisories.length, 1);
  assert.equal(h.overall, 'vulnerable');
  assert.deepEqual(h.otherVulnerable.map((v) => v.name), ['z']);
});

test('buildHealth is ok only when nothing is vulnerable or outdated', async () => {
  const { buildHealth } = await load();
  const h = buildHealth({ keyPackages: ['a'], installed: { a: '1.0.0' }, outdated: {}, audit: { vulnerabilities: {} } });
  assert.equal(h.overall, 'ok');
});

test('system health is Admin-only, outside View As, with a dot only for yellow or red', () => {
  assert.match(app, /showSystemHealth=\{authRole === 'Admin' && !isViewAsMode\}/);
  assert.match(app, /adminSection === 'systemHealth' && authRole === 'Admin' && !isViewAsMode/);
  assert.match(app, /section === 'systemHealth'[\s\S]{0,80}authRole !== 'Admin'/);
  const sh = read('src/features/admin/SystemHealth.jsx');
  assert.match(sh, /health\.overall !== 'ok'/);
  assert.match(read('src/features/admin/AdminHub.jsx'), /系統健康 ›/);
});

test('summary is generated before build, git-ignored, and adds no API or migration', () => {
  assert.equal(JSON.parse(read('package.json')).scripts.prebuild, 'node scripts/generate-dependency-health.mjs');
  assert.match(read('.gitignore'), /src\/generated\//);
  assert.doesNotMatch(read('src/features/admin/SystemHealth.jsx'), /fetch\(|apiClient/);
});
