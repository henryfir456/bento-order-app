// Guards the LIFF SDK security upgrade: one npm-installed version (>= 2.31.2),
// no CDN copy of the SDK, and no Service Worker that could keep serving an old bundle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const MIN = [2, 31, 2];
const cmp = (v) => v.split('.').map(Number).reduce((r, n, i) => r || n - MIN[i], 0);

test('package.json requires @line/liff >= 2.31.2', () => {
  const range = JSON.parse(read('package.json')).dependencies['@line/liff'];
  assert.ok(cmp(range.replace(/^[\^~]/, '')) >= 0, `got ${range}`);
});

test('lockfile has a single LIFF SDK version, 2.31.2 or newer', () => {
  const packages = JSON.parse(read('package-lock.json')).packages;
  const entries = Object.entries(packages).filter(([k]) => k.startsWith('node_modules/@liff/') || k === 'node_modules/@line/liff');
  assert.ok(entries.length > 0);
  const versions = new Set(entries.map(([, v]) => v.version));
  assert.equal(versions.size, 1, `mixed LIFF versions: ${[...versions].join(', ')}`);
  assert.ok(cmp([...versions][0]) >= 0);
});

test('LIFF SDK is bundled from npm: no CDN script and no Service Worker', () => {
  assert.doesNotMatch(read('index.html'), /static\.line-scdn\.net|sdk\.js/);
  const src = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? src(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  for (const f of src('src').filter((p) => /\.(js|jsx)$/.test(p))) {
    assert.doesNotMatch(read(f), /serviceWorker\.register|static\.line-scdn\.net/, f);
  }
  assert.ok(!fs.existsSync(path.join(root, 'public/sw.js')));
});
