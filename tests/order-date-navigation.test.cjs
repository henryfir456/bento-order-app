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

test('0.15.9 is the current formal release', () => {
  const changelog = read('CHANGELOG.md');
  const pkg = JSON.parse(read('package.json'));
  const ui = read('src/data/changelog.js');

  assert.match(changelog, /## \[0\.15\.9\] - 2026-10-04/);
  assert.equal(pkg.version, '0.15.9');
  assert.match(ui, /'0\.15\.9'/);
});
