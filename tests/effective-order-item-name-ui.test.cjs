const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('admin order summary tabs render resolved identity with vendor and variant separation', () => {
  const grouping = read('src/features/admin/orderSummary.js');
  const summary = read('src/features/admin/AdminOrderSummary.jsx');
  assert.match(grouping, /item_identity_key/);
  assert.match(grouping, /item_vendor/);
  assert.match(grouping, /item_variant_key/);
  assert.match(summary, /itemName/);
  assert.match(summary, /identityKey/);
  assert.match(summary, /vendor/);
  assert.match(summary, /variantKey/);
  for (const tabName of ['明細', '樓層數', '總數']) assert.ok(grouping.includes(tabName));
});

test('order summary frontend keeps same-name rows separate by identity across floor and total tabs', async () => {
  const { aggregateOrdersByFloor, aggregateOrdersByItem } = await import('../src/features/admin/orderSummary.js');
  const orders = [
    { item_name: '合成餐點', item_identity_key: 'identity-store-a-standard', item_vendor: '合成店家甲', item_variant_key: 'STANDARD', pickup_floor: '1樓', quantity: 1 },
    { item_name: '合成餐點', item_identity_key: 'identity-store-a-plus', item_vendor: '合成店家甲', item_variant_key: 'PLUS', pickup_floor: '1樓', quantity: 2 },
    { item_name: '合成餐點', item_identity_key: 'identity-store-b-standard', item_vendor: '合成店家乙', item_variant_key: 'STANDARD', pickup_floor: '1樓', quantity: 1 }
  ];
  const floorItems = aggregateOrdersByFloor(orders)[0].items;
  const totalItems = aggregateOrdersByItem(orders);
  assert.equal(floorItems.length, 3);
  assert.equal(totalItems.length, 3);
  assert.equal(floorItems.reduce((sum, item) => sum + item.quantity, 0), 4);
  assert.equal(totalItems.reduce((sum, item) => sum + item.quantity, 0), 4);
});

test('footprints show the resolver identity label and preserve keys for same-name meals from distinct sources', () => {
  const page = read('src/features/orders/MyBentoFootprintsPage.jsx');
  assert.match(page, /item\.identityKey \|\|/);
  assert.match(page, /item\.vendor/);
  assert.match(page, /item\.variantKey/);
});

test('order summary and statistics share the Worker effective-name resolver', () => {
  const summary = read('worker-poc/src/domain/adminSummary.js');
  const statistics = read('worker-poc/src/domain/ordersRead.js');
  const resolver = read('worker-poc/src/domain/effectiveOrderItemNames.js');
  assert.match(summary, /createEffectiveOrderItemNameResolver/);
  assert.match(statistics, /createEffectiveOrderItemNameResolver/);
  assert.match(resolver, /EFFECTIVE_ORDER_ITEM_NAME_ALIASES/);
});

test('order summary preserves snapshot item_name and renders display_item_name in all tabs', async () => {
  const grouping = read('src/features/admin/orderSummary.js');
  const summaryView = read('src/features/admin/AdminOrderSummary.jsx');
  const workerSummary = read('worker-poc/src/domain/adminSummary.js');
  assert.match(workerSummary, /item_name: row\.item_name_snapshot/);
  assert.match(workerSummary, /display_item_name: effectiveItem\.itemName/);
  assert.match(grouping, /display_item_name/);
  assert.match(summaryView, /display_item_name/);

  const { aggregateOrdersByFloor, aggregateOrdersByItem } = await import('../src/features/admin/orderSummary.js');
  const orders = [
    { item_name: '舊合成快照', display_item_name: '統一合成餐點', item_identity_key: 'stable-synthetic-item', item_vendor: '合成店家', item_variant_key: 'BASE', pickup_floor: '1樓', quantity: 1 },
    { item_name: '新合成快照', display_item_name: '統一合成餐點', item_identity_key: 'stable-synthetic-item', item_vendor: '合成店家', item_variant_key: 'BASE', pickup_floor: '1樓', quantity: 2 }
  ];
  assert.equal(aggregateOrdersByFloor(orders)[0].items[0].itemName, '統一合成餐點');
  assert.equal(aggregateOrdersByItem(orders)[0].itemName, '統一合成餐點');
});

test('local mock exposes resolved #103 summary rows and merged #108 alias statistics', async () => {
  const { createApiClient } = await import('../src/api/apiClientCore.js');
  const { createMockGasApi } = await import('../src/api/mockGasApi.js');
  const authClient = { isMock: true, getAccessToken: () => 'local-mock-session' };
  const api = createApiClient({
    env: { DEV: true, VITE_AUTH_MODE: 'mock' },
    authClient,
    gasApi: createMockGasApi({ mockUser: 'admin' })
  });

  const summary = await (await api.getAdminSummary({ targetDate: '2026-10-19' })).json();
  assert.equal(summary.success, true);
  assert.ok(summary.todayOrders.some((order) => order.item_name === '風味餐'
    && order.display_item_name === 'E.風味餐'));
  const displayNames = new Set(summary.todayOrders.map((order) => order.display_item_name));
  assert.ok(displayNames.has('S.小而美'));
  assert.ok(displayNames.has('C.特餐(半飯)'));

  const statisticsResponse = await api.getOrderStatistics({ period: 'all' });
  const statistics = await statisticsResponse.json();
  assert.equal(statistics.success, true);
  assert.equal(statistics.totalMealTypes, 3);
  assert.equal(statistics.totalPortions, 7);
  assert.equal(statistics.items.find((item) => item.name === 'C.特餐').portions, 3);
  assert.equal(statistics.items.find((item) => item.name === '蕃茄鷹豆泥').portions, 3);
  assert.equal(statistics.items.find((item) => item.name === 'A.風味便當').portions, 1);
});
