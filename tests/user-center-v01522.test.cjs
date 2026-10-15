const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const load = (pathName) => fs.readFileSync(path.join(root, pathName), 'utf8');
const ui = load('src/features/balances/MemberBalanceManagement.jsx');
const modern = load('src/features/calendar/ModernCalendar.jsx');
const badge = load('src/components/IdentityStatusBadges.jsx');
const api = load('src/api/apiClientCore.js');
const admin = load('worker-poc/src/routes/admin.js');

test('member names are buttons using guarded audited Admin API, not View As', () => {
  assert.match(ui, /onClick=\{\(\) => startNameEdit\(user\)\}/);
  assert.match(ui, /updateAdminUserName\(\{ userId: editingName.userId, displayName \}\)/);
  assert.match(api, /updateAdminUserName:.*?=> workerRequest\(/s);
  assert.match(admin, /isNameUpdate/);
  assert.match(admin, /authorizationActor\?\.role !== 'Admin'/);
  assert.match(admin, /allowViewAs: !isUserLedger && !isNameUpdate/);
  assert.match(admin, /ADMIN_USER_NAME_UPDATED/);
  assert.match(admin, /runMutationBatch\(env.DB/);
});
test('line binding and actions use concise labels', () => {
  assert.match(badge, /shortLineLabel.*?'已綁定'/);
  assert.match(ui, />檢視身分<\/button>/);
  assert.match(ui, />代點餐<\/button>/);
  assert.match(ui, />明細<\/button>/);
  assert.doesNotMatch(ui, /👁|🍱/);
});
test('modern calendar only renders Cai flavor image and name', () => {
  assert.doesNotMatch(modern, /loadDailyMenu|menuDetails|calendarMenuNames/);
  assert.match(modern, /const isCai/);
  assert.match(modern, /isCai && active\.event\?\.dailyFlavorName/);
  assert.match(modern, /getCalendarDailyFlavorImage/);
});

test('mobile user management exposes the same shared sort state and action access', () => {
  assert.match(ui, /role="group" aria-label="使用者排序"/);
  assert.match(ui, /aria-label="排序欄位" value=\{sort\.key\}/);
  assert.match(ui, /<option value="balance">餘額<\/option>/);
  assert.match(ui, /<option value="employeeId">員編<\/option>/);
  assert.match(ui, /<option value="name">姓名<\/option>/);
  assert.match(ui, /<option value="floor">樓層<\/option>/);
  assert.match(ui, /aria-label="切換排序方向"/);
  assert.match(ui, /\{filteredMembers\.map\(\(user, idx\) => \(/g);
  assert.match(ui, /const \[sort, setSort\] = useState\(\{ key: 'balance', direction: 'asc' \}\)/);
  assert.match(ui, />明細<\/button>/);
  assert.doesNotMatch(ui, />檢視交易明細<\/button>/);
});
