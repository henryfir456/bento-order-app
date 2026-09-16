const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('admin order date navigation shifts Taipei date-only values across month and year boundaries', async () => {
  const { shiftDateInput } = await import(pathToFileURL(path.join(ROOT, 'src/dateUtils.js')).href);

  assert.equal(shiftDateInput('2026-09-16', -1), '2026-09-15');
  assert.equal(shiftDateInput('2026-10-01', -1), '2026-09-30');
  assert.equal(shiftDateInput('2026-09-30', 1), '2026-10-01');
  assert.equal(shiftDateInput('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDateInput('2025-12-31', 1), '2026-01-01');
});

test('admin order summary groups items by deterministic floor order while preserving item order', async () => {
  const { aggregateOrdersByFloor } = await import(pathToFileURL(
    path.join(ROOT, 'src/features/admin/orderSummary.js')
  ).href);

  const orders = [
    { pickup_floor: '9樓', item_name: '風味便當', quantity: 1 },
    { pickup_floor: '1樓', item_name: '特餐(半飯)', quantity: 2 },
    { pickup_floor: '2樓', item_name: '新樓品項', quantity: 4 },
    { pickup_floor: '1樓', item_name: '特餐', quantity: 1 },
    { pickup_floor: '9樓', item_name: '風味便當', quantity: 2 },
    { pickup_floor: '9樓', item_name: '小而美', quantity: 1 }
  ];

  assert.deepEqual(aggregateOrdersByFloor(orders), [
    {
      floor: '1樓',
      items: [
        { itemName: '特餐(半飯)', quantity: 2 },
        { itemName: '特餐', quantity: 1 }
      ]
    },
    {
      floor: '2樓',
      items: [{ itemName: '新樓品項', quantity: 4 }]
    },
    {
      floor: '9樓',
      items: [
        { itemName: '風味便當', quantity: 3 },
        { itemName: '小而美', quantity: 1 }
      ]
    }
  ]);
});

test('profile maintenance reuses the existing endpoint and synchronizes all local identity display state', () => {
  const app = read('src/App.jsx');
  const modal = read('src/components/PickupFloorModal.jsx');
  const saveHandler = app.match(/const handleSaveDefaultFloor = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || '';

  assert.match(app, /const \[profileNameDraft, setProfileNameDraft\]/);
  assert.match(app, /setProfileNameDraft\(authUser\.name \|\| authUser\.displayName \|\| name \|\| ''\)/);
  assert.match(app, /onClick=\{handleOpenFloorModal\}[\s\S]*?\{displayName\}/);
  assert.match(app, /onClick=\{handleOpenFloorModal\}[\s\S]*?\{displayFloor\}/);
  assert.match(saveHandler, /apiClient\.updatePickupFloor\(\{[\s\S]*displayName: nextDisplayName,[\s\S]*pickupFloor: nextFloor[\s\S]*\}\)/);
  assert.match(saveHandler, /setAuthUser\(prev => prev \? \{/);
  assert.match(saveHandler, /displayName: canonicalName/);
  assert.match(saveHandler, /setName\(canonicalName\)/);
  assert.match(saveHandler, /setDefaultFloor\(canonicalFloor\)/);
  assert.match(saveHandler, /setFloor\(canonicalFloor\)/);
  assert.match(modal, /displayName/);
  assert.match(modal, /onDisplayNameChange/);
  assert.match(modal, /個人資料維護/);
});

test('header renders only elevated role badges before the clickable display name', () => {
  const app = read('src/App.jsx');
  const headerBlock = app.match(/<div className="mt-2 flex min-w-0 flex-wrap items-center gap-1\.5 text-xs text-emerald-100">[\s\S]*?<\/div>/)?.[0] || '';

  assert.match(app, /const headerRoleLabel = \['Admin', 'ProxyAdmin'\]\.includes\(effectiveRole\)/);
  assert.match(headerBlock, /\{headerRoleLabel &&/);
  assert.ok(headerBlock.indexOf('👤') < headerBlock.indexOf('headerRoleLabel'));
  assert.ok(headerBlock.indexOf('headerRoleLabel') < headerBlock.indexOf('{displayName}'));
  assert.doesNotMatch(app, /\{authMode === 'employee_guest' \? '員編登入' : effectiveRole\}/);
  assert.doesNotMatch(headerBlock, /\{effectiveRole\}/);
});

test('admin order controls and summary presentation use the requested grouped UI', () => {
  const summary = read('src/features/admin/AdminOrderSummary.jsx');

  assert.doesNotMatch(summary, /<label[^>]*>\s*訂單日期\s*<input/);
  assert.doesNotMatch(summary, /目前顯示：/);
  assert.match(summary, /aria-label="前一天"/);
  assert.match(summary, /aria-label="後一天"/);
  assert.match(summary, /shiftDateInput\(selectedOrderDate, -1\)/);
  assert.match(summary, /shiftDateInput\(selectedOrderDate, 1\)/);
  assert.match(summary, /aggregatedOrders\.map\(\(\{ floor, items \}\)/);
  assert.match(summary, /\{floor\} 訂單/);
  assert.match(summary, /itemName/);
  assert.match(summary, /× \{quantity\}/);
  assert.match(summary, /grid-cols-1[^\n]*sm:grid-cols-2/);
  assert.doesNotMatch(summary, /\(\$\{floor\}\)/);
});
