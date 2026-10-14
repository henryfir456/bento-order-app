const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'),'utf8');
const orders = fs.readFileSync(path.join(__dirname, '../src/features/orders/MyOrdersPage.jsx'),'utf8');
test('calendar status display uses concise labels while keeping existing predicates',()=>{
  assert.match(app,/statusBadge = [^\n]*>已訂<\/span>/);
  assert.match(app,/statusBadge = [^\n]*>截止<\/span>/);
  assert.match(app,/statusBadge = [^\n]*>可訂<\/span>/);
  assert.doesNotMatch(app,/>已訂\/截止<\/span>|>已截止<\/span>/);
});
test('order page has safe back button without submitting or cancelling',()=>{
  assert.match(app,/orderControlsOpen \? \([\s\S]*?onClick=\{handleExitToCalendar\}[\s\S]*?返回/);
  assert.match(app,/const handleExitToCalendar = \(\) => \{[\s\S]*?setViewMode\('calendar'\)/);
  assert.match(app,/disabled=\{loading \|\| orderMutationInFlightRef.current\}/);
});
test('My Orders refreshes on tab entry with no persistent refresh button',()=>{
  assert.doesNotMatch(orders,/>重新整理<\/button>/);
  assert.match(orders,/onClick=\{onRefresh\}[\s\S]*?>重試<\/button>/);
  assert.match(app,/key === 'myOrders'[\s\S]*?void refreshMyOrders\(\)/);
});
