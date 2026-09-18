const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('order management tabs use the requested order', async () => {
  const { ORDER_SUMMARY_TABS } = await import('../src/features/admin/orderSummary.js');

  assert.deepEqual(ORDER_SUMMARY_TABS.map(({ label }) => label), [
    '明細',
    '樓層數',
    '總數'
  ]);
});

test('order management starts on the detail tab', () => {
  const summary = read('src/features/admin/AdminOrderSummary.jsx');

  assert.match(summary, /const \[activeTab, setActiveTab\] = useState\('detail'\)/);
  assert.match(summary, /activeTab === 'detail'/);
});

test('detail view groups by floor and keeps person, item, quantity, and price fields', () => {
  const summary = read('src/features/admin/AdminOrderSummary.jsx');
  const detailView = summary.match(/\{activeTab === 'detail'[\s\S]*?\n\s+\)\}/)?.[0] || '';

  assert.match(detailView, /groupOrdersByFloor\(adminSummary\.todayOrders\)/);
  assert.match(detailView, /\{o\.name\}/);
  assert.match(detailView, /\{o\.item_name\}/);
  assert.match(detailView, /\{o\.quantity\}/);
  assert.match(detailView, /formatSignedAmount\(o\.subtotal\)/);
});

test('floor-count view aggregates each floor by item without rendering people', () => {
  const summary = read('src/features/admin/AdminOrderSummary.jsx');
  const floorCountView = summary.match(/\{activeTab === 'floorCount'[\s\S]*?\n\s+\)\}/)?.[0] || '';

  assert.match(floorCountView, /aggregatedOrders\.map/);
  assert.match(floorCountView, /\{floor\} 訂單/);
  assert.match(floorCountView, /\{itemName\}/);
  assert.match(floorCountView, /\{quantity\}/);
  assert.doesNotMatch(floorCountView, /o\.name|o\.item_name|o\.subtotal/);
});

test('total-count view merges all floors by item and renders the total quantity', async () => {
  const summary = read('src/features/admin/AdminOrderSummary.jsx');
  const totalCountView = summary.match(/\{activeTab === 'totalCount'[\s\S]*?\n\s+\)\}/)?.[0] || '';
  const { aggregateOrdersByFloor, aggregateOrdersByItem } = await import('../src/features/admin/orderSummary.js');
  const orders = [
    { pickup_floor: '1樓', item_name: '番茄鷹豆泥', quantity: 1 },
    { pickup_floor: '9樓', item_name: '番茄鷹豆泥', quantity: 2 },
    { pickup_floor: '9樓', item_name: '紅麴豆腐', quantity: 1 }
  ];

  assert.deepEqual(aggregateOrdersByFloor(orders), [
    { floor: '1樓', items: [{ itemName: '番茄鷹豆泥', quantity: 1 }] },
    { floor: '9樓', items: [{ itemName: '番茄鷹豆泥', quantity: 2 }, { itemName: '紅麴豆腐', quantity: 1 }] }
  ]);
  assert.deepEqual(aggregateOrdersByItem(orders), [
    { itemName: '番茄鷹豆泥', quantity: 3 },
    { itemName: '紅麴豆腐', quantity: 1 }
  ]);
  assert.match(totalCountView, /totalOrdersByItem\.map/);
  assert.match(totalCountView, /\{itemName\}/);
  assert.match(totalCountView, /\{quantity\}/);
  assert.match(totalCountView, /總計 \{totalItemCount\} 份/);
  assert.doesNotMatch(totalCountView, /floor|o\.name|o\.item_name/);
});

test('tab content removes duplicate per-view headings', () => {
  const summary = read('src/features/admin/AdminOrderSummary.jsx');

  assert.doesNotMatch(summary, /訂單明細/);
  assert.doesNotMatch(summary, /便購種類匯總/);
});

test('Taipei top-up note formatting uses an unpadded M/D label', async () => {
  const { formatTaipeiTopupNote } = await import('../src/dateUtils.js');

  assert.equal(formatTaipeiTopupNote(new Date('2026-09-16T16:30:00.000Z')), '9/17收款');
  assert.equal(formatTaipeiTopupNote(new Date('2026-01-02T16:30:00.000Z')), '1/3收款');
});

test('v0.15.6 remains represented in release history', () => {
  const changelog = read('CHANGELOG.md');
  const changelogSource = read('src/data/changelog.js');

  assert.match(changelog, /^## \\[0\\.15\\.6\\] - 2026-09-17/m);
  assert.match(changelogSource, /'0\\.15\\.6': \\[/);
});
