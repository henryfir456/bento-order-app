const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('order page exposes previous and next configured-date navigation', () => {
  const app = read('src/App.jsx');
  const orderPage = read('src/features/orders/OrderPage.jsx');

  assert.match(app, /const orderNavigationDates = useMemo/);
  assert.match(app, /event\?\.vendor/);
  assert.match(app, /previousOrderDate/);
  assert.match(app, /nextOrderDate/);
  assert.match(app, /onPreviousDate=\{\(\) => previousOrderDate && handleSelectDate\(previousOrderDate\)\}/);
  assert.match(app, /onNextDate=\{\(\) => nextOrderDate && handleSelectDate\(nextOrderDate\)\}/);

  assert.match(orderPage, /aria-label=\{previousDate \?/);
  assert.match(orderPage, /aria-label=\{nextDate \?/);
  assert.match(orderPage, /disabled=\{!previousDate\}/);
  assert.match(orderPage, /disabled=\{!nextDate\}/);
});

test('current formal release is consistent and preserves the 0.15.11 entry', () => {
  const changelog = read('CHANGELOG.md');
  const pkg = JSON.parse(read('package.json'));
  const ui = read('src/data/changelog.js');

  assert.match(changelog, /## \[0\.15\.11\] - 2026-10-05/);
  const latestRelease = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
  assert.ok(latestRelease);
  assert.equal(pkg.version, latestRelease);
  assert.match(ui, /'0\.15\.11'/);
});


test('calendar shows daily flavor names only when useful for Cai Teacher decisions', () => {
  const app = read('src/App.jsx');
  const orderPage = read('src/features/orders/OrderPage.jsx');

  assert.doesNotMatch(orderPage, />預訂日期</);
  assert.match(app, /event\?\.dailyFlavorName/);
  assert.match(app, /!hasVendor \|\| normalizeVendorName\(event\.vendor\) === '蔡老師'/);
  assert.match(app, /title=\{event\.dailyFlavorName\}/);
  assert.match(app, /\{event\.dailyFlavorName\}/);
});
