const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '../src/features/orders/orderDeadlineLabel.js')).href);

test('order deadline label shows Taipei clock time and remaining time', async () => {
  const { formatOrderDeadline } = await load();
  // 10:00 Taipei on 2026-10-26 is 02:00Z.
  const deadline = '2026-10-26T02:00:00.000Z';
  assert.equal(formatOrderDeadline(deadline, new Date('2026-10-26T00:40:00.000Z')).text, '今天 10:00 截止・剩 1 小時 20 分');
  assert.equal(formatOrderDeadline(deadline, new Date('2026-10-26T01:30:00.000Z')).text, '今天 10:00 截止・剩 30 分鐘');
  assert.equal(formatOrderDeadline(deadline, new Date('2026-10-25T01:00:00.000Z')).text, '明天 10:00 截止・剩 1 天 1 小時');
  assert.match(formatOrderDeadline(deadline, new Date('2026-10-20T01:00:00.000Z')).text, /^10\/26 10:00 截止・剩 6 天/);
});

test('order deadline label is hidden when expired or invalid', async () => {
  const { formatOrderDeadline } = await load();
  assert.equal(formatOrderDeadline('2026-10-26T02:00:00.000Z', new Date('2026-10-26T02:00:00.000Z')), null);
  assert.equal(formatOrderDeadline('2026-10-26T02:00:00.000Z', new Date('2026-10-26T05:00:00.000Z')), null);
  assert.equal(formatOrderDeadline(null), null);
  assert.equal(formatOrderDeadline('not-a-date'), null);
});

test('order page labels a passed cutoff that an Admin bypass keeps editable', () => {
  const fs = require('node:fs');
  const page = fs.readFileSync(path.join(__dirname, '../src/features/orders/OrderPage.jsx'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  assert.match(app, /cutoffPassed=\{isExpired && !isOrderExpired\}/);
  assert.match(page, /cutoffPassed \? [\s\S]*?已截止・管理者可修改/);
});
