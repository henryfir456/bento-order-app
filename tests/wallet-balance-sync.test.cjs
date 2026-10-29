const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('own current-month balance history refreshes header and nav balance', () => {
  const start = app.indexOf('const loadBalanceHistory');
  const end = app.indexOf('const fetchBalanceHistory');
  const block = app.slice(start, end);
  assert.match(block, /!viewAsUserId && year === currentMonth\.year && month === currentMonth\.month/);
  assert.match(block, /setUserBalance\(closing\)/);
  assert.match(block, /setAuthUser\(prev => /);
});
