import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createEffectiveOrderItemNameResolver,
  resolveEffectiveOrderItemName
} from '../src/domain/effectiveOrderItemNames.js';
import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const menuItem = ({
  menuItemId = 'menu-item-synthetic',
  legacyItemId = 'ITEM-SYNTHETIC',
  name = '蕃茄鷹豆泥',
  price = 80,
  variantKey = 'STANDARD',
  vendor = '合成店家'
} = {}) => ({
  menu_item_id: menuItemId,
  legacy_item_id: legacyItemId,
  item_name: name,
  price,
  variant_key: variantKey,
  enabled: true,
  vendor
});

test('effective order item resolver applies the single approved historical name map', () => {
  const cases = [
    ['番茄鷹豆泥', '蕃茄鷹豆泥'],
    ['C.每日特餐', 'C.特餐'],
    ['特餐', 'C.特餐'],
    ['風味便當', 'A.風味便當']
  ];

  for (const [snapshot, effectiveName] of cases) {
    const resolved = resolveEffectiveOrderItemName({
      vendor: '合成店家',
      orderDate: '2026-09-18',
      item: { legacy_item_id: 'ITEM-SYNTHETIC', item_name_snapshot: snapshot, unit_price: 80 },
      menuItems: [menuItem({ name: effectiveName })]
    });
    assert.equal(resolved.itemName, effectiveName);
    assert.equal(resolved.resolved, true);
  }
});

test('effective order item resolver matches stable identity and fails closed on ambiguity or vendor mismatch', () => {
  const direct = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2026-09-18',
    item: { menu_item_id: 'menu-item-synthetic', legacy_item_id: 'ITEM-SYNTHETIC', item_name_snapshot: '舊快照', unit_price: 80 },
    menuItems: [menuItem()]
  });
  assert.equal(direct.itemName, '蕃茄鷹豆泥');
  assert.equal(direct.variantKey, 'STANDARD');

  const ambiguous = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2026-09-18',
    item: { legacy_item_id: 'ITEM-SYNTHETIC', item_name_snapshot: '舊快照', unit_price: 80 },
    menuItems: [menuItem(), menuItem({ menuItemId: 'menu-item-other-variant', variantKey: 'PLUS' })]
  });
  assert.equal(ambiguous.itemName, '舊快照');
  assert.equal(ambiguous.resolved, false);
  const separateAmbiguousLine = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2026-09-18',
    item: {
      legacy_item_id: 'ITEM-SYNTHETIC',
      item_name_snapshot: '舊快照',
      unit_price: 80,
      fallbackKey: 'order-synthetic:2'
    },
    menuItems: [menuItem(), menuItem({ menuItemId: 'menu-item-other-variant', variantKey: 'PLUS' })]
  });
  assert.notEqual(ambiguous.identityKey, separateAmbiguousLine.identityKey);

  const vendorMismatch = resolveEffectiveOrderItemName({
    vendor: '另一合成店家',
    orderDate: '2026-09-18',
    item: { menu_item_id: 'menu-item-synthetic', item_name_snapshot: '舊快照', unit_price: 80 },
    menuItems: [menuItem()]
  });
  assert.equal(vendorMismatch.itemName, '舊快照');
  assert.equal(vendorMismatch.resolved, false);
});

test('database resolver fails closed when the snapshot legacy code conflicts with its stable menu item ID', async () => {
  const database = seedEffectiveNameHistory();
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name, price,
      enabled, source_order
    ) VALUES (
      'menu-item-synthetic-wrong', 'menu-version-synthetic-b-later',
      'ITEM-SYNTHETIC-WRONG', 'STANDARD', '錯誤候選餐點', 80, 1, 2
    )
  `);
  const resolveName = createEffectiveOrderItemNameResolver(database);
  const resolved = await resolveName({
    vendor: '禾拾',
    orderDate: '2026-09-19',
    item: {
      // This old menu ID is absent from the effective date's catalog, so a
      // stale conflicting legacy code would otherwise select the wrong row.
      menu_item_id: 'menu-item-synthetic-b',
      legacy_item_id: 'ITEM-SYNTHETIC-WRONG',
      item_name_snapshot: '原始合成快照',
      unit_price: 80,
      fallbackKey: 'order-conflict-synthetic:1'
    }
  });
  assert.equal(resolved.itemName, '原始合成快照');
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.vendor, '禾拾');
});

const seedEffectiveNameHistory = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'synthetic-purchaser', displayName: '合成訂購者' });
  seedUser(database, { lineUserId: 'synthetic-admin', displayName: '合成管理者', role: 'Admin' });

  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES ('menu-version-synthetic-a', '合成店家甲', '2026-09-17'),
           ('menu-version-synthetic-b', '禾拾', '2026-09-17'),
           ('menu-version-synthetic-b-later', '禾拾', '2026-09-19')
  `);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name,
      price, enabled, source_order
    ) VALUES
      ('menu-item-synthetic-a', 'menu-version-synthetic-a', 'ITEM-SYNTHETIC-A', 'STANDARD', '蕃茄鷹豆泥', 80, 1, 1),
      ('menu-item-synthetic-a-plus', 'menu-version-synthetic-a', 'ITEM-SYNTHETIC-A', 'PLUS', '蕃茄鷹豆泥', 80, 1, 2),
      ('menu-item-synthetic-b', 'menu-version-synthetic-b', 'ITEM-SYNTHETIC-B', 'STANDARD', '蕃茄鷹豆泥', 80, 1, 1),
      ('menu-item-synthetic-b-later', 'menu-version-synthetic-b-later', 'ITEM-SYNTHETIC-B', 'STANDARD', '最新合成餐點', 80, 1, 1)
  `);
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES
      ('order-synthetic-a', 'synthetic-purchaser', '合成訂購者', '2026-09-18', '合成店家甲', '1樓', 160, 'ACTIVE', 'synthetic-purchaser', 'line'),
      ('order-synthetic-b', 'synthetic-purchaser', '合成訂購者', '2026-09-18', '合十', '1樓', 80, 'COMPLETED', 'synthetic-purchaser', 'line'),
      ('order-synthetic-b-later', 'synthetic-purchaser', '合成訂購者', '2026-09-19', '禾拾', '1樓', 80, 'COMPLETED', 'synthetic-purchaser', 'line')
  `);
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    ) VALUES
      ('order-synthetic-a', 1, 'menu-item-synthetic-a', 'ITEM-SYNTHETIC-A', '番茄鷹豆泥', 1, 80, 80),
      ('order-synthetic-a', 2, 'menu-item-synthetic-a-plus', 'ITEM-SYNTHETIC-A', '番茄鷹豆泥', 1, 80, 80),
      ('order-synthetic-b', 1, 'menu-item-synthetic-b', 'ITEM-SYNTHETIC-B', '番茄鷹豆泥', 1, 80, 80),
      ('order-synthetic-b-later', 1, 'menu-item-synthetic-b-later', 'ITEM-SYNTHETIC-B', '舊品項快照', 1, 80, 80)
  `);
  return database;
};

const apiCall = async (database, path, { token, lineUserId, displayName } = {}) => {
  const accessToken = token || 'synthetic-access-token';
  const response = await handleFormalRequest(
    request(path, { token: accessToken }),
    { DB: database },
    {
      fetchImpl: profileFetch({
        token: accessToken,
        lineUserId,
        displayName
      }),
      now: new Date('2026-09-19T00:00:00.000Z')
    }
  );
  return { response, body: await response.json() };
};

test('admin summary API resolves the effective name consistently and keeps quantity, price, order, and accounting snapshots unchanged', async () => {
  const database = seedEffectiveNameHistory();
  const beforeItems = database.get(`SELECT SUM(quantity) AS quantity, SUM(subtotal) AS amount FROM order_items`);
  const beforeOrders = database.get(`SELECT COUNT(*) AS count, SUM(total_amount) AS amount FROM orders`);
  const { response, body: summary } = await apiCall(
    database,
    '/api/admin/summary?date=2026-09-18&includeMemberBalances=true',
    { lineUserId: 'synthetic-admin', displayName: '合成管理者' }
  );

  assert.equal(response.status, 200);
  assert.equal(summary.totalItems, 3);
  assert.equal(summary.totalAmount, 240);
  assert.deepEqual(summary.todayOrders.map((order) => order.item_name), [
    '番茄鷹豆泥', '番茄鷹豆泥', '番茄鷹豆泥'
  ]);
  assert.deepEqual(summary.todayOrders.map((order) => order.display_item_name), [
    '蕃茄鷹豆泥', '蕃茄鷹豆泥', '蕃茄鷹豆泥'
  ]);
  assert.equal(new Set(summary.todayOrders.map((order) => order.item_identity_key)).size, 3);
  assert.equal(database.get(`SELECT SUM(quantity) AS quantity, SUM(subtotal) AS amount FROM order_items`).quantity, beforeItems.quantity);
  assert.equal(database.get(`SELECT SUM(quantity) AS quantity, SUM(subtotal) AS amount FROM order_items`).amount, beforeItems.amount);
  assert.equal(database.get(`SELECT COUNT(*) AS count, SUM(total_amount) AS amount FROM orders`).count, beforeOrders.count);
  assert.equal(database.get(`SELECT COUNT(*) AS count, SUM(total_amount) AS amount FROM orders`).amount, beforeOrders.amount);
});

test('bento statistics API re-groups name aliases without merging vendors or variants and preserves portions and history amounts', async () => {
  const database = seedEffectiveNameHistory();
  const beforeItems = database.get(`SELECT SUM(quantity) AS quantity, SUM(unit_price * quantity) AS amount FROM order_items`);
  const { response, body: statistics } = await apiCall(
    database,
    '/api/orders/statistics?period=all',
    { lineUserId: 'synthetic-purchaser', displayName: '合成訂購者' }
  );

  assert.equal(response.status, 200);
  assert.equal(statistics.totalPortions, 4);
  assert.equal(statistics.totalMealTypes, 3, 'different vendor or variant identities remain separate meal types');
  const canonicalVendor = statistics.vendors.find(({ name }) => name === '禾拾');
  assert.equal(canonicalVendor.portions, 2);
  assert.equal(statistics.vendors.some(({ name }) => name === '合十'), false);
  const renamedItem = statistics.items.find(({ vendor }) => vendor === '禾拾');
  assert.equal(renamedItem.name, '最新合成餐點');
  assert.equal(renamedItem.portions, 2);
  assert.equal(new Set(statistics.items.map(({ identityKey }) => identityKey)).size, 3);
  assert.equal(database.get(`SELECT SUM(quantity) AS quantity, SUM(unit_price * quantity) AS amount FROM order_items`).quantity, beforeItems.quantity);
  assert.equal(database.get(`SELECT SUM(quantity) AS quantity, SUM(unit_price * quantity) AS amount FROM order_items`).amount, beforeItems.amount);
});
