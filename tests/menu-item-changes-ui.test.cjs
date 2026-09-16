const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const componentPath = path.join(
  __dirname,
  '..',
  'src',
  'features',
  'admin',
  'MenuItemChangesManagement.jsx'
);
const componentSource = fs.readFileSync(componentPath, 'utf8');

test('current menu renderer uses a stable unique key for each returned row', () => {
  assert.match(componentSource, /from ['"]\.\/menuItemChangesPreview['"]/);
  assert.equal(
    (componentSource.match(/key=\{currentMenuRowKey\(row, selectedCurrentVendor, currentDate\)\}/g) || []).length,
    2
  );
  assert.doesNotMatch(componentSource, /key=\{`\$\{row\.item_code\}-\$\{row\.variant_key\}`\}/);
});

test('current menu clears the previous result before applying a new preview', () => {
  const loadStart = componentSource.slice(componentSource.indexOf('const loadCurrentMenu'));
  assert.match(loadStart, /setCurrentMenu\(null\);\s*setCurrentMenuLoading\(true\);/);
});

test('preview response gate rejects late Cai data after the HeShi request wins', async () => {
  const { currentMenuRowKey, shouldApplyPreviewResult } = await import(
    '../src/features/admin/menuItemChangesPreview.js'
  );
  const caiRows = [
    { menu_item_change_id: 'cai-ap-plus', vendor: '蔡老師', item_code: 'AP', variant_key: '', effective_date: '2026-09-02' },
    { menu_item_change_id: 'cai-ap-meeting', vendor: '蔡老師', item_code: 'AP', variant_key: '', effective_date: '2026-09-02' }
  ];
  const heShiRows = ['H1', 'H2', 'H3', 'H4', 'H5'].flatMap((itemCode) => [
    { menu_item_change_id: `he-shi-${itemCode}-base`, vendor: '禾拾', item_code: itemCode, variant_key: 'BASE', effective_date: '2026-09-17' },
    { menu_item_change_id: `he-shi-${itemCode}-half`, vendor: '禾拾', item_code: itemCode, variant_key: 'HALF', effective_date: '2026-09-17' }
  ]);

  assert.equal(new Set(caiRows.map((row) => currentMenuRowKey(row, '蔡老師', '2026-09-16'))).size, 2);
  assert.equal(new Set(heShiRows.map((row) => currentMenuRowKey(row, '禾拾', '2026-09-17'))).size, 10);
  assert.equal(
    shouldApplyPreviewResult({
      requestId: 1,
      latestRequestId: 2,
      requestVendor: '蔡老師',
      requestDate: '2026-09-16',
      result: { vendor: '蔡老師', targetDate: '2026-09-16' }
    }),
    false
  );
  assert.equal(
    shouldApplyPreviewResult({
      requestId: 2,
      latestRequestId: 2,
      requestVendor: '禾拾',
      requestDate: '2026-09-17',
      result: { vendor: '禾拾', targetDate: '2026-09-17' }
    }),
    true
  );
});
