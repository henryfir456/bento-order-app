const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const modern = fs.readFileSync(path.join(root, 'src/features/calendar/ModernCalendar.jsx'), 'utf8');

test('classic calendar remains the default and switch is limited to real identity', () => {
  assert.match(app, /getItem\('bento-calendar-ui'\)/);
  assert.match(app, /saved === 'modern' \|\| saved === 'rolling' \? saved : 'classic'/);
  assert.match(app, /catch \{ return 'classic'; \}/);
  assert.match(app, /isRegistered && !isViewAsMode && !delegatedOrderUser/);
  assert.match(app, /canPreviewModernCalendar \? calendarUi : 'classic'/);
});
test('calendar views share existing date selection and cannot mutate order directly', () => {
  assert.match(app, /onSelectDate=\{handleSelectDate\}/);
  assert.match(app, /renderCalendarDays=\{renderCalendarDays\}/);
  assert.match(modern, /onClick=\{\(\) => onSelectDate\(active.key\)\}/);
  assert.doesNotMatch(modern, /apiClient|fetch\(|localStorage\.setItem/);
});
test('admin opening management mode falls back to classic management calendar', () => {
  assert.match(app, /effectiveCalendarUi === 'modern' && !adminManageMode/);
  assert.match(app, /effectiveCalendarUi === 'classic' \|\| adminManageMode/);
});
test('modern calendar supplies accessible status and date navigation', () => {
  assert.match(modern, /aria-pressed=\{active\?\.key === entry.key\}/);
  assert.match(modern, /aria-label=\{\x60\$\{entry.key\}/);
  assert.match(modern, /getWeekdayLeadingBlankCount/);
});
test('rolling calendar shows three Monday-Friday weeks and reminder settings use the worker API only', () => {
  const rolling = fs.readFileSync(path.join(root, 'src/features/calendar/RollingCalendar.jsx'), 'utf8');
  assert.match(app, /effectiveCalendarUi === 'rolling' && !adminManageMode/);
  assert.match(rolling, /onClick=\{\(\) => onSelectDate\(active.key\)\}/);
  assert.doesNotMatch(rolling, /apiClient|fetch\(|localStorage/);
  assert.match(app, /<OrderReminderSettings api=\{apiClient\} \/>/);
});
