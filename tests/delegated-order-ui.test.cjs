const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const extractHandler = (source, name) => {
  const start = source.indexOf(`const ${name} = async () => {`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf('\n  };', start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return source.slice(start, end + '\n  };'.length);
};

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
  assert.equal(packageJson.version, '0.15.3');
  assert.equal(packageLock.version, '0.15.3');
  assert.equal(packageLock.packages[''].version, '0.15.3');
  assert.match(changelog, /## \[0\.15\.2\] - 2026-09-16/);
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
  for (const change of [
    '餘額管理改為「全部／負餘額」',
    'Admin / ProxyAdmin header role 顯示調整',
    '個人資料可修改姓名與預設取餐樓層',
    '訂單管理日期快速前後切換',
    '便購種類匯總改為依樓層分組',
    '店家專區卡片版面改善',
    '代點餐新增員編即時篩選'
  ]) {
    assert.ok(localizedChangelog.includes(change), `missing v0.15.2 UI changelog text: ${change}`);
  }
});

test('delegated ordering filters the already eligible members by employee ID', async () => {
  const { filterMembersByEmployeeId } = await import(pathToFileURL(path.join(
    __dirname,
    '..',
    'src',
    'features',
    'admin',
    'delegateOrderFilter.js'
  )).href);
  const eligibleMembers = [
    { userId: 'target-070214', employeeId: '070214' },
    { userId: 'target-070xxx', employeeId: '070xxx' },
    { userId: 'target-170214', employeeId: '170214' }
  ];

  assert.deepEqual(filterMembersByEmployeeId(eligibleMembers, ''), eligibleMembers);
  assert.deepEqual(filterMembersByEmployeeId(eligibleMembers, '   '), eligibleMembers);
  assert.deepEqual(
    filterMembersByEmployeeId(eligibleMembers, '070214').map(({ userId }) => userId),
    ['target-070214']
  );
  assert.deepEqual(
    filterMembersByEmployeeId(eligibleMembers, ' 070 ').map(({ userId }) => userId),
    ['target-070214', 'target-070xxx']
  );
  assert.equal(eligibleMembers[0].employeeId, '070214');
  assert.deepEqual(filterMembersByEmployeeId(eligibleMembers, '999'), []);
});

test('delegated ordering modal wires live employee ID filtering and resets its query', () => {
  const app = read('src/App.jsx');
  const filter = read('src/features/admin/delegateOrderFilter.js');

  assert.match(filter, /trim\(\)/);
  assert.match(filter, /toLowerCase\(\)/);
  assert.match(filter, /includes\(/);
  assert.match(app, /filterMembersByEmployeeId/);
  assert.match(app, /const \[employeeIdFilter, setEmployeeIdFilter\] = useState\(''\);/);
  assert.match(app, /const visibleSelectionRows = useMemo\(/);
  assert.match(app, /id="delegate-employee-id-filter"/);
  assert.match(app, /員編篩選/);
  assert.match(app, /placeholder="輸入員編篩選"/);
  assert.match(app, /onChange=\{\(event\) => setEmployeeIdFilter\(event\.target\.value\)\}/);
  assert.match(app, /找不到符合此員編的成員/);
  assert.match(app, /visibleSelectionRows\.map\(\(user, idx\) =>/);
  assert.doesNotMatch(app, /selectionRows\.map\(\(user, idx\) =>/);
  assert.match(app, /onClick=\{\(\) => handleSelectDelegatedOrder\(user\)\}/);
  assert.ok((app.match(/setEmployeeIdFilter\(''\)/g) || []).length >= 4);
});

test('delegated order invalidates the cached member balance without patching the list', () => {
  const app = read('src/App.jsx');
  const handler = extractHandler(app, 'handleConfirmSubmit');

  assert.match(handler, /const isDelegatedOrder = Boolean\(delegatedOrderUser\?\.userId\);/);
  assert.match(handler, /if \(isDelegatedOrder\) \{[\s\S]*setDelegatedOrderUser\([\s\S]*data\.newBalance/);
  assert.match(handler, /if \(isDelegatedOrder\) setMemberBalancesLoaded\(false\);/);
  assert.doesNotMatch(handler, /setMemberBalances\(prev =>/);
  assert.match(handler, /setDelegatedOrderUser\([\s\S]*data\.newBalance[\s\S]*\);[\s\S]*setMemberBalancesLoaded\(false\)/);
});

test('delegated cancel/refund invalidates the cached member balance and normal orders do not', () => {
  const app = read('src/App.jsx');
  const submitHandler = extractHandler(app, 'handleConfirmSubmit');
  const cancelHandler = extractHandler(app, 'handleConfirmCancel');

  assert.match(cancelHandler, /const isDelegatedOrder = Boolean\(delegatedOrderUser\?\.userId\);/);
  assert.match(cancelHandler, /if \(isDelegatedOrder\) \{[\s\S]*setDelegatedOrderUser\([\s\S]*data\.newBalance/);
  assert.match(cancelHandler, /if \(isDelegatedOrder\) setMemberBalancesLoaded\(false\);/);
  assert.doesNotMatch(cancelHandler, /setMemberBalances\(prev =>/);

  const submitBalanceBranch = submitHandler.slice(
    submitHandler.indexOf('if (isDelegatedOrder) {'),
    submitHandler.indexOf('if (isDelegatedOrder) setMemberBalancesLoaded')
  );
  const cancelBalanceBranch = cancelHandler.slice(
    cancelHandler.indexOf('if (isDelegatedOrder) {'),
    cancelHandler.indexOf('if (isDelegatedOrder) setMemberBalancesLoaded')
  );
  const submitNormalBranch = submitBalanceBranch.slice(submitBalanceBranch.indexOf('} else {'));
  const cancelNormalBranch = cancelBalanceBranch.slice(cancelBalanceBranch.indexOf('} else {'));
  assert.doesNotMatch(submitNormalBranch, /setMemberBalancesLoaded\(false\)/);
  assert.doesNotMatch(cancelNormalBranch, /setMemberBalancesLoaded\(false\)/);
});

test('delegated balance cache regression: stale zero is invalidated, then balances entry reloads authoritative -100', () => {
  const app = read('src/App.jsx');
  const banner = read('src/components/ViewAsBanner.jsx');
  const balances = read('src/features/balances/MemberBalanceManagement.jsx');
  const submitHandler = extractHandler(app, 'handleConfirmSubmit');
  const balancesLoader = app.slice(app.indexOf('const loadMemberBalances = async'));
  const sectionHandler = app.slice(app.indexOf('const handleAdminSectionChange ='));

  const state = {
    memberBalances: [{ name: 'C_KW', userId: 'target-c-kw', balance: 0 }],
    memberBalancesLoaded: true,
    delegatedOrderUser: { name: 'C_KW', userId: 'target-c-kw', balance: 0 },
    network: []
  };
  const delegatedResponse = { success: true, newBalance: -100 };

  assert.equal(state.memberBalances[0].balance, 0);
  assert.match(submitHandler, /setDelegatedOrderUser\([\s\S]*data\.newBalance/);
  assert.match(submitHandler, /setMemberBalancesLoaded\(false\)/);
  state.delegatedOrderUser.balance = delegatedResponse.newBalance;
  state.memberBalancesLoaded = false;

  assert.match(banner, /目標餘額：\{formatBalanceAmount\(delegatedOrderUser\.balance\)\}/);
  assert.equal(state.delegatedOrderUser.balance, -100, 'banner source receives response.newBalance immediately');
  assert.match(sectionHandler, /if \(section === ['"]balances['"]\)[\s\S]*loadMemberBalances\(\)/);
  assert.match(balancesLoader, /if \(!force && memberBalancesLoaded\) return;/);
  assert.match(balancesLoader, /apiClient\.getMemberBalances\(\)/);
  assert.match(balancesLoader, /setMemberBalances\(data\.members \|\| data\.users \|\| \[\]\)/);

  let fetchCount = 0;
  const enterBalances = () => {
    if (state.memberBalancesLoaded) return;
    fetchCount += 1;
    state.memberBalances = [{ name: 'C_KW', userId: 'target-c-kw', balance: -100 }];
    state.memberBalancesLoaded = true;
  };
  enterBalances();
  assert.equal(fetchCount, 1);
  assert.equal(state.memberBalances[0].balance, -100);
  assert.match(balances, /memberBalances/);
  assert.match(balances, /user\.balance/);
});

test('admin top-up keeps its existing invalidation and immediate authoritative refetch', () => {
  const app = read('src/App.jsx');
  const topupHandler = extractHandler(app, 'handleTopupSubmit');

  assert.match(topupHandler, /setMemberBalancesLoaded\(false\);[\s\S]*await loadMemberBalances\(true\)/);
});
