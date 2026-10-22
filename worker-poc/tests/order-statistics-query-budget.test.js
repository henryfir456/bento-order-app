import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteD1 } from './helpers/formal-db.js';
import {
  handleFormalRequest,
  profileFetch,
  request,
  seedMenuVersion,
  seedUser
} from './helpers/formal-fixtures.js';
import { HISTORICAL_MENU_VENDOR } from '../src/domain/menuItemChanges.js';

const NOW = new Date('2026-10-22T02:00:00.000Z');

class CountingD1 extends SqliteD1 {
  queryCount = 0;

  prepare(sql) {
    const statement = super.prepare(sql);
    const count = (execute) => (...args) => {
      this.queryCount += 1;
      return execute(...args);
    };
    const wrapBound = (bound) => ({
      first: count(bound.first),
      all: count(bound.all),
      run: count(bound.run)
    });
    return {
      bind: (...params) => wrapBound(statement.bind(...params)),
      first: count(statement.first),
      all: count(statement.all),
      run: count(statement.run)
    };
  }
}

const isoDate = (offsetDays) => {
  const date = new Date(Date.UTC(2026, 0, 1 + offsetDays));
  return date.toISOString().slice(0, 10);
};

const seedManyDates = (database, { vendor, dayCount, startOffset, menuItemPrefix }) => {
  seedMenuVersion(database, {
    menuVersionId: `version-${menuItemPrefix}`,
    vendor,
    effectiveDate: '2026-01-01'
  });
  for (let index = 0; index < 4; index += 1) {
    database.run(`
      INSERT INTO menu_items (
        menu_item_id, menu_version_id, legacy_item_id, item_name, price,
        enabled, note, image_url, source_order
      ) VALUES (?, ?, ?, ?, ?, 1, '', '', ?)
    `, `${menuItemPrefix}-${index}`, `version-${menuItemPrefix}`, `${menuItemPrefix}-code-${index}`,
    `Synthetic meal ${index}`, 80 + index, index + 1);
  }
  for (let day = 0; day < dayCount; day += 1) {
    const date = isoDate(startOffset + day);
    const orderId = `order-${menuItemPrefix}-${day}`;
    const menuItemId = `${menuItemPrefix}-${day % 4}`;
    database.run(`
      INSERT INTO orders (
        order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
        total_amount, status, created_by_user_id, created_auth_mode
      ) VALUES (?, 'user-1', 'Synthetic Buyer', ?, ?, '1樓', 80, 'COMPLETED', 'user-1', 'line')
    `, orderId, date, vendor);
    database.run(`
      INSERT INTO order_items (
        order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
        quantity, unit_price, subtotal
      ) VALUES (?, 1, ?, ?, ?, 1, 80, 80)
    `, orderId, menuItemId, `${menuItemPrefix}-code-${day % 4}`, `Synthetic meal ${day % 4}`);
  }
};

const seedDatabase = () => {
  const database = new CountingD1();
  seedUser(database, { lineUserId: 'user-1', displayName: 'Synthetic Buyer' });
  seedManyDates(database, { vendor: 'Vendor A', dayCount: 40, startOffset: 0, menuItemPrefix: 'modern' });
  seedManyDates(database, {
    vendor: HISTORICAL_MENU_VENDOR,
    dayCount: 40,
    startOffset: 100,
    menuItemPrefix: 'historical'
  });
  return database;
};

test('cached menu reads return exactly the same effective menu as per-date reads', async () => {
  const database = new SqliteD1();
  database.run(`
    INSERT INTO import_batches (batch_id, source_hash, importer_version, status)
    VALUES ('sql-menu-batch', 'sql-menu-source', 'legacy-sql-menu', 'REVIEWED')
  `);
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date, source_batch_id)
    VALUES
      ('sql-menu-202608', ?, '2026-08-01', 'sql-menu-batch'),
      ('sql-menu-202609', ?, '2026-09-01', 'sql-menu-batch'),
      ('gas-menu-20260915', ?, '2026-09-15', NULL),
      ('gas-menu-20261001', ?, '2026-10-01', NULL)
  `, HISTORICAL_MENU_VENDOR, HISTORICAL_MENU_VENDOR, HISTORICAL_MENU_VENDOR, HISTORICAL_MENU_VENDOR);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, enabled, source_order
    ) VALUES
      ('i-aug', 'sql-menu-202608', 'A1', 'August meal', 80, 1, 1),
      ('i-sep', 'sql-menu-202609', 'A1', 'September meal', 85, 1, 1),
      ('i-gas-sep', 'gas-menu-20260915', 'A2', 'Mid September meal', 90, 1, 1),
      ('i-gas-oct', 'gas-menu-20261001', 'A2', 'October meal', 95, 1, 1)
  `);
  const { getCustomerMenu } = await import('../src/domain/menu.js');
  const readCache = new Map();
  for (let offset = 0; offset < 75; offset += 1) {
    const targetDate = new Date(Date.UTC(2026, 7, 1 + offset)).toISOString().slice(0, 10);
    for (const vendor of [HISTORICAL_MENU_VENDOR, 'Vendor Without Menu']) {
      assert.deepEqual(
        await getCustomerMenu(database, { vendor, targetDate, readCache }),
        await getCustomerMenu(database, { vendor, targetDate }),
        `${vendor} ${targetDate}`
      );
    }
  }
});

test('statistics query count stays flat as order dates grow', async () => {
  const countFor = async (dayCount) => {
    const database = new CountingD1();
    seedUser(database, { lineUserId: 'user-1', displayName: 'Synthetic Buyer' });
    seedManyDates(database, { vendor: 'Vendor A', dayCount, startOffset: 0, menuItemPrefix: 'modern' });
    seedManyDates(database, {
      vendor: HISTORICAL_MENU_VENDOR,
      dayCount,
      startOffset: 100,
      menuItemPrefix: 'historical'
    });
    database.queryCount = 0;
    const response = await handleFormalRequest(
      request('/api/orders/statistics?period=all', { token: 'token-user' }),
      { DB: database },
      { fetchImpl: profileFetch({ token: 'token-user', lineUserId: 'user-1' }), now: NOW }
    );
    assert.equal(response.status, 200);
    return database.queryCount;
  };
  const small = await countFor(8);
  const large = await countFor(60);
  assert.ok(large - small <= 2, `query count grew from ${small} to ${large}`);
});

test('statistics D1 round trips do not grow with the number of distinct order dates and menu items', async () => {
  const database = seedDatabase();
  database.queryCount = 0;
  const response = await handleFormalRequest(
    request('/api/orders/statistics?period=all', { token: 'token-user' }),
    { DB: database },
    { fetchImpl: profileFetch({ token: 'token-user', lineUserId: 'user-1' }), now: NOW }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.totalPortions, 80);
  // 80 distinct vendor/date pairs and 8 distinct menu item IDs. Per-date and
  // per-item sequential lookups made this hundreds of D1 round trips, which
  // exceeds the client's 15 second deadline on the formal database.
  assert.ok(
    database.queryCount <= 25,
    `statistics used ${database.queryCount} D1 queries for 80 order dates`
  );
});
