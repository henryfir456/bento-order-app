const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const app=read('src/App.jsx'), orders=read('src/features/orders/MyOrdersPage.jsx');
const wallet=read('src/features/balances/WalletPage.jsx');

test('calendar has no vendor-menu shortcut, management retains vendor entry',()=>{
  assert.doesNotMatch(app,/查看店家菜單 ›/);
  assert.match(app,/店家專區 ›/);
});
test('my orders initial month follows Taipei and retains accessible month input',()=>{
  assert.match(orders,/getTaipeiYearMonth\(\)/);
  assert.match(orders,/String\(month\)\.padStart\(2, '0'\)/);
  assert.match(orders,/type="month"/);
  assert.match(orders,/sr-only">選擇月份/);
  assert.match(orders,/顯示所有月份/);
  assert.doesNotMatch(orders,/含過去已完成和目前有效的訂餐|篩選月份/);
});
test('requested explanatory copy removed; Admin shortcuts hidden but ProxyAdmin guarded',()=>{
  assert.doesNotMatch(wallet,/以正式帳戶資料為準/);
  assert.doesNotMatch(app,/切換後保留偏好，返回訂餐即可看到新畫面/);
  assert.match(app,/authRole !== 'Admin' && canAuth\('viewAsUser'\)/);
  assert.match(app,/authRole !== 'Admin' && canAuth\('delegateOrder'\)/);
  assert.match(app,/使用者管理中心 ›/);
});
