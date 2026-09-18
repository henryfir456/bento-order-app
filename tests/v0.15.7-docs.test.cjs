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

  assert.equal(packageJson.version, '0.15.7');
  assert.equal(packageLock.version, '0.15.7');
  assert.equal(packageLock.packages[''].version, '0.15.7');
  assert.match(changelog, /^## \[0\.15\.7\] - 2026-09-18/m);
  assert.match(changelogSource, /'0\.15\.7': \[/);
  assert.match(readme, /Built for Real-World Lunch Operations/);
  assert.match(readme, /docs\/screenshots\/calendar\.webp/);
  assert.match(readme, /docs\/screenshots\/order-page\.webp/);
  assert.match(readme, /docs\/screenshots\/order-management\.webp/);
});
