const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = read('src/App.jsx');
const nav = read('src/components/BottomNavigation.jsx');
const orders = read('src/features/orders/MyOrdersPage.jsx');
const wallet = read('src/features/balances/WalletPage.jsx');
const modern = read('src/features/calendar/ModernCalendar.jsx');
const api = read('src/api/apiClientCore.js');

test('four tabs are live routes, not placeholder buttons', () => {
  assert.match(nav, /key: 'calendar'/);
  assert.match(nav, /key: 'myOrders'/);
  assert.match(nav, /key: 'wallet'/);
  assert.match(nav, /key: 'admin'/);
  assert.match(app, /<BottomNavigation current=\{viewMode\}/);
  assert.match(app, /<MyOrdersPage orders=\{myOrdersList\}/);
  assert.match(app, /<WalletPage balance=\{displayBalance\}/);
  assert.match(app, /handleAdminSectionChange\(canAuth\('viewMemberBalances'\) \? 'balances' : 'orders'\)/);
});

test('wallet uses server ledger and four-tab permissions respect real identity', () => {
  assert.match(app, /loadBalanceHistory\(taipeiMonth.year, taipeiMonth.month, null\)/);
  assert.match(app, /canAuth\('viewOwnBalance'\) && !isViewAsMode && !delegatedOrderUser/);
  assert.match(app, /canManage=\{!isViewAsMode && !delegatedOrderUser/);
  assert.match(app, /getOrdersHistory\(/);
  assert.match(api, /'\/api\/orders\/history'/);
  assert.match(wallet, /history\.map/);
  assert.match(wallet, /formatBalanceAmount/);
});

test('historical detail shows server snapshots rather than inferring totals from calendar', () => {
  assert.match(orders, /order\.items\.map/);
  assert.match(orders, /order\.totalAmount/);
  assert.match(orders, /aria-expanded/);
  assert.match(orders, /type="month"/);
  assert.doesNotMatch(orders, /localStorage|fetch\(/);
});

test('navigation is mobile safe, accessible, and calendar preserves selection', () => {
  assert.match(nav, /env\(safe-area-inset-bottom/);
  assert.match(nav, /aria-current=\{current === key/);
  assert.match(nav, /min-h-14/);
  assert.match(nav, /aria-label="主要導覽"/);
  assert.match(app, /selectedKey=\{selectedCalendarKey\}/);
  assert.match(modern, /onSelectKey\(entry.key\)/);
});
