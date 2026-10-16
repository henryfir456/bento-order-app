const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('footprints exposes responsive period controls and the same ranked data at narrow and wide layouts', () => {
  const page = read('src/features/orders/MyBentoFootprintsPage.jsx');
  assert.match(page, /aria-label="我的便當足跡"/);
  assert.match(page, /aria-label="統計期間"/);
  assert.match(page, /onClick=\{\(\) => onPeriodChange\(value\)\}/);
  assert.match(page, /aria-pressed=\{period === value\}/);
  assert.match(page, /grid-cols-1 gap-3 sm:grid-cols-3/);
  assert.match(page, /sm:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.2fr\)\]/);
  assert.match(page, /data\.items \|\| \[\]/);
  assert.match(page, /role="img" aria-label=/);
});

test('statistics navigation and API support authorized read-only View As', () => {
  const app = read('src/App.jsx');
  const nav = read('src/components/BottomNavigation.jsx');
  const api = read('src/api/apiClientCore.js');
  const route = read('worker-poc/src/routes/readOnly.js');
  assert.match(app, /key === 'footprints'/);
  assert.match(nav, /label: '足跡'/);
  const methodStart = api.indexOf('getOrderStatistics:');
  const method = api.slice(methodStart, api.indexOf('getOrderPage:', methodStart));
  assert.match(method, /'\/api\/orders\/statistics'/);
  assert.match(method, /query: \{ period, viewAs: viewAsUserId \}/);
  assert.doesNotMatch(method, /targetUserId/);
  assert.match(route, /getOrderStatistics\(env\.DB, subject\.userId/);
  assert.match(app, /_subjectUserId/);
  assert.match(app, /footprintsRequestRef\.current \+= 1/);
});

test('footprints presents a zero-record empty state', () => {
  const page = read('src/features/orders/MyBentoFootprintsPage.jsx');
  assert.match(page, /!hasOrders/);
  assert.match(page, /這段期間還沒有可計入的便當紀錄/);
});

test('pie chart draws after render and respects reduced motion', () => {
  const page = read('src/features/orders/MyBentoFootprintsPage.jsx');
  assert.match(page, /footprints-pie-draw/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(page, /mask="url\\(#footprints-pie-mask\\)"/);
  assert.match(page, /isViewAsMode/);
});
