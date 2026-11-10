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
    latestMap: { a: '1.0.0', b: '2.1.0', c: '3.0.0' },
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
  const h = buildHealth({ keyPackages: ['a'], installed: { a: '1.0.0' }, latestMap: { a: '1.0.0' }, audit: { vulnerabilities: {} } });
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

test('a failed latest-version lookup is unknown, never green', async () => {
  const { buildHealth } = await load();
  const h = buildHealth({ keyPackages: ['a'], installed: { a: '1.0.0' }, latestMap: {}, audit: { vulnerabilities: {} } });
  assert.equal(h.packages[0].status, 'unknown');
  assert.equal(h.overall, 'outdated');
});

test('summary is generated before build, git-ignored, and adds no API or migration', () => {
  assert.match(read('vite.config.js'), /generate\(root\)/);
  assert.match(read('vite.config.js'), /data\.status !== 'ready'/);
  assert.equal(JSON.parse(read('package.json')).scripts['health:generate'], 'node scripts/generate-dependency-health.mjs');
  assert.match(read('.gitignore'), /src\/generated\//);
  assert.doesNotMatch(read('src/features/admin/SystemHealth.jsx'), /fetch\(|apiClient/);
});

test('dev-start.ps1 syncs dependencies and refreshes the summary before starting Vite', () => {
  const ps = read('dev-start.ps1');
  const install = ps.indexOf('npm install --no-audit --no-fund');
  const health = ps.indexOf('npm run health:generate');
  const vite = ps.indexOf('Start-Process powershell.exe');
  assert.ok(install > 0 && health > install && vite > health);
});
