import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import {
  materializeMenuVersion,
  projectionVersionId,
  resolveEffectiveMenuState,
  resolveMenuItemChanges,
  resolveMenuItemChangesFromRows
} from '../src/domain/menuItemChanges.js';
import { getCustomerMenu } from '../src/domain/menu.js';
import {
  buildGasCompatibilityChanges,
  buildGasApVariantMapping,
  buildMenuItemChangeBackfillReport,
  buildSqlMenuItemChanges,
  backfillMenuItemChanges
} from '../scripts/lib/menu-item-change-backfill.mjs';
import { readLegacySqlDump } from '../scripts/lib/legacy-sql-adapter.mjs';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const NOW = new Date('2026-09-14T00:00:00.000Z');
const profiles = {
  Admin: { token: 'changes-admin-token', lineUserId: 'changes-admin' },
  User: { token: 'changes-user-token', lineUserId: 'changes-user' },
  ProxyAdmin: { token: 'changes-proxy-token', lineUserId: 'changes-proxy' }
};

const seedUsers = (database) => {
  seedUser(database, { lineUserId: 'changes-admin', role: 'Admin' });
  seedUser(database, { lineUserId: 'changes-user', role: 'User' });
  seedUser(database, { lineUserId: 'changes-proxy', role: 'ProxyAdmin' });
};

const call = async (database, path, {
  role = 'Admin', method = 'GET', body, headers = {}
} = {}) => {
  const profile = profiles[role];
  const response = await handleFormalRequest(
    request(path, { method, token: profile.token, body, headers }),
    { DB: database },
    { fetchImpl: profileFetch(profile), now: NOW }
  );
  return { response, body: response.status === 204 ? null : await response.json() };
};

const seedChange = (database, {
  id, date, code, variant = '', name = code, price = 1,
  enabled = 1, image = '', source = 'admin', order = 1, vendor = '蔡老師', sourceId = id
}) => {
  database.run(`
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, enabled, image_url, note, display_order,
      source_kind, source_record_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
  `, id, date, vendor, code, variant, name, price, enabled, image, order, source, sourceId);
};

const seedCompatibilityVersion = (database, {
  id, date = '2026-09-06', vendor = '蔡老師', rows
}) => {
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES (?, ?, ?)
  `, id, vendor, date);
  for (const row of rows) {
    database.run(`
      INSERT INTO menu_items (
        menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name,
        price, enabled, note, image_url, source_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, row.menuItemId, id, row.itemCode, row.variantKey || '', row.itemName,
    row.price, row.enabled === false ? 0 : 1, row.note || '', row.imageUrl || '', row.sourceOrder);
  }
};

test('SQL backfill is exactly 34 facts and reconstructs the five cumulative snapshots', async () => {
  const parsed = await readLegacySqlDump(new URL('../../gas/bento_script.sql', import.meta.url));
  const backfill = buildSqlMenuItemChanges({ facts: parsed.historicalMenuFacts, sourceHash: parsed.sourceHash });
  assert.equal(backfill.rows.length, 34);
  assert.deepEqual(backfill.summary.snapshotCounts.map((item) => item.itemCount), [15, 15, 17, 20, 21]);
  assert.deepEqual(backfill.summary.revert1, [-1, -1]);
  assert.equal(new Set(backfill.rows.map((row) => [row.vendor, row.item_code, row.variant_key, row.effective_date].join('|'))).size, 34);

  const counts = ['2023-04-01', '2025-02-01', '2026-07-01', '2026-08-01', '2026-09-01']
    .map((targetDate) => resolveMenuItemChangesFromRows(backfill.rows, { vendor: '蔡老師', targetDate }).rows.length);
  assert.deepEqual(counts, [15, 15, 17, 20, 21]);
  assert.equal(resolveMenuItemChangesFromRows(backfill.rows, { vendor: '蔡老師', targetDate: '2026-08-10' })
    .rows.find((row) => row.item_code === 'revert1').price, -1);
  assert.deepEqual(buildMenuItemChangeBackfillReport({ sql: backfill }).reconciliation, {
    sqlCount: 34,
    gasCount: 0,
    totalCount: 34,
    collisionCount: 0,
    uniqueIdentityCount: 34
  });
});

test('AP mapping is source-identity based, stable, explicit, and collision-safe', () => {
  const rows = [
    { vendor: '蔡老師', effective_date: '2026-09-02', item_code: 'AP', item_name: 'first', price: 100, source_record_id: 'gas-ap-b' },
    { vendor: '蔡老師', effective_date: '2026-09-02', item_code: 'AP', item_name: 'second', price: 120, source_record_id: 'gas-ap-a' }
  ];
  assert.throws(() => buildGasApVariantMapping(rows), (error) => error.code === 'GAS_AP_VARIANT_MAPPING_REQUIRED');
  const mapping = buildGasApVariantMapping(rows, {
    explicit: { 'gas-ap-a': 'ap-variant-2', 'gas-ap-b': 'ap-variant-1' }
  });
  assert.deepEqual(mapping.mappings, [
    { source_record_id: 'gas-ap-a', variant_key: 'ap-variant-2' },
    { source_record_id: 'gas-ap-b', variant_key: 'ap-variant-1' }
  ]);
  const gas = buildGasCompatibilityChanges({
    rows,
    apVariantMapping: { 'gas-ap-a': 'ap-variant-2', 'gas-ap-b': 'ap-variant-1' }
  });
  assert.deepEqual(gas.rows.map((row) => row.variant_key), ['ap-variant-1', 'ap-variant-2']);
  assert.throws(() => buildGasCompatibilityChanges({
    rows: [...rows, { ...rows[0], effective_date: '2026-09-02', source_record_id: 'gas-ap-c' }]
  }), (error) => error.code === 'GAS_AP_VARIANT_COUNT_INVALID');
  assert.throws(() => buildGasCompatibilityChanges({
    rows: [
      { vendor: '蔡老師', effective_date: '2026-09-02', item_code: 'A', item_name: 'A1', price: 1, source_record_id: 'a1' },
      { vendor: '蔡老師', effective_date: '2026-09-02', item_code: 'A', item_name: 'A2', price: 2, source_record_id: 'a2' },
      ...rows
    ],
    apVariantMapping: { 'gas-ap-a': 'ap-variant-2', 'gas-ap-b': 'ap-variant-1' }
  }), (error) => error.code === 'MENU_ITEM_CHANGE_IDENTITY_COLLISION');
});

test('resolver honors SQL authority through cutoff and Admin supersedes GAS only after cutoff', async () => {
  const database = new SqliteD1();
  seedChange(database, { id: 'sql-a', date: '2026-09-01', code: 'A', price: 100, source: 'legacy_sql' });
  seedChange(database, { id: 'gas-a', date: '2026-09-02', code: 'A', price: 110, source: 'gas_compatibility' });
  seedChange(database, { id: 'gas-b', date: '2026-09-02', code: 'B', price: 80, source: 'gas_compatibility', order: 2 });
  seedChange(database, { id: 'admin-a', date: '2026-09-11', code: 'A', price: -1, source: 'admin' });

  const historical = await resolveMenuItemChanges(database, { vendor: '蔡老師', targetDate: '2026-09-10' });
  assert.equal(historical.authority, 'sql_historical');
  assert.deepEqual(historical.rows.map((row) => [row.item_code, row.price]), [['A', 100]]);
  const live = await resolveMenuItemChanges(database, { vendor: '蔡老師', targetDate: '2026-09-11' });
  assert.equal(live.authority, 'live_with_admin_overrides');
  assert.deepEqual(live.rows.map((row) => [row.item_code, row.price]), [['A', -1], ['B', 80]]);
});

test('change history carries images without name-only fallback and legacy live images remain unchanged', async () => {
  const database = new SqliteD1();
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES ('existing-live-image-version', 'Vendor A', '2026-09-11')
  `);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, image_url, source_order
    ) VALUES ('existing-live-image', 'existing-live-image-version', 'E', 'Existing E', 80, 1, 'https://live.example/e.jpg', 1)
  `);
  const liveMenu = await getCustomerMenu(database, { vendor: 'Vendor A', targetDate: '2026-09-11' });
  assert.equal(liveMenu[0].image_url, 'https://live.example/e.jpg');

  seedChange(database, { id: 'history-no-image', date: '2026-09-01', code: 'H1', name: 'History H1', price: 125, source: 'legacy_sql' });
  const noImage = await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-10' });
  assert.equal(noImage[0].image_url, '');
  seedChange(database, { id: 'history-image', date: '2026-09-02', code: 'H1', name: 'History H1 updated', price: 130, image: 'https://history.example/h1.jpg', source: 'legacy_sql' });
  const withImage = await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-10' });
  assert.equal(withImage[0].image_url, 'https://history.example/h1.jpg');
});

test('materializer is deterministic, preserves signed/image/variant state, and excludes disabled rows', async () => {
  const database = new SqliteD1();
  seedChange(database, { id: 'materialize-a', date: '2026-09-11', code: 'A', variant: 'regular', name: 'A', price: -1, image: 'https://example.test/a.jpg' });
  seedChange(database, { id: 'materialize-b', date: '2026-09-11', code: 'AP', variant: 'ap-variant-1', name: 'AP one', price: 120, enabled: 0, order: 2 });
  const first = await materializeMenuVersion(database, { vendor: '蔡老師', effectiveDate: '2026-09-11', clock: NOW });
  const second = await materializeMenuVersion(database, { vendor: '蔡老師', effectiveDate: '2026-09-11', clock: NOW });
  assert.equal(first.menuVersionId, second.menuVersionId);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_versions WHERE vendor = ? AND effective_date = ?', '蔡老師', '2026-09-11').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_items WHERE menu_version_id = ?', first.menuVersionId).count, 1);
  assert.deepEqual({ ...database.get('SELECT legacy_item_id, variant_key, price, image_url FROM menu_items WHERE menu_version_id = ?', first.menuVersionId) }, {
    legacy_item_id: 'A', variant_key: 'regular', price: -1, image_url: 'https://example.test/a.jpg'
  });
  assert.equal(database.get('SELECT enabled FROM menu_item_changes WHERE menu_item_change_id = ?', 'materialize-b').enabled, 0);
});

test('reviewed backfill writer inserts source rows once and never updates an existing row', async () => {
  const database = new SqliteD1();
  const row = {
    menu_item_change_id: 'imported-change', effective_date: '2026-09-01', vendor: '蔡老師',
    item_code: 'E', variant_key: '', item_name: 'E', price: 75, enabled: 1,
    image_url: '', note: '', display_order: 1, source_kind: 'legacy_sql',
    source_batch_id: null, source_table: 'bento_price', source_row: 1,
    source_record_id: 'bento_price:1'
  };
  assert.deepEqual(await backfillMenuItemChanges(database, [row]), {
    inserted: 1, alreadyEquivalent: 0, conflicts: []
  });
  assert.deepEqual(await backfillMenuItemChanges(database, [row]), {
    inserted: 0, alreadyEquivalent: 1, conflicts: []
  });
  await assert.rejects(
    backfillMenuItemChanges(database, [{ ...row, price: 76 }]),
    (error) => error.code === 'MENU_ITEM_CHANGE_BACKFILL_CONFLICT'
  );
  assert.equal(database.get('SELECT price FROM menu_item_changes WHERE menu_item_change_id = ?', 'imported-change').price, 75);
});

test('direct backfill writer validates persisted dates, prices, and ambiguous variants', async () => {
  const invalidRows = [
    {
      code: 'INVALID-DATE', date: '2026-02-30', price: 80,
      expected: 'MENU_CHANGE_EFFECTIVE_DATE_INVALID'
    },
    {
      code: 'MISSING-PRICE', date: '2026-09-11', price: undefined,
      expected: 'MENU_CHANGE_PRICE_INVALID'
    },
    {
      code: 'FRACTIONAL-PRICE', date: '2026-09-12', price: 80.5,
      expected: 'MENU_CHANGE_PRICE_INVALID'
    },
    {
      code: 'AP', date: '2026-09-13', price: 110, variant: '',
      expected: 'MENU_CHANGE_VARIANT_KEY_REQUIRED'
    }
  ];
  for (const [index, invalid] of invalidRows.entries()) {
    const database = new SqliteD1();
    const row = {
      menu_item_change_id: `invalid-direct-${index}`,
      effective_date: invalid.date,
      vendor: '蔡老師',
      item_code: invalid.code,
      variant_key: invalid.variant || '',
      item_name: invalid.code,
      price: invalid.price,
      enabled: 1,
      image_url: '',
      note: '',
      display_order: 1,
      source_kind: 'gas_compatibility',
      source_batch_id: null,
      source_table: 'Menu',
      source_row: index + 1,
      source_record_id: `invalid-direct-source-${index}`
    };
    await assert.rejects(
      backfillMenuItemChanges(database, [row]),
      (error) => error.code === invalid.expected
    );
    assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_item_changes').count, 0);
  }

  const database = new SqliteD1();
  assert.deepEqual(await backfillMenuItemChanges(database, [{
    menu_item_change_id: 'valid-direct-ap', effective_date: '2026-09-14',
    vendor: '蔡老師', item_code: 'AP', variant_key: 'ap-variant-1',
    item_name: 'AP one', price: -1, enabled: 1, image_url: '', note: '',
    display_order: 1, source_kind: 'gas_compatibility', source_batch_id: null,
    source_table: 'Menu', source_row: 1, source_record_id: 'valid-direct-ap-source'
  }]), { inserted: 1, alreadyEquivalent: 0, conflicts: [] });
});

test('Admin menu change API is append-only, Admin-only, View As-safe, and returns duplicate 409', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  const payload = {
    effective_date: '2026-09-11', vendor: '蔡老師', item_code: 'E', variant_key: '',
    item_name: 'E lunch', price: -1, enabled: true,
    image_url: 'https://example.test/e.jpg', note: 'signed correction'
  };
  const created = await call(database, '/api/admin/menu/changes', { method: 'POST', body: payload });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.change.source_kind, 'admin');
  assert.equal(created.body.change.updated_by_user_id, 'changes-admin');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = ?', 'MENU_ITEM_CHANGE_CREATED').count, 1);

  const duplicate = await call(database, '/api/admin/menu/changes', { method: 'POST', body: payload });
  assert.equal(duplicate.response.status, 409);
  assert.deepEqual(duplicate.body, { error: 'MENU_CHANGE_DUPLICATE' });

  for (const role of ['ProxyAdmin', 'User']) {
    const forbidden = await call(database, '/api/admin/menu/changes', { role, method: 'POST', body: payload });
    assert.equal(forbidden.response.status, 403, role);
  }
  const viewAs = await call(database, '/api/admin/menu/changes?viewAs=changes-user', { method: 'POST', body: { ...payload, item_code: 'S' } });
  assert.equal(viewAs.response.status, 403);
  assert.deepEqual(viewAs.body, { error: 'VIEW_AS_FORBIDDEN' });
  const viewAsRead = await call(database, '/api/admin/menu/changes?viewAs=changes-user');
  assert.equal(viewAsRead.response.status, 403);
  assert.deepEqual(viewAsRead.body, { error: 'VIEW_AS_FORBIDDEN' });

  const patch = await call(database, `/api/admin/menu/changes/${created.body.change.menu_item_change_id}`, { method: 'PATCH', body: { note: 'must not update' } });
  assert.equal(patch.response.status, 404);
  const list = await call(database, '/api/admin/menu/changes?itemCode=E');
  assert.equal(list.response.status, 200);
  assert.equal(list.body.changes[0].image_url, 'https://example.test/e.jpg');
  const preview = await call(database, '/api/admin/menu/preview?vendor=%E8%94%A1%E8%80%81%E5%B8%AB&targetDate=2026-09-11');
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.selectableItems[0].price, -1);
});

test('post-cutoff Admin overlay preserves unchanged compatibility baseline items', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedCompatibilityVersion(database, {
    id: 'baseline-live',
    rows: [
      { menuItemId: 'baseline-a', itemCode: 'A', itemName: 'A old', price: 10, sourceOrder: 1 },
      { menuItemId: 'baseline-b', itemCode: 'B', itemName: 'B old', price: 20, sourceOrder: 2 }
    ]
  });

  assert.deepEqual(
    (await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-11' }))
      .map((item) => item.item_name),
    ['A old', 'B old']
  );

  const created = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-11', vendor: '蔡老師', item_code: 'A',
      item_name: 'A changed', price: -11, enabled: true,
      image_url: 'https://example.test/a-changed.jpg', note: 'changed', display_order: 1
    }
  });
  assert.equal(created.response.status, 201);

  assert.deepEqual(
    (await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-11' }))
      .map((item) => [item.item_name, item.price, item.note, item.image_url]),
    [['A changed', -11, 'changed', 'https://example.test/a-changed.jpg'], ['B old', 20, '', '']]
  );
  const preview = await call(database, '/api/admin/menu/preview?vendor=%E8%94%A1%E8%80%81%E5%B8%AB&targetDate=2026-09-11');
  assert.equal(preview.response.status, 200);
  assert.deepEqual(preview.body.items.map((item) => [item.item_code, item.price]), [['A', -11], ['B', 20]]);

  const secondSameDate = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-11', vendor: '蔡老師', item_code: 'B',
      item_name: 'B changed', price: 22, enabled: true,
      image_url: '', note: 'same date change', display_order: 2
    }
  });
  assert.equal(secondSameDate.response.status, 201);
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM menu_versions WHERE vendor = ? AND effective_date = ?',
    '蔡老師', '2026-09-11'
  ).count, 1);
  assert.deepEqual(
    (await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-11' }))
      .map((item) => [item.item_name, item.price]),
    [['A changed', -11], ['B changed', 22]]
  );

  const laterB = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-12', vendor: '蔡老師', item_code: 'B',
      item_name: 'B later', price: 23, enabled: true,
      image_url: '', note: 'later change', display_order: 2
    }
  });
  assert.equal(laterB.response.status, 201);
  const addedC = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-12', vendor: '蔡老師', item_code: 'C',
      item_name: 'C added', price: 30, enabled: true,
      image_url: 'https://example.test/c.jpg', note: 'new item', display_order: 3
    }
  });
  assert.equal(addedC.response.status, 201);
  assert.deepEqual({ ...database.get(
    'SELECT legacy_item_id, item_name, price, variant_key, note, image_url, source_order FROM menu_items WHERE menu_version_id = ? AND legacy_item_id = ?',
    projectionVersionId('蔡老師', '2026-09-12'), 'C'
  ) }, {
    legacy_item_id: 'C', item_name: 'C added', price: 30, variant_key: '',
    note: 'new item', image_url: 'https://example.test/c.jpg', source_order: 3
  });
  assert.deepEqual(
    (await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-12' }))
      .map((item) => [item.item_name, item.price]),
    [['A changed', -11], ['B later', 23], ['C added', 30]]
  );

  const disabledA = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-13', vendor: '蔡老師', item_code: 'A',
      item_name: 'A disabled', price: -11, enabled: false,
      image_url: '', note: 'disabled', display_order: 1
    }
  });
  assert.equal(disabledA.response.status, 201);
  assert.deepEqual(
    (await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-13' }))
      .map((item) => item.legacy_item_id),
    ['B', 'C']
  );
  const resolved = await resolveEffectiveMenuState(database, {
    vendor: '蔡老師', targetDate: '2026-09-13'
  });
  assert.deepEqual(resolved.rows.map((row) => [row.item_code, row.enabled]), [
    ['A', false], ['B', true], ['C', true]
  ]);
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM menu_items WHERE menu_version_id = ?',
    'baseline-live'
  ).count, 2);
  assert.deepEqual({ ...database.get(
    'SELECT legacy_item_id, item_name, price FROM menu_items WHERE menu_version_id = ? AND legacy_item_id = ?',
    'baseline-live', 'A'
  ) }, { legacy_item_id: 'A', item_name: 'A old', price: 10 });
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM menu_items WHERE menu_version_id = ?',
    projectionVersionId('蔡老師', '2026-09-11')
  ).count, 2);
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM menu_items WHERE menu_version_id = ? AND legacy_item_id = ?',
    projectionVersionId('蔡老師', '2026-09-13'), 'A'
  ).count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_versions').count, 4);
});

test('post-cutoff overlay keeps compatibility variants distinct when one variant changes', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedCompatibilityVersion(database, {
    id: 'baseline-ap',
    rows: [
      {
        menuItemId: 'baseline-ap-1', itemCode: 'AP', variantKey: 'ap-variant-1',
        itemName: 'AP one old', price: 100, sourceOrder: 1
      },
      {
        menuItemId: 'baseline-ap-2', itemCode: 'AP', variantKey: 'ap-variant-2',
        itemName: 'AP two old', price: 120, sourceOrder: 2
      }
    ]
  });

  const created = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-11', vendor: '蔡老師', item_code: 'AP',
      variant_key: 'ap-variant-1', item_name: 'AP one changed', price: 101,
      enabled: true, image_url: 'https://example.test/ap-1.jpg', note: 'variant one',
      display_order: 1
    }
  });
  assert.equal(created.response.status, 201);

  const menu = await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-11' });
  assert.deepEqual(menu.map((item) => [item.variant_key, item.item_name, item.price]), [
    ['ap-variant-1', 'AP one changed', 101],
    ['ap-variant-2', 'AP two old', 120]
  ]);
  assert.equal(menu[0].menu_item_id, menu[0].selection_key);
  assert.equal(menu[1].menu_item_id, menu[1].selection_key);
  assert.notEqual(menu[0].menu_item_id, menu[1].menu_item_id);
  assert.equal(menu[0].menu_item_id.startsWith('menu-change-item_'), true);
  assert.equal(menu[1].menu_item_id.startsWith('menu-change-item_'), true);
  assert.deepEqual({ ...database.get(
    'SELECT legacy_item_id, variant_key, item_name, price FROM menu_items WHERE menu_version_id = ? AND variant_key = ?',
    projectionVersionId('蔡老師', '2026-09-11'), 'ap-variant-1'
  ) }, {
    legacy_item_id: 'AP', variant_key: 'ap-variant-1', item_name: 'AP one changed', price: 101
  });
  assert.deepEqual({ ...database.get(
    'SELECT legacy_item_id, variant_key, item_name, price FROM menu_items WHERE menu_version_id = ? AND variant_key = ?',
    projectionVersionId('蔡老師', '2026-09-11'), 'ap-variant-2'
  ) }, {
    legacy_item_id: 'AP', variant_key: 'ap-variant-2', item_name: 'AP two old', price: 120
  });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_items').count, 4);
});

test('all-disabled post-cutoff projection keeps the established empty-projection rejection', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedCompatibilityVersion(database, {
    id: 'baseline-only-item',
    rows: [{ menuItemId: 'baseline-only-a', itemCode: 'A', itemName: 'A old', price: 10, sourceOrder: 1 }]
  });

  const disabled = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-11', vendor: '蔡老師', item_code: 'A',
      item_name: 'A disabled', price: 10, enabled: false,
      image_url: '', note: 'disabled'
    }
  });
  assert.equal(disabled.response.status, 404);
  assert.deepEqual(disabled.body, { error: 'MENU_CHANGE_PROJECTION_EMPTY' });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_item_changes').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_items').count, 1);
});

test('complete post-cutoff overlay is shared by order-page reads and order validation', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedUser(database, { lineUserId: 'overlay-user', balance: 200 });
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-09-11', '蔡老師', 'A')
  `);
  seedCompatibilityVersion(database, {
    id: 'overlay-baseline',
    rows: [
      { menuItemId: 'overlay-a', itemCode: 'A', itemName: 'A old', price: 10, sourceOrder: 1 },
      { menuItemId: 'overlay-b', itemCode: 'B', itemName: 'B old', price: 20, sourceOrder: 2 }
    ]
  });
  const change = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-11', vendor: '蔡老師', item_code: 'A',
      item_name: 'A changed', price: 11, enabled: true, image_url: '', note: ''
    }
  });
  assert.equal(change.response.status, 201);

  const token = 'overlay-user-token';
  const pageResponse = await handleFormalRequest(
    request('/api/order-page?targetDate=2026-09-11', { token }),
    { DB: database },
    { fetchImpl: profileFetch({ token, lineUserId: 'overlay-user' }), now: new Date('2026-09-10T00:00:00.000Z') }
  );
  assert.equal(pageResponse.status, 200);
  const page = await pageResponse.json();
  assert.deepEqual(page.menu.map((item) => [item.legacy_item_id, item.item_name]), [
    ['A', 'A changed'], ['B', 'B old']
  ]);

  const orderResponse = await handleFormalRequest(
    request('/api/orders', {
      method: 'POST', token,
      body: {
        targetDate: '2026-09-11', pickupFloor: '1樓',
        items: [{ menu_item_id: page.menu[0].menu_item_id, quantity: 1 }], note: ''
      },
      headers: { 'Idempotency-Key': 'overlay-order-key' }
    }),
    { DB: database },
    { fetchImpl: profileFetch({ token, lineUserId: 'overlay-user' }), now: new Date('2026-09-10T00:00:00.000Z') }
  );
  assert.equal(orderResponse.status, 200);
  assert.equal(database.get('SELECT total_amount FROM orders WHERE user_id = ?', 'overlay-user').total_amount, 11);
  assert.equal(database.get('SELECT item_name_snapshot FROM order_items WHERE order_id = ?',
    (await orderResponse.clone().json()).orderId).item_name_snapshot, 'A changed');
});

test('pre-cutoff effective state remains SQL-only and historical projections stay immutable', async () => {
  const database = new SqliteD1();
  seedChange(database, {
    id: 'historical-sql-a', date: '2026-09-01', code: 'A', name: 'Historical A',
    price: 9, source: 'legacy_sql'
  });
  seedCompatibilityVersion(database, {
    id: 'future-baseline', date: '2026-09-11',
    rows: [{ menuItemId: 'future-b', itemCode: 'B', itemName: 'Future B', price: 20, sourceOrder: 1 }]
  });

  const resolved = await resolveEffectiveMenuState(database, {
    vendor: '蔡老師', targetDate: '2026-09-10'
  });
  assert.equal(resolved.authority, 'sql_historical');
  assert.equal(resolved.baselineVersion, null);
  assert.deepEqual(resolved.rows.map((row) => [row.item_code, row.price]), [['A', 9]]);
  assert.deepEqual((await getCustomerMenu(database, {
    vendor: '蔡老師', targetDate: '2026-09-10'
  })).map((item) => [item.legacy_item_id, item.price]), [['A', 9]]);
  await assert.rejects(
    materializeMenuVersion(database, { vendor: '蔡老師', effectiveDate: '2026-09-10', clock: NOW }),
    (error) => error.code === 'HISTORICAL_MENU_PROJECTION_IMMUTABLE'
  );
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_versions').count, 1);
});

test('Admin change and projection are atomic when projection fails', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  database.exec(`
    CREATE TRIGGER fail_menu_projection
    BEFORE INSERT ON menu_items
    BEGIN
      SELECT RAISE(ABORT, 'forced projection failure');
    END;
  `);
  const result = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-12', vendor: '蔡老師', item_code: 'E',
      item_name: 'E lunch', price: 80, enabled: true,
      image_url: 'https://example.test/e.jpg', note: ''
    }
  });
  assert.equal(result.response.status, 500);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_item_changes').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_versions').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_items').count, 0);
});

test('Admin requires an explicit variant for the known ambiguous AP identity', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  const invalid = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-12', vendor: '蔡老師', item_code: 'AP',
      item_name: 'ambiguous AP', price: 110, enabled: true,
      image_url: 'https://example.test/ap.jpg', note: ''
    }
  });
  assert.equal(invalid.response.status, 400);
  assert.deepEqual(invalid.body, { error: 'MENU_CHANGE_VARIANT_KEY_REQUIRED' });

  const valid = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-12', vendor: '蔡老師', item_code: 'AP',
      variant_key: 'ap-variant-1', item_name: 'AP one', price: 110, enabled: true,
      image_url: 'https://example.test/ap.jpg', note: ''
    }
  });
  assert.equal(valid.response.status, 201);
  assert.equal(valid.body.change.variant_key, 'ap-variant-1');
});

test('Admin rejects missing or invalid prices and impossible dates without coercion', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  for (const [index, price] of [undefined, '', '  ', null, 'NaN'].entries()) {
    const body = {
      effective_date: `2026-09-${String(12 + index).padStart(2, '0')}`,
      vendor: '蔡老師', item_code: `PRICE-${index}`, item_name: 'price test',
      enabled: true, image_url: '', note: ''
    };
    if (price !== undefined) body.price = price;
    const response = await call(database, '/api/admin/menu/changes', {
      method: 'POST', body
    });
    assert.equal(response.response.status, 400);
    assert.deepEqual(response.body, { error: 'MENU_CHANGE_PRICE_INVALID' });
  }
  const invalidDate = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-02-30', vendor: '蔡老師', item_code: 'DATE',
      item_name: 'date test', price: 0, enabled: true, image_url: '', note: ''
    }
  });
  assert.equal(invalidDate.response.status, 400);
  assert.deepEqual(invalidDate.body, { error: 'MENU_CHANGE_EFFECTIVE_DATE_INVALID' });

  const zero = await call(database, '/api/admin/menu/changes', {
    method: 'POST',
    body: {
      effective_date: '2026-09-20', vendor: '蔡老師', item_code: 'ZERO',
      item_name: 'zero price test', price: 0, enabled: true, image_url: '', note: ''
    }
  });
  assert.equal(zero.response.status, 201);
});

test('GAS backfill rejects impossible calendar dates', () => {
  assert.throws(() => buildGasCompatibilityChanges({
    rows: [{
      vendor: '蔡老師', effective_date: '2026-02-30', item_code: 'E',
      item_name: 'E', price: 80, enabled: true, source_record_id: 'gas-invalid-date'
    }]
  }), (error) => error.code === 'GAS_MENU_CHANGE_INVALID');
});

test('customer menu and order validation consume the materialized state from the same resolver', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'resolver-admin', role: 'Admin', balance: 0 });
  seedUser(database, { lineUserId: 'resolver-user', role: 'User', balance: 200 });
  database.run(`INSERT INTO calendar_settings (order_date, vendor, mode) VALUES ('2026-09-11', '蔡老師', 'A')`);
  seedChange(database, {
    id: 'resolver-change', date: '2026-09-11', code: 'E', name: 'Resolved E', price: 80,
    image: 'https://example.test/resolved-e.jpg', source: 'admin'
  });
  await materializeMenuVersion(database, { vendor: '蔡老師', effectiveDate: '2026-09-11', clock: NOW });
  const menu = await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-11' });
  assert.equal(menu[0].price, 80);
  assert.equal(menu[0].image_url, 'https://example.test/resolved-e.jpg');
  assert.equal(menu[0].menu_item_id.startsWith('menu-change-item_'), true);

  const orderResponse = await handleFormalRequest(
    request('/api/orders', {
      method: 'POST',
      token: 'resolver-user-token',
      body: {
        targetDate: '2026-09-11', pickupFloor: '1樓',
        items: [{ menu_item_id: menu[0].menu_item_id, quantity: 1 }], note: ''
      },
      headers: { 'Idempotency-Key': 'resolver-order-key' }
    }),
    { DB: database },
    {
      fetchImpl: profileFetch({ token: 'resolver-user-token', lineUserId: 'resolver-user' }),
      now: new Date('2026-09-10T00:00:00.000Z')
    }
  );
  assert.equal(orderResponse.status, 200);
  assert.equal(database.get('SELECT total_amount FROM orders WHERE user_id = ?', 'resolver-user').total_amount, 80);
});

test('order validation re-resolves backdated post-cutoff changes instead of trusting an older snapshot', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'backdated-user', role: 'User', balance: 200 });
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-09-14', '蔡老師', 'A')
  `);
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES ('live-20260914', '蔡老師', '2026-09-14')
  `);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, source_order
    ) VALUES ('live-b', 'live-20260914', 'B', 'Old B', 90, 1, 1)
  `);
  seedChange(database, {
    id: 'backdated-disable-b', date: '2026-09-12', code: 'B',
    name: 'B disabled', price: 90, enabled: 0, source: 'admin', sourceId: 'backdated-disable-b'
  });
  const response = await handleFormalRequest(
    request('/api/orders', {
      method: 'POST',
      token: 'backdated-user-token',
      body: {
        targetDate: '2026-09-14', pickupFloor: '1樓',
        items: [{ menu_item_id: 'live-b', quantity: 1 }], note: ''
      },
      headers: { 'Idempotency-Key': 'backdated-order-key' }
    }),
    { DB: database },
    {
      fetchImpl: profileFetch({ token: 'backdated-user-token', lineUserId: 'backdated-user' }),
      now: new Date('2026-09-13T00:00:00.000Z')
    }
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'MENU_ITEM_DISABLED' });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 0);
});
