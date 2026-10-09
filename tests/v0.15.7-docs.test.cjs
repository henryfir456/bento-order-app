const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('v0.15.7 release metadata and README showcase stay in sync', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  const changelog = read('CHANGELOG.md');
  const changelogSource = read('src/data/changelog.js');
  const readme = read('README.md');

  const latestRelease = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
  assert.ok(latestRelease);
  assert.equal(packageJson.version, latestRelease);
  assert.equal(packageLock.version, latestRelease);
  assert.equal(packageLock.packages[''].version, latestRelease);
  assert.match(changelog, /^## \[0\.15\.8\] - 2026-10-03/m);
  assert.match(changelogSource, /'0\.15\.8': \[/);
  assert.match(readme, /Built for Real-World Lunch Operations/);
  assert.match(readme, /docs\/screenshots\/calendar\.webp/);
  assert.match(readme, /docs\/screenshots\/order-page\.webp/);
  assert.match(readme, /docs\/screenshots\/order-management\.webp/);
});
