const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('frontend keeps View-As read-only and exposes explicit delegated ordering mode', () => {
  const app = read('src/App.jsx');
  const banner = read('src/components/ViewAsBanner.jsx');
  const orderPage = read('src/features/orders/OrderPage.jsx');
  const api = read('src/api/apiClientCore.js');
  const changelog = read('CHANGELOG.md');
  const localizedChangelog = read('src/data/changelog.js');
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));

  assert.match(app, /delegatedOrderUser/);
  assert.match(app, /delegateOrder/);
  assert.match(app, /handleExitDelegatedOrder/);
  assert.match(app, /targetUserId/);
  assert.match(app, /setViewAsUser\(null\)/);
  assert.match(app, /isViewAsMode/);
  assert.match(app, /!isViewAsMode && !delegatedOrderUser && can\('viewOwnBalance'\)/);
  assert.match(banner, /代替/);
  assert.match(banner, /目標餘額：\{formatBalanceAmount\(delegatedOrderUser\.balance\)\}/);
  assert.match(banner, /返回 Admin|結束代點/);
  assert.match(orderPage, /isViewAsMode/);
  assert.match(api, /getOrderTargets/);
  assert.match(api, /targetUserId/);
  assert.equal(packageJson.version, '0.14.2');
  assert.equal(packageLock.version, '0.14.2');
  assert.equal(packageLock.packages[''].version, '0.14.2');
  assert.match(changelog, /## \[0\.14\.1\] - 2026-09-15/);
  assert.match(app, /v\{APP_VERSION\}/);
  for (const change of [
    '新增 Admin／ProxyAdmin 代點餐',
    'Admin 本人點餐與代點餐皆不受一般日期／截止時間限制',
    'ProxyAdmin 僅限台北當日代點，但可突破一般截止時間',
    '代點訂單 ownership 仍屬於被代點成員',
    '代點扣款與退款仍作用於被代點成員',
    'Admin／ProxyAdmin 本人餘額不受代點影響',
    'View-As 維持獨立；View-As 仍為唯讀',
    'COMPLETED／readOnly／finalized 歷史訂單仍不可修改'
  ]) {
    assert.ok(localizedChangelog.includes(change), `missing v0.14.0 UI changelog text: ${change}`);
  }
  for (const change of [
    '代點餐支援未綁定 LINE 的有效會員',
    '個人交易明細顯示中文點餐狀態、用餐日期、店家與品項',
    '修正點餐與取消後畫面餘額未即時更新'
  ]) {
    assert.ok(localizedChangelog.includes(change), `missing v0.14.1 UI changelog text: ${change}`);
  }
});
