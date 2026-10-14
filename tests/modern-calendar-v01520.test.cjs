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
test('modern calendar shows Cai flavor only and HeShi vendor label without menu API reads', () => {
  assert.doesNotMatch(modern, /loadDailyMenu|calendarMenuNames|menuDetails|items\.map/);
  assert.match(modern, /getCalendarDailyFlavorImage/);
  assert.match(modern, /entry\.event\.vendor === '蔡老師'/);
  assert.match(modern, /entry\.event\.vendor\) : '未開團'/);
});
