const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = require('./helpers/app-source.cjs').readAppSource();
const center = read('src/features/balances/MemberBalanceManagement.jsx');
const modern = read('src/features/calendar/ModernCalendar.jsx');

test('name edit and ledger render as modal dialogs', () => {
  assert.match(center, /role="dialog" aria-modal="true" aria-label="修改使用者姓名"/);
  assert.match(center, /role="dialog" aria-modal="true" aria-label="使用者交易明細"/);
  assert.match(center, /fixed inset-0 z-50/);
});

test('ending view-as or delegated order returns Admin to user management center', () => {
  const viewExit = app.slice(app.indexOf('const handleExitViewAs'), app.indexOf('const handleExitDelegatedOrder'));
  const delegateExit = app.slice(app.indexOf('const handleExitDelegatedOrder'), app.indexOf('const handleOpenFloorModal'));
  for (const block of [viewExit, delegateExit]) {
    assert.match(block, /viewMemberBalances/);
    assert.match(block, /setAdminSection\('balances'\)/);
    assert.match(block, /setViewMode\('admin'\)/);
    assert.match(block, /loadMemberBalances\(true\)/);
  }
});

test('unopened modern-calendar dates can show projected Cai daily flavor name', () => {
  assert.match(modern, /entry\.event\?\.dailyFlavorName \|\| '未開團'/);
  assert.match(modern, /const status = !event\?\.vendor \? '未開團'/);
});
