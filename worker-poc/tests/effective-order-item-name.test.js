import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createEffectiveOrderItemNameResolver,
  resolveEffectiveOrderItemName
} from '../src/domain/effectiveOrderItemNames.js';
import { handleFormalRequest } from './helpers/formal-fixtures.js';
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

test('known legacy menu code aliases resolve to the same canonical meal identity', () => {
  const legacyCode = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2030-03-15',
    item: { legacy_item_id: 'R', variant_key: 'BASE', item_name_snapshot: '風味便當' },
    menuItems: [menuItem({ legacyItemId: 'FR', variantKey: 'BASE', name: 'A.風味便當' })]
  });
  const canonicalCode = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2030-03-15',
    item: { legacy_item_id: 'FR', variant_key: 'BASE', item_name_snapshot: 'A.風味便當' },
    menuItems: [menuItem({ legacyItemId: 'FR', variantKey: 'BASE', name: 'A.風味便當' })]
  });

  assert.equal(legacyCode.resolved, true);
  assert.equal(legacyCode.itemName, 'A.風味便當');
  assert.equal(legacyCode.identityKey, canonicalCode.identityKey);
});

const seedCanonicalStatisticsHistory = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'canonical-statistics-user', displayName: '合成統計使用者' });
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES ('canonical-menu-old', '合成店家', '2030-03-01'),
           ('canonical-menu-new', '合成店家', '2030-03-10')
  `);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name, price, enabled, source_order
    ) VALUES
      ('canonical-r-old', 'canonical-menu-old', 'R', 'BASE', '風味便當', 90, 1, 1),
      ('canonical-b-old', 'canonical-menu-old', 'B', 'BASE', 'B.水煮低醣健康餐', 100, 1, 2),
      ('canonical-c-old', 'canonical-menu-old', 'C', 'BASE', 'C.每日特餐', 110, 1, 3),
      ('canonical-alt-old', 'canonical-menu-old', 'ALT', 'BASE', 'A.風味便當', 90, 1, 4),
      ('canonical-fr-new', 'canonical-menu-new', 'FR', 'BASE', 'A.風味便當', 95, 1, 1),
      ('canonical-b-new', 'canonical-menu-new', 'B', 'BASE', '水煮低醣健康餐', 105, 1, 2),
      ('canonical-c-new', 'canonical-menu-new', 'C', 'BASE', 'C.特餐', 115, 1, 3),
      ('canonical-alt-new', 'canonical-menu-new', 'ALT', 'BASE', 'A.風味便當', 95, 1, 4)
  `);
  const addOrder = (orderId, date, items) => {
    const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
    database.run(`
      INSERT INTO orders (
        order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
        total_amount, status, created_by_user_id, created_auth_mode
      ) VALUES (?, 'canonical-statistics-user', '合成統計使用者', ?, '合成店家', '1樓', ?, 'COMPLETED', 'canonical-statistics-user', 'line')
    `, orderId, date, total);
    items.forEach((item, index) => database.run(`
      INSERT INTO order_items (
        order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
        quantity, unit_price, subtotal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, orderId, index + 1, item.menuItemId, item.code, item.snapshot,
    item.quantity, item.price, item.quantity * item.price));
  };
  addOrder('canonical-order-old', '2030-03-05', [
    { menuItemId: 'canonical-r-old', code: 'R', snapshot: '風味便當', quantity: 2, price: 90 },
    { menuItemId: 'canonical-b-old', code: 'B', snapshot: 'B.水煮低醣健康餐', quantity: 1, price: 100 },
    { menuItemId: 'canonical-c-old', code: 'C', snapshot: 'C.每日特餐', quantity: 1, price: 110 },
    { menuItemId: 'canonical-alt-old', code: 'ALT', snapshot: 'A.風味便當', quantity: 3, price: 90 }
  ]);
  addOrder('canonical-order-new', '2030-03-12', [
    { menuItemId: 'canonical-fr-new', code: 'FR', snapshot: '風味便當', quantity: 4, price: 95 },
    { menuItemId: 'canonical-b-new', code: 'B', snapshot: 'B.水煮低醣健康餐', quantity: 2, price: 105 },
    { menuItemId: 'canonical-c-new', code: 'C', snapshot: '每日特餐', quantity: 3, price: 115 },
    { menuItemId: 'canonical-alt-new', code: 'ALT', snapshot: 'A.風味便當', quantity: 5, price: 95 }
  ]);
  return database;
};

test('statistics canonicalize A/B/C menu aliases for all, year, and month without merging duplicate labels or changing snapshots', async () => {
  const database = seedCanonicalStatisticsHistory();
  const snapshotsBefore = database.get(`
    SELECT COUNT(*) AS rowCount, GROUP_CONCAT(item_name_snapshot, '|') AS names,
           SUM(quantity) AS portions, SUM(subtotal) AS amount FROM order_items
  `);
  const results = [];
  for (const period of ['all', 'year', 'month']) {
    const result = await apiCall(database, `/api/orders/statistics?period=${period}`, {
      lineUserId: 'canonical-statistics-user',
      displayName: '合成統計使用者',
      now: new Date('2030-03-17T00:00:00.000Z')
    });
    assert.equal(result.response.status, 200);
    results.push(result.body);
  }

  for (const result of results) {
    assert.equal(result.totalPortions, 21);
    assert.equal(result.totalMealTypes, 4, 'different legacy identity ALT stays separate from flavor FR');
    assert.equal(result.items.length, 4);
    assert.equal(result.items.find((item) => JSON.parse(item.identityKey)[2] === 'FR').portions, 6);
    assert.equal(result.items.find((item) => JSON.parse(item.identityKey)[2] === 'B').portions, 3);
    assert.equal(result.items.find((item) => JSON.parse(item.identityKey)[2] === 'C').portions, 4);
    assert.equal(result.items.find((item) => JSON.parse(item.identityKey)[2] === 'ALT').portions, 8);
    assert.equal(result.items.find((item) => JSON.parse(item.identityKey)[2] === 'FR').name, 'A.風味便當');
    assert.equal(result.items.find((item) => JSON.parse(item.identityKey)[2] === 'B').name, '水煮低醣健康餐');
    assert.equal(result.items.find((item) => JSON.parse(item.identityKey)[2] === 'C').name, 'C.特餐');
  }
  assert.deepEqual(results.map(({ totalPortions, totalMealTypes }) => [totalPortions, totalMealTypes]), [
    [21, 4], [21, 4], [21, 4]
  ]);
  assert.deepEqual(database.get(`
    SELECT COUNT(*) AS rowCount, GROUP_CONCAT(item_name_snapshot, '|') AS names,
           SUM(quantity) AS portions, SUM(subtotal) AS amount FROM order_items
  `), snapshotsBefore);
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

test('price cannot disambiguate multiple variants under one legacy item identity', () => {
  const resolved = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2030-03-15',
    item: {
      legacy_item_id: 'ITEM-SYNTHETIC',
      item_name_snapshot: '舊快照',
      unit_price: 80,
      fallbackKey: 'synthetic-unknown-variant:1'
    },
    menuItems: [
      menuItem({ menuItemId: 'menu-item-base', variantKey: 'BASE', price: 80 }),
      menuItem({ menuItemId: 'menu-item-plus', variantKey: 'PLUS', price: 90 })
    ]
  });

  assert.equal(resolved.itemName, '舊快照');
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.resolutionStatus, 'ambiguous');
  assert.equal(JSON.parse(resolved.identityKey).at(-1), 'synthetic-unknown-variant:1');
});

test('price cannot choose among multiple menu rows sharing one legacy identity and variant', () => {
  const resolved = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2030-03-15',
    item: {
      legacy_item_id: 'DUPLICATE-SYNTHETIC',
      item_name_snapshot: '重複碼舊快照',
      unit_price: 80,
      fallbackKey: 'synthetic-duplicate-legacy:1'
    },
    menuItems: [
      menuItem({ menuItemId: 'menu-item-duplicate-a', legacyItemId: 'DUPLICATE-SYNTHETIC', name: '合成候選甲', price: 80, variantKey: '' }),
      menuItem({ menuItemId: 'menu-item-duplicate-b', legacyItemId: 'DUPLICATE-SYNTHETIC', name: '合成候選乙', price: 30, variantKey: '' })
    ]
  });

  assert.equal(resolved.itemName, '重複碼舊快照');
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.resolutionStatus, 'ambiguous');
  assert.equal(JSON.parse(resolved.identityKey).at(-1), 'synthetic-duplicate-legacy:1');
});

test('an explicit variant cannot let price choose between duplicate menu identities', () => {
  const resolved = resolveEffectiveOrderItemName({
    vendor: '合成店家',
    orderDate: '2030-03-15',
    item: {
      legacy_item_id: 'DUPLICATE-SYNTHETIC',
      variant_key: 'BASE',
      item_name_snapshot: '重複碼舊快照',
      unit_price: 80,
      fallbackKey: 'synthetic-duplicate-legacy-base:1'
    },
    menuItems: [
      menuItem({ menuItemId: 'menu-item-duplicate-base-a', legacyItemId: 'DUPLICATE-SYNTHETIC', name: '合成候選甲', price: 80, variantKey: 'BASE' }),
      menuItem({ menuItemId: 'menu-item-duplicate-base-b', legacyItemId: 'DUPLICATE-SYNTHETIC', name: '合成候選乙', price: 30, variantKey: 'BASE' })
    ]
  });

  assert.equal(resolved.itemName, '重複碼舊快照');
  assert.equal(resolved.resolved, false);
  assert.equal(resolved.resolutionStatus, 'ambiguous');
  assert.equal(JSON.parse(resolved.identityKey).at(-1), 'synthetic-duplicate-legacy-base:1');
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
      ('menu-synthetic-flavor-plus', 'version-synthetic-main-old', 'FLAVOR', 'PLUS', '風味便當', 95, 1, 2),
      ('menu-synthetic-alt', 'version-synthetic-main-old', 'ALT-FLAVOR', 'BASE', 'A.風味便當', 92, 1, 3),
      ('menu-synthetic-box-old', 'version-synthetic-main-old', 'BOX', 'BASE', '方盒便當', 112, 1, 4),
      ('menu-synthetic-soup-old', 'version-synthetic-main-old', 'SOUP', 'BASE', '清湯', 51, 1, 5),
      ('menu-synthetic-duplicate-a', 'version-synthetic-main-old', 'DUPLICATE-SYNTHETIC', '', '合成候選甲', 80, 1, 6),
      ('menu-synthetic-duplicate-b', 'version-synthetic-main-old', 'DUPLICATE-SYNTHETIC', '', '合成候選乙', 30, 1, 7),
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
  addOrder('order-synthetic-unknown-variant', '2030-03-13', '合成店家', '5樓', [
    { menuItemId: null, legacyItemId: 'FLAVOR', snapshot: '風味便當', quantity: 6, price: 92 }
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
  addOrder('order-synthetic-duplicate-legacy', '2030-03-12', '合成店家', '6樓', [
    { menuItemId: null, legacyItemId: 'DUPLICATE-SYNTHETIC', snapshot: '重複碼舊快照', quantity: 5, price: 80 },
    { menuItemId: null, legacyItemId: 'DUPLICATE-SYNTHETIC', snapshot: '重複碼舊快照', quantity: 2, price: 30 }
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
  assert.equal(statsResult.body.totalPortions, 57);
  assert.equal(statsResult.body.totalOrderDays, 3);
  assert.equal(statsResult.body.totalMealTypes, 9);
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
  const unresolvedVariant = statsResult.body.items.find((item) => item.resolutionStatus === 'ambiguous'
    && item.name === '風味便當');
  assert.equal(unresolvedVariant.name, '風味便當');
  assert.equal(unresolvedVariant.portions, 6);
  assert.equal(unresolvedVariant.variantKey, '');
  assert.equal(unresolvedVariant.resolved, false);
  const unresolvedDuplicateIdentity = statsResult.body.items.filter((item) => item.resolutionStatus === 'ambiguous'
    && item.name === '重複碼舊快照');
  assert.equal(unresolvedDuplicateIdentity.length, 2);
  assert.deepEqual(unresolvedDuplicateIdentity.map((item) => item.portions).sort(), [2, 5]);
  assert.notEqual(unresolvedDuplicateIdentity[0].identityKey, unresolvedDuplicateIdentity[1].identityKey);
  assert.ok(unresolvedDuplicateIdentity.every((item) => item.resolved === false));

  const ambiguousSummary = await apiCall(
    database,
    '/api/admin/summary?date=2030-03-13',
    { lineUserId: 'synthetic-admin', displayName: '合成管理者', now: new Date('2030-03-17T00:00:00.000Z') }
  );
  assert.equal(ambiguousSummary.response.status, 200);
  assert.equal(ambiguousSummary.body.totalItems, 30);
  assert.equal(ambiguousSummary.body.items.length, 2);
  assert.deepEqual(ambiguousSummary.body.todayOrders.map((row) => row.item_name_resolved), [true, false]);
  assert.equal(ambiguousSummary.body.todayOrders[1].item_name_resolution_status, 'ambiguous');

  const duplicateIdentitySummary = await apiCall(
    database,
    '/api/admin/summary?date=2030-03-12',
    { lineUserId: 'synthetic-admin', displayName: '合成管理者', now: new Date('2030-03-17T00:00:00.000Z') }
  );
  const duplicateIdentityRows = duplicateIdentitySummary.body.todayOrders.filter((row) => row.item_id === 'DUPLICATE-SYNTHETIC');
  assert.equal(duplicateIdentitySummary.response.status, 200);
  assert.equal(duplicateIdentityRows.length, 2);
  assert.ok(duplicateIdentityRows.every((row) => row.item_name_resolved === false
    && row.item_name_resolution_status === 'ambiguous'));
  assert.notEqual(duplicateIdentityRows[0].item_identity_key, duplicateIdentityRows[1].item_identity_key);
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
