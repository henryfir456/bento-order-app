const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const modern = fs.readFileSync(path.join(root, 'src/features/calendar/ModernCalendar.jsx'), 'utf8');
const center = fs.readFileSync(path.join(root, 'src/features/balances/MemberBalanceManagement.jsx'), 'utf8');

test('existing unified user center remains wired to the entry point', () => {
  assert.match(app, /使用者管理中心/);
  assert.match(app, /<MemberBalanceManagement/);
  assert.match(center, /使用者管理中心/);
});
test('modern view removes next-day banner and formats weekday', () => {
  assert.doesNotMatch(modern, /下一個可訂餐日/);
  assert.match(modern, /weekdayText/);
  assert.match(modern, /dateLabel/);
});
test('vendor-specific menu uses authenticated order-page response', () => {
  assert.match(app, /loadModernDailyMenu/);
  assert.match(app, /apiClient\.getOrderPage/);
  assert.match(modern, /loadDailyMenu\(key\)/);
  assert.match(modern, /item\.image_url/);
  assert.match(modern, /const isCai/);
});
