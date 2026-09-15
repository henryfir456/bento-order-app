const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('top-up method options expose the fixed values and labels', async () => {
  const { TOPUP_METHOD_OPTIONS } = await import('../src/features/balances/topupMethods.js');
  assert.deepEqual(TOPUP_METHOD_OPTIONS, [
    { value: 'TAIWAN_PAY', label: '台灣 Pay' },
    { value: 'LINE_PAY_MONEY', label: 'LINE Pay MONEY' },
    { value: 'BANK_TRANSFER', label: '帳戶轉帳' },
    { value: 'CASH', label: '現金' },
    { value: 'IPASS_MONEY', label: 'iPASS MONEY' }
  ]);
});

test('transaction descriptions use the canonical method and preserve legacy NULL fallback', async () => {
  const { formatTransactionDescription } = await import('../src/features/balances/topupMethods.js');
  assert.equal(formatTransactionDescription({ type: 'TOPUP', topupMethod: 'CASH', note: '現金收款' }), '現金｜現金收款');
  assert.equal(formatTransactionDescription({ type: 'TOPUP', topupMethod: 'CASH', note: '' }), '現金');
  assert.equal(formatTransactionDescription({ type: 'TOPUP', topupMethod: null, note: '舊備註' }), '舊備註');
  assert.equal(formatTransactionDescription({ type: 'ORDER', description: '點餐', topupMethod: 'CASH', note: '不應顯示' }), '點餐');
});

test('Admin top-up UI requires an explicit method and sends topupMethod to Worker', () => {
  const app = read('src/App.jsx');
  const client = read('src/api/apiClientCore.js');
  const handler = app.match(/const handleTopupSubmit = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';
  const modal = app.match(/\{selectedTopupUser && can\('topupMember'\)[\s\S]*?\n      \)\}/)?.[0] || '';

  assert.match(app, /const \[topupMethod, setTopupMethod\] = useState\(''\)/);
  assert.match(app, /setTopupMethod\(''\)/);
  assert.match(handler, /if \(!topupMethod\)/);
  assert.match(handler, /topupMethod,/);
  assert.match(modal, /<select/);
  assert.match(modal, /id="topup-method"/);
  assert.match(modal, /required/);
  assert.match(modal, /disabled=\{topupLoading \|\| !topupMethod\}/);
  assert.match(client, /topUpBalance: \(\{ targetUserId, amount, topupMethod, note, idempotencyKey \}/);
  assert.match(client, /body: \{ targetUserId, amount, topupMethod, note \}/);
});
