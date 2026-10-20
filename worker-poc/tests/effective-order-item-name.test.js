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

test('effective order item resolver shows effective menu labels only for verified stable identities', () => {
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

test('effective order item resolver does not infer identity from an old label and matching price', () => {
  const resolved = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2030-03-15',
    item: {
      item_name_snapshot: '風味便當',
      unit_price: 90,
      fallbackKey: 'synthetic-no-identity:1'
    },
    menuItems: [menuItem({
      legacyItemId: 'FLAVOR',
      name: 'A.風味便當',
      price: 90,
      vendor: '合成店家'
    })]
  });

  assert.equal(resolved.itemName, '風味便當');
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.resolutionStatus, 'not_found');
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

test('unresolved snapshots keep line-scoped identities so unknown menu matches cannot be merged', () => {
  const base = {
    vendor: '合成店家',
    orderDate: '2030-03-15',
    menuItems: [],
    item: {
      item_name_snapshot: '風味便當',
      unit_price: 90
    }
  };
  const first = resolveEffectiveOrderItemName({
    ...base,
    item: { ...base.item, fallbackKey: 'synthetic-order-a:1' }
  });
  const second = resolveEffectiveOrderItemName({
    ...base,
    item: { ...base.item, fallbackKey: 'synthetic-order-b:1' }
  });

  assert.equal(first.itemName, '風味便當');
  assert.equal(first.resolved, false);
  assert.equal(first.resolutionStatus, 'not_found');
  assert.notEqual(first.identityKey, second.identityKey);
});

test('a conflicting legacy item identity cannot be overridden by a matching old label and price', () => {
  const resolved = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2030-03-15',
    item: {
      legacy_item_id: 'OTHER-FLAVOR',
      item_name_snapshot: '風味便當',
      unit_price: 90,
      fallbackKey: 'synthetic-conflicting-line:1'
    },
    menuItems: [menuItem({
      legacyItemId: 'FLAVOR',
      name: 'A.風味便當',
      price: 90,
      vendor: '合成店家'
    })]
  });

  assert.equal(resolved.itemName, '風味便當');
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.resolutionStatus, 'not_found');
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

const apiCall = async (database, path, {
  token,
  lineUserId,
  displayName,
  now = new Date('2026-09-19T00:00:00.000Z')
} = {}) => {
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
      now
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

const seedSyntheticAliasRegressionHistory = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'synthetic-purchaser', displayName: '合成訂購者' });
  seedUser(database, { lineUserId: 'synthetic-admin', displayName: '合成管理者', role: 'Admin' });
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES
      ('version-synthetic-main-old', '合成店家', '2030-03-12'),
      ('version-synthetic-main-new', '合成店家', '2030-03-14'),
      ('version-synthetic-other', '另一合成店家', '2030-03-12')
  `);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name, price,
      enabled, source_order
    ) VALUES
      ('menu-synthetic-flavor-old', 'version-synthetic-main-old', 'FLAVOR', 'BASE', '風味便當', 92, 1, 1),
      ('menu-synthetic-flavor-plus', 'version-synthetic-main-old', 'FLAVOR', 'PLUS', '風味便當', 92, 1, 2),
      ('menu-synthetic-alt', 'version-synthetic-main-old', 'ALT-FLAVOR', 'BASE', 'A.風味便當', 92, 1, 3),
      ('menu-synthetic-box-old', 'version-synthetic-main-old', 'BOX', 'BASE', '方盒便當', 112, 1, 4),
      ('menu-synthetic-soup-old', 'version-synthetic-main-old', 'SOUP', 'BASE', '清湯', 51, 1, 5),
      ('menu-synthetic-flavor-new', 'version-synthetic-main-new', 'FLAVOR', 'BASE', 'A.風味便當', 99, 1, 1),
      ('menu-synthetic-box-new', 'version-synthetic-main-new', 'BOX', 'BASE', '方盒便當', 112, 1, 2),
      ('menu-synthetic-soup-new', 'version-synthetic-main-new', 'SOUP', 'BASE', '清湯', 51, 1, 3),
      ('menu-synthetic-flavor-other', 'version-synthetic-other', 'FLAVOR', 'BASE', 'A.風味便當', 105, 1, 1)
  `);
  const addOrder = (orderId, orderDate, vendor, pickupFloor, items) => {
    const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    database.run(`
      INSERT INTO orders (
        order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
        total_amount, status, created_by_user_id, created_auth_mode
      ) VALUES (?, 'synthetic-purchaser', '合成訂購者', ?, ?, ?, ?, 'COMPLETED', 'synthetic-purchaser', 'line')
    `, orderId, orderDate, vendor, pickupFloor, total);
    items.forEach((item, index) => database.run(`
      INSERT INTO order_items (
        order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
        quantity, unit_price, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, orderId, index + 1, item.menuItemId, item.legacyItemId, item.snapshot,
    item.quantity, item.price, item.quantity * item.price));
  };
  addOrder('order-synthetic-old-flavor', '2030-03-13', '合成店家', '1樓', [
    { menuItemId: 'menu-synthetic-flavor-old', legacyItemId: 'FLAVOR', snapshot: '風味便當', quantity: 24, price: 92 }
  ]);
  addOrder('order-synthetic-summary', '2030-03-14', '合成店家', '2樓', [
    { menuItemId: 'menu-synthetic-flavor-new', legacyItemId: 'FLAVOR', snapshot: '風味便當', quantity: 3, price: 99 },
    { menuItemId: 'menu-synthetic-box-new', legacyItemId: 'BOX', snapshot: '方盒便當', quantity: 4, price: 112 },
    { menuItemId: 'menu-synthetic-soup-new', legacyItemId: 'SOUP', snapshot: '清湯', quantity: 2, price: 51 }
  ]);
  addOrder('order-synthetic-other-identities', '2030-03-12', '合成店家', '3樓', [
    { menuItemId: 'menu-synthetic-flavor-plus', legacyItemId: 'FLAVOR', snapshot: '風味便當', quantity: 4, price: 92 },
    { menuItemId: 'menu-synthetic-alt', legacyItemId: 'ALT-FLAVOR', snapshot: 'A.風味便當', quantity: 2, price: 92 }
  ]);
  addOrder('order-synthetic-other-vendor', '2030-03-12', '另一合成店家', '4樓', [
    { menuItemId: 'menu-synthetic-flavor-other', legacyItemId: 'FLAVOR', snapshot: 'A.風味便當', quantity: 5, price: 105 }
  ]);
  return database;
};

test('Worker APIs recompute synthetic summary and ranking by vendor, stable identity, variant, and menu version', async () => {
  const database = seedSyntheticAliasRegressionHistory();
  const beforeItems = database.get(`SELECT SUM(quantity) AS quantity, SUM(subtotal) AS amount FROM order_items`);
  const summaryResult = await apiCall(
    database,
    '/api/admin/summary?date=2030-03-14',
    { lineUserId: 'synthetic-admin', displayName: '合成管理者', now: new Date('2030-03-17T00:00:00.000Z') }
  );
  assert.equal(summaryResult.response.status, 200);
  assert.equal(summaryResult.body.totalItems, 9);
  assert.equal(summaryResult.body.totalAmount, 847);
  const flavorRows = summaryResult.body.todayOrders.filter((row) => row.legacy_item_id === 'FLAVOR'
    || row.item_id === 'FLAVOR');
  assert.equal(flavorRows.length, 1);
  assert.equal(flavorRows[0].item_name, '風味便當');
  assert.equal(flavorRows[0].display_item_name, 'A.風味便當');
  assert.equal(flavorRows[0].item_name_resolved, true);
  assert.equal(flavorRows[0].item_name_resolution_status, 'resolved');

  const statsResult = await apiCall(
    database,
    '/api/orders/statistics?period=all',
    { lineUserId: 'synthetic-purchaser', displayName: '合成訂購者', now: new Date('2030-03-17T00:00:00.000Z') }
  );
  assert.equal(statsResult.response.status, 200);
  assert.equal(statsResult.body.totalPortions, 44);
  assert.equal(statsResult.body.totalOrderDays, 3);
  assert.equal(statsResult.body.totalMealTypes, 6);
  const sameVerifiedIdentity = statsResult.body.items.filter((item) => item.vendor === '合成店家'
    && item.variantKey === 'BASE'
    && item.name === 'A.風味便當'
    && JSON.parse(item.identityKey)[2] === 'FLAVOR');
  assert.equal(sameVerifiedIdentity.length, 1);
  assert.equal(sameVerifiedIdentity[0].portions, 27);
  assert.equal(sameVerifiedIdentity[0].resolved, true);
  assert.equal(statsResult.body.items.find((item) => item.vendor === '合成店家'
    && item.variantKey === 'BASE'
    && JSON.parse(item.identityKey)[2] === 'ALT-FLAVOR').portions, 2);
  assert.equal(statsResult.body.items.find((item) => item.vendor === '合成店家'
    && item.variantKey === 'PLUS').portions, 4);
  assert.equal(statsResult.body.items.find((item) => item.vendor === '另一合成店家').portions, 5);
  assert.equal(database.get(`SELECT SUM(quantity) AS quantity, SUM(subtotal) AS amount FROM order_items`).quantity, beforeItems.quantity);
  assert.equal(database.get(`SELECT SUM(quantity) AS quantity, SUM(subtotal) AS amount FROM order_items`).amount, beforeItems.amount);
});

test('Worker summary and statistics expose unresolved identity diagnostics without merging equal snapshots', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'synthetic-purchaser', displayName: '合成訂購者' });
  seedUser(database, { lineUserId: 'synthetic-admin', displayName: '合成管理者', role: 'Admin' });
  for (const [orderId, quantity] of [['order-unresolved-a', 1], ['order-unresolved-b', 2]]) {
    database.run(`
      INSERT INTO orders (
        order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
        total_amount, status, created_by_user_id, created_auth_mode
      ) VALUES (?, 'synthetic-purchaser', '合成訂購者', '2030-03-15', '合成店家', '1樓', ?, 'COMPLETED', 'synthetic-purchaser', 'line')
    `, orderId, quantity * 90);
    database.run(`
      INSERT INTO order_items (
        order_id, line_no, item_name_snapshot, quantity, unit_price, subtotal
      ) VALUES (?, 1, '未確認合成餐點', ?, 90, ?)
    `, orderId, quantity, quantity * 90);
  }
  const now = new Date('2030-03-17T00:00:00.000Z');
  const summary = await apiCall(database, '/api/admin/summary?date=2030-03-15', {
    lineUserId: 'synthetic-admin', displayName: '合成管理者', now
  });
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.items.length, 2);
  assert.ok(summary.body.todayOrders.every((row) => row.item_name_resolved === false
    && row.item_name_resolution_status === 'not_found'));
  assert.notEqual(summary.body.todayOrders[0].item_identity_key, summary.body.todayOrders[1].item_identity_key);

  const statistics = await apiCall(database, '/api/orders/statistics?period=all', {
    lineUserId: 'synthetic-purchaser', displayName: '合成訂購者', now
  });
  assert.equal(statistics.response.status, 200);
  assert.equal(statistics.body.totalPortions, 3);
  assert.equal(statistics.body.totalMealTypes, 2);
  assert.equal(statistics.body.items.length, 2);
  assert.ok(statistics.body.items.every((item) => item.resolved === false
    && item.resolutionStatus === 'not_found'));
});
