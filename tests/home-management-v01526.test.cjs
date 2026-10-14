const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname,'../src/App.jsx'),'utf8');
const nav = fs.readFileSync(path.join(__dirname,'../src/components/BottomNavigation.jsx'),'utf8');

test('header contains user identity but no duplicate balance or toolbar', () => {
  const header=app.slice(app.indexOf('<header className='),app.indexOf('</header>'));
  assert.match(header,/蔬食便當預訂系統/);
  assert.match(header,/IdentityStatusBadges/);
  assert.doesNotMatch(header,/fetchBalanceHistory|功能操作|店家專區|訂單總覽/);
});
test('wallet tab shows authoritative amount only and still navigates to wallet', () => {
  assert.match(nav,/key === 'wallet' \? \(balanceKnown/);
  assert.match(nav,/aria-label=\{key === 'wallet'/);
  assert.match(nav,/text-rose-700/);
  assert.match(app,/balance=\{displayBalance\} balanceKnown=/);
  assert.match(app,/openWalletPage\(\)/);
});
test('management hub contains prior admin actions and persisted classic/modern switch', () => {
  assert.match(app,/adminSection === 'hub'/);
  assert.match(app,/店家專區 ›/);
  assert.match(app,/訂單總覽 ›/);
  assert.match(app,/使用者管理中心 ›/);
  assert.match(app,/開團管理 ›/);
  assert.match(app,/選擇代點餐 ›/);
  assert.match(app,/介面切換/);
  assert.match(app,/selectCalendarUi\('classic'\)/);
  assert.match(app,/selectCalendarUi\('modern'\)/);
  assert.match(app,/localStorage.setItem\('bento-calendar-ui'/);
  assert.doesNotMatch(app,/查看店家菜單 ›/);
});
