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

test('statistics navigation and API remain authenticated and expose no identity input', () => {
  const app = read('src/App.jsx');
  const nav = read('src/components/BottomNavigation.jsx');
  const api = read('src/api/apiClientCore.js');
  const route = read('worker-poc/src/routes/readOnly.js');
  assert.match(app, /key === 'footprints'/);
  assert.match(nav, /label: '足跡'/);
  const methodStart = api.indexOf('getOrderStatistics:');
  const method = api.slice(methodStart, api.indexOf('getOrderPage:', methodStart));
  assert.match(method, /'\/api\/orders\/statistics'/);
  assert.match(method, /query: \{ period \}/);
  assert.doesNotMatch(method, /userId|targetUserId|viewAs/);
  assert.match(route, /getOrderStatistics\(env\.DB, identity\.authorizationActor\.userId/);
});
