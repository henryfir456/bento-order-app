const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
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


test('schema 2 drafts retain canonical H1 variant identity and all edit fields', async () => {
  const { buildMenuChangeDraft, normalizedIdentityForRow } = await import(
    pathToFileURL(componentPath.replace(
      'MenuItemChangesManagement.jsx',
      'menuItemChangesDraft.js'
    ))
  );
  const sourceRow = {
    vendor: 'Vendor A',
    effective_date: '2026-10-01',
    item_code: 'H1',
    variant_key: 'HALF',
    identity_schema_version: 2,
    item_name: 'Half lunch',
    price: 95,
    enabled: false,
    image_url: 'https://example.test/menu.png',
    note: 'existing note',
    display_order: 7
  };

  assert.deepEqual(normalizedIdentityForRow(sourceRow), ['H1', 'HALF']);
  assert.deepEqual(normalizedIdentityForRow({ ...sourceRow, variant_key: 'BASE' }), ['H1', 'BASE']);
  assert.deepEqual(normalizedIdentityForRow({ item_code: 'H1' }), ['H1', 'BASE']);
  const draft = buildMenuChangeDraft(sourceRow, {
    currentDate: '2026-10-11',
    selectedCurrentVendor: 'Vendor B'
  });
  assert.deepEqual(draft, {
    effective_date: '2026-10-01',
    vendor: 'Vendor A',
    item_code: 'H1',
    item_code_locked: true,
    variant_key: 'HALF',
    item_name: 'Half lunch',
    price: 95,
    enabled: false,
    image_url: 'https://example.test/menu.png',
    note: 'existing note',
    display_order: 7,
    identity_schema_version: 2,
    previous_variant_key: 'HALF',
    previous_identity_schema_version: 2
  });

  const payload = Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'item_code_locked'));
  assert.equal(payload.variant_key, 'HALF');
  assert.equal(payload.previous_variant_key, 'HALF');
  assert.equal(payload.identity_schema_version, 2);
  assert.equal(payload.previous_identity_schema_version, 2);

  const switchedToBase = { ...draft, variant_key: 'BASE' };
  const basePayload = Object.fromEntries(Object.entries(switchedToBase).filter(([key]) => key !== 'item_code_locked'));
  assert.equal(basePayload.variant_key, 'BASE');
  assert.equal(basePayload.previous_variant_key, 'HALF');
  for (const field of ['vendor', 'effective_date', 'item_code', 'item_name', 'price', 'enabled', 'image_url', 'note', 'display_order']) {
    assert.equal(basePayload[field], payload[field], field);
  }
});

test('new normalized drafts use context and context changes invalidate pending saves', () => {
  const { buildMenuChangeDraft } = require('../src/features/admin/menuItemChangesDraft.js');
  const draft = buildMenuChangeDraft(null, {
    currentDate: '2026-10-11',
    selectedCurrentVendor: 'Vendor B'
  });
  assert.equal(draft.vendor, 'Vendor B');
  assert.equal(draft.effective_date, '2026-10-11');
  assert.equal(draft.identity_schema_version, 2);
  assert.match(componentSource, /draftRequestId\.current !== requestId/);
  assert.match(componentSource, /draftRequestId\.current \+= 1;\s*setDraft\(null\)/);
  assert.match(componentSource, /if \(requestId === draftRequestId\.current\) setSaving\(false\)/);
});
