import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import {
  materializeMenuVersion,
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
