const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const center = fs.readFileSync(path.join(root, 'src/features/balances/MemberBalanceManagement.jsx'), 'utf8');
test('Admin top navigation hides duplicate identity and delegate buttons while ProxyAdmin retains delegate', () => {
  assert.match(app, /authRole !== 'Admin' && canAuth\('viewAsUser'\)/);
  assert.match(app, /canAuth\('delegateOrder'\)\s*&& authRole !== 'Admin'/);
  assert.match(app, /🍱 選擇代點餐/);
});
test('unified user center uses five columns and ledger action', () => {
  for (const title of ['員編／姓名', '角色／LINE 綁定', '樓層', '餘額', '操作']) assert.ok(center.includes(title), title);
  assert.match(center, /setSelectedUser\(user\)}>交易明細/);
  assert.match(center, /getAdminUserLedger/);
  assert.match(center, /key: 'balance', direction: 'asc'/);
});
