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
  const methodStart = api.lastIndexOf('getOrderStatistics:');
  const method = api.slice(methodStart, api.indexOf('getOrderPage:', methodStart));
  assert.match(method, /'\/api\/orders\/statistics'/);
  assert.match(method, /query: \{ period, viewAs: viewAsUserId \}/);
  assert.doesNotMatch(method, /targetUserId/);
  assert.match(route, /getOrderStatistics\(env\.DB, subject\.userId/);
  assert.match(app, /_subjectUserId/);
  assert.match(app, /footprintsRequestRef\.current \+= 1/);
});

test('mock footprints load synthetic statistics without requiring Worker transport', async () => {
  const app = read('src/App.jsx');
  const methodStart = app.indexOf('const refreshBentoFootprints = async');
  const methodEnd = app.indexOf('\n  useEffect', methodStart);
  const refreshMethod = app.slice(methodStart, methodEnd);
  assert.doesNotMatch(refreshMethod, /apiClient\.transport/);
  assert.match(refreshMethod, /apiClient\.getOrderStatistics\(/);

  const { createApiClient } = await import('../src/api/apiClientCore.js');
  const { createMockGasApi } = await import('../src/api/mockGasApi.js');
  const api = createApiClient({
    env: { DEV: true, VITE_AUTH_MODE: 'mock' },
    authClient: { isMock: true, getAccessToken: () => 'local-mock-session' },
    gasApi: createMockGasApi({ mockUser: 'admin' })
  });
  const statistics = await (await api.getOrderStatistics({ period: 'all' })).json();
  assert.equal(statistics.success, true);
  assert.deepEqual(
    [statistics.totalPortions, statistics.totalOrderDays, statistics.totalMealTypes],
    [7, 2, 3]
  );
});

test('footprints presents a zero-record empty state', () => {
  const page = read('src/features/orders/MyBentoFootprintsPage.jsx');
  assert.match(page, /!hasOrders/);
  assert.match(page, /這段期間還沒有可計入的便當紀錄/);
});

test('vendor donut chart shows the center total and respects reduced motion', () => {
  const page = read('src/features/orders/MyBentoFootprintsPage.jsx');
  assert.match(page, /footprints-pie-draw/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.ok(page.includes('mask="url(#footprints-pie-mask)"'));
  assert.match(page, /店家份數甜甜圈圖/);
  assert.match(page, /data-chart-total/);
  assert.match(page, /aria-label="店家份數明細"/);
  assert.match(page, /aria-hidden="true" className="ml-5 h-1\.5/);
  assert.match(page, /isViewAsMode/);
});
