import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildOrderSubmission } from '../../src/features/orders/orderSubmission.js';
import { formatSignedAmount } from '../../src/features/orders/amountFormat.js';
import {
  getWorkerSelectionKey,
  normalizeWorkerOrderMenu
} from '../../src/features/orders/orderSelection.js';
import { handleFormalRequest } from '../src/formalWorker.js';
import { getCustomerMenu } from '../src/domain/menu.js';
import { getOrderItemSelectionKey } from '../src/domain/ordersRead.js';
import { normalizeLegacyWorkbook } from '../scripts/lib/import-normalizer.mjs';
import { validateImport } from '../scripts/lib/import-validator.mjs';
import { readLegacySqlDump } from '../scripts/lib/legacy-sql-adapter.mjs';
import {
  buildHistoricalMenuSnapshots,
  reconcileHistoricalMenu
} from '../scripts/lib/historical-menu-reconstruction.mjs';
import { makeFormalWorkbook } from './fixtures/formal-workbook.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const repositoryRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const migrationsDirectory = join(repositoryRoot, 'worker-poc', 'migrations-formal');
const migrationNames = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const migrationSeven = readFileSync(
  join(migrationsDirectory, '0007_signed_menu_prices.sql'),
  'utf8'
);

const openPreSevenDatabase = () => {
  const database = new DatabaseSync(':memory:');
  migrationNames
    .filter((name) => name < '0007_signed_menu_prices.sql')
    .forEach((name) => database.exec(readFileSync(join(migrationsDirectory, name), 'utf8')));
  return database;
};

const seedSqlMenuDatabase = () => {
  const database = new SqliteD1();
  seedUser(database, {
    lineUserId: 'historical-menu-user',
    employeeId: 'HISTORICAL-MENU',
    displayName: 'Historical Menu User',
    pickupFloor: '1樓'
  });
  database.run(`
    INSERT INTO import_batches (batch_id, source_hash, importer_version, status)
    VALUES (?, ?, 'legacy-sql-menu', 'REVIEWED')
  `, 'sql-menu-batch', 'sql-menu-source');
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date, source_batch_id)
    VALUES
      ('sql-menu-202609', '蔡老師', '2026-09-01', 'sql-menu-batch'),
      ('gas-menu-20260902', '蔡老師', '2026-09-02', NULL)
  `);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, source_order
    ) VALUES
      ('sql-revert1', 'sql-menu-202609', 'revert1', 'Fee waiver', -1, 1, 1),
      ('gas-item', 'gas-menu-20260902', 'A95', 'Current menu', 95, 1, 1),
      ('gas-revert1', 'gas-menu-20260902', 'revert1', 'Current discount', -1, 1, 2)
  `);
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-09-01', '蔡老師', 'A'), ('2026-09-11', '蔡老師', 'A'), ('2026-09-14', '蔡老師', 'A')
  `);
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES ('historical-menu-order', 'historical-menu-user', 'Historical Menu User',
      '2026-09-01', '蔡老師', '1樓', 0, 'COMPLETED',
      'historical-menu-user', 'legacy_import')
  `);
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    ) VALUES ('historical-menu-order', 1, NULL, 'revert1', 'Fee waiver', 1, -1, -1)
  `);
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES ('live-menu-order', 'historical-menu-user', 'Historical Menu User',
      '2026-09-14', '蔡老師', '1樓', 95, 'ACTIVE',
      'historical-menu-user', 'line')
  `);
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    ) VALUES ('live-menu-order', 1, 'gas-item', 'A95', 'Current menu', 1, 95, 95)
  `);
  return database;
};

test('SQL historical menu reconciliation builds five cumulative versions and 88 signed items', async () => {
  const parsed = await readLegacySqlDump(new URL('../../gas/bento_script.sql', import.meta.url));
  const plan = buildHistoricalMenuSnapshots({
    facts: parsed.historicalMenuFacts,
    sourceHash: parsed.sourceHash
  });

  assert.deepEqual(plan.summary.periods, ['202304', '202502', '202607', '202608', '202609']);
  assert.equal(plan.summary.versionCount, 5);
  assert.equal(plan.summary.itemCount, 88);
  assert.equal(plan.summary.duplicateCount, 0);
  assert.equal(plan.summary.invalidCount, 0);
  assert.deepEqual(plan.summary.revert1, [-1, -1]);
  assert.equal(plan.snapshots.find((snapshot) => snapshot.period === '202608').items.length, 20);
  assert.equal(plan.snapshots.find((snapshot) => snapshot.period === '202609').items.length, 21);
  assert.equal(plan.menuItems.filter((item) => item.legacyItemId === 'revert1').length, 2);
  assert.ok(plan.menuItems
    .filter((item) => item.legacyItemId === 'revert1')
    .every((item) => item.price === -1));

  const emptyReconciliation = reconcileHistoricalMenu({ desired: plan });
  assert.deepEqual(emptyReconciliation.insertNew, { menuVersions: 5, menuItems: 88 });
  assert.deepEqual(emptyReconciliation.alreadyEquivalent, { menuVersions: 0, menuItems: 0 });
  assert.deepEqual(emptyReconciliation.conflicts, []);
  assert.equal(emptyReconciliation.mutationCount, 93);

  const first = plan.snapshots[0];
  const equivalent = reconcileHistoricalMenu({
    desired: { snapshots: [first] },
    existingVersions: [{ menuVersionId: 'existing-version', vendor: first.vendor, effectiveDate: first.effectiveDate }],
    existingItems: first.items.map((item) => ({
      menuVersionId: 'existing-version',
      legacyItemId: item.legacyItemId,
      itemName: item.itemName,
      price: item.price,
      enabled: 1,
      note: item.note,
      imageUrl: item.imageUrl
    }))
  });
  assert.deepEqual(equivalent.insertNew, { menuVersions: 0, menuItems: 0 });
  assert.deepEqual(equivalent.alreadyEquivalent, { menuVersions: 1, menuItems: first.items.length });

  const conflict = reconcileHistoricalMenu({
    desired: { snapshots: [first] },
    existingVersions: [{ menuVersionId: 'existing-version', vendor: first.vendor, effectiveDate: first.effectiveDate }],
    existingItems: [{
      menuVersionId: 'existing-version',
      legacyItemId: first.items[0].legacyItemId,
      itemName: first.items[0].itemName,
      price: first.items[0].price + 1,
      enabled: 1,
      note: first.items[0].note,
      imageUrl: first.items[0].imageUrl
    }]
  });
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(conflict.conflicts[0].effectiveDate, first.effectiveDate);
});

test('Menu validator accepts signed safe integers without changing order or ledger validation', () => {
  const normalized = normalizeLegacyWorkbook(makeFormalWorkbook(), {
    sourceHash: 'signed-menu-source',
    importerVersion: 'test-version'
  });
  normalized.Menu[0].price = -1;
  const validation = validateImport(normalized);
  assert.equal(validation.accepted.Menu[0].price, -1);
  assert.equal(validation.quarantine.some((item) => (
    item.entityType === 'Menu' && item.reasonCode === 'INVALID_MONEY'
  )), false);
});

test('0007 stores signed menu prices and keeps foreign keys and historical order guards intact', () => {
  const database = new SqliteD1();
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES ('signed-menu-version', '蔡老師', '2026-09-01')
  `);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, source_order
    ) VALUES ('signed-menu-item', 'signed-menu-version', 'revert1', 'Fee waiver', -1, 1)
  `);
  assert.equal(database.get('SELECT price FROM menu_items WHERE menu_item_id = ?', 'signed-menu-item').price, -1);
  assert.deepEqual(database.get('PRAGMA foreign_key_check'), undefined);
  assert.deepEqual(database.database.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(database.database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'trigger' AND name = 'order_items_historical_negative_money_guard'
  `).get());
});

test('0007 failure rolls back the table rebuild instead of leaving a partial schema', () => {
  const database = openPreSevenDatabase();
  database.exec(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES ('rollback-version', '蔡老師', '2026-09-01');
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, source_order
    ) VALUES ('rollback-item', 'rollback-version', 'A95', 'Bento', 95, 1);
  `);
  const beforeSchema = database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'menu_items'
  `).get().sql;
  database.exec('BEGIN');
  assert.throws(() => database.exec(`${migrationSeven}
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, source_order
    ) VALUES ('rollback-item', 'rollback-version', 'revert1', 'Fee waiver', -1, 2);
  `), /UNIQUE|constraint/i);
  database.exec('ROLLBACK');
  assert.equal(database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'menu_items'
  `).get().sql, beforeSchema);
  assert.equal(database.prepare('SELECT price FROM menu_items WHERE menu_item_id = ?').get('rollback-item').price, 95);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('historical SQL menu resolver wins through the cutoff and live resolver remains unchanged after it', async () => {
  const database = seedSqlMenuDatabase();
  const historicalMenus = await Promise.all([
    getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-01' }),
    getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-02' }),
    getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-10' })
  ]);
  for (const menu of historicalMenus) {
    assert.equal(menu[0].price, -1);
    assert.equal(menu[0].item_id, 'revert1');
  }
  const liveMenu = await getCustomerMenu(database, { vendor: '蔡老師', targetDate: '2026-09-11' });
  assert.deepEqual(liveMenu.map((item) => item.price), [95, -1]);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_versions WHERE vendor = ?', '蔡老師').count, 2);
  assert.equal(database.get('SELECT price FROM menu_items WHERE menu_item_id = ?', 'gas-item').price, 95);
});

test('order-page API serializes signed historical menu/order values and marks completed orders read-only', async () => {
  const database = seedSqlMenuDatabase();
  const response = await handleFormalRequest(
    request('/api/order-page?targetDate=2026-09-01'),
    { DB: database },
    {
      fetchImpl: profileFetch({ token: 'token-user', lineUserId: 'historical-menu-user' }),
      now: new Date('2026-09-14T01:00:00.000Z')
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.menu[0].price, -1);
  assert.equal(body.myOrder.items[0].unit_price, -1);
  assert.equal(body.myOrder.items[0].subtotal, -1);
  assert.equal(body.myOrder.readOnly, true);

  const normalizedMenu = normalizeWorkerOrderMenu(body.menu);
  assert.equal(body.myOrder.items[0].selection_key, 'revert1');
  assert.equal(normalizedMenu[0].item_id, 'revert1');
  assert.equal(getWorkerSelectionKey(body.myOrder.items[0]), normalizedMenu[0].item_id);
  assert.equal(body.myOrder.items[0].quantity, 1);

  const liveResponse = await handleFormalRequest(
    request('/api/order-page?targetDate=2026-09-14'),
    { DB: database },
    {
      fetchImpl: profileFetch({ token: 'token-user', lineUserId: 'historical-menu-user' }),
      now: new Date('2026-09-14T01:00:00.000Z')
    }
  );
  const liveBody = await liveResponse.json();
  assert.equal(liveResponse.status, 200);
  assert.equal(liveBody.myOrder.status, 'ACTIVE');
  assert.equal(liveBody.myOrder.readOnly, false);
});

test('historical selection keys do not collapse duplicate names and preserve live keys', () => {
  const duplicateNameMenu = normalizeWorkerOrderMenu([
    { menu_item_id: 'sql-A', item_id: 'A', selection_key: 'A', item_name: 'Same', price: 100 },
    { menu_item_id: 'sql-B', item_id: 'B', selection_key: 'B', item_name: 'Same', price: 100 }
  ]);
  assert.equal(getWorkerSelectionKey({ selection_key: 'B', item_id: 'B', item_name: 'Same' }), 'B');
  assert.equal(duplicateNameMenu.find((item) => item.item_id === 'B').item_id, 'B');
  assert.notEqual(getWorkerSelectionKey({ selection_key: null, item_id: 'Same', item_name: 'Same' }), 'A');
  assert.deepEqual(normalizeWorkerOrderMenu([
    { menu_item_id: 'live-canonical', item_id: 'A', item_name: 'Same', price: 100 }
  ]).map((item) => item.item_id), ['live-canonical']);
});

test('Worker historical matcher uses code plus semantic facts, including approved R alias', () => {
  const menu = [
    { menu_item_id: 'sql-A95', legacy_item_id: 'A95', item_name: 'A.風味便當', price: 100, selection_key: 'A95' },
    { menu_item_id: 'sql-B-half', legacy_item_id: 'B_half', item_name: 'B.水煮低醣健康餐', price: 100, selection_key: 'B_half' },
    { menu_item_id: 'sql-FR', legacy_item_id: 'FR', item_name: '免費加飯', price: 0, selection_key: 'FR' },
    { menu_item_id: 'sql-same-a', legacy_item_id: 'A', item_name: '相同名稱', price: 100, selection_key: 'A' },
    { menu_item_id: 'sql-same-b', legacy_item_id: 'B', item_name: '相同名稱', price: 100, selection_key: 'B' }
  ];
  assert.equal(getOrderItemSelectionKey({
    menu_item_id: null,
    legacy_item_id: 'A95',
    item_name_snapshot: 'A.風味便當',
    unit_price: 100
  }, menu), 'A95');
  assert.equal(getOrderItemSelectionKey({
    menu_item_id: null,
    legacy_item_id: 'B_half',
    item_name_snapshot: 'B.水煮低醣健康餐',
    unit_price: 100
  }, menu), 'B_half');
  assert.equal(getOrderItemSelectionKey({
    menu_item_id: null,
    legacy_item_id: 'R',
    item_name_snapshot: '免費加飯',
    unit_price: 0
  }, menu), 'FR');
  assert.equal(getOrderItemSelectionKey({
    menu_item_id: null,
    legacy_item_id: 'unknown',
    item_name_snapshot: '相同名稱',
    unit_price: 100
  }, menu), null);
  assert.equal(getOrderItemSelectionKey({
    menu_item_id: null,
    legacy_item_id: 'B',
    item_name_snapshot: '相同名稱',
    unit_price: 100
  }, menu), 'B');
});

test('historical order quantity mapping covers positive, half-size, and revert1 rows', () => {
  const menu = [
    { selection_key: 'A95', item_id: 'A95', menu_item_id: 'sql-A95' },
    { selection_key: 'B_half', item_id: 'B_half', menu_item_id: 'sql-B-half' },
    { selection_key: 'revert1', item_id: 'revert1', menu_item_id: 'sql-revert1' }
  ];
  const historicalOrder = [
    { selection_key: 'A95', quantity: 2 },
    { selection_key: 'B_half', quantity: 1 },
    { selection_key: 'revert1', quantity: 1 }
  ];
  const selected = Object.fromEntries(historicalOrder.map((item) => [getWorkerSelectionKey(item), item.quantity]));
  assert.deepEqual(menu.map((item) => selected[getWorkerSelectionKey(item)] || 0), [2, 1, 1]);
  assert.equal(historicalOrder.reduce((sum, item) => sum + item.quantity, 0), 4);
});

test('selected summary text uses 便當', () => {
  const appSource = readFileSync(join(repositoryRoot, 'src', 'App.jsx'), 'utf8');
  assert.match(appSource, /已選 <span[\s\S]*?份便當/);
  assert.doesNotMatch(appSource, /已選 <span[\s\S]*?份便購/);
});

test('live/unmarked menu resolver returns signed prices without historical provenance', async () => {
  const database = seedSqlMenuDatabase();
  const liveMenu = await getCustomerMenu(database, {
    vendor: '蔡老師',
    targetDate: '2026-09-11'
  });
  assert.deepEqual(liveMenu.map((item) => ({ item_id: item.item_id, price: item.price })), [
    { item_id: 'A95', price: 95 },
    { item_id: 'revert1', price: -1 }
  ]);
});

test('signed frontend arithmetic, display, and positive-price behavior remain exact', () => {
  const menu = [
    { item_id: 'revert1', item_name: 'Fee waiver', price: -1 },
    { item_id: 'A95', item_name: 'Bento', price: 95 }
  ];
  assert.equal(buildOrderSubmission({ menu, orderItems: { revert1: 1 } }).totalAmount, -1);
  assert.equal(buildOrderSubmission({ menu, orderItems: { revert1: 7 } }).totalAmount, -7);
  assert.equal(buildOrderSubmission({ menu, orderItems: { A95: 2 } }).totalAmount, 190);
  assert.equal(formatSignedAmount(-1), '-$1');
  assert.equal(formatSignedAmount(95), '$95');

  const orderPageSource = readFileSync(join(repositoryRoot, 'src', 'features', 'orders', 'OrderPage.jsx'), 'utf8');
  const confirmationSource = readFileSync(join(repositoryRoot, 'src', 'features', 'orders', 'OrderConfirmationModal.jsx'), 'utf8');
  assert.match(orderPageSource, /formatSignedAmount\(item\.price\)/);
  assert.match(confirmationSource, /formatSignedAmount\(item\.unit_price\)/);
  assert.doesNotMatch(orderPageSource, /Math\.max\s*\(\s*0\s*,\s*item\.price/);
  assert.doesNotMatch(confirmationSource, /Math\.abs\s*\(\s*item\.unit_price/);
});
