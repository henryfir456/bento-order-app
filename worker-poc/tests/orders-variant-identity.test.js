import assert from 'node:assert/strict';
import { test } from 'node:test';

import { callOrderRoute, userProfile } from './helpers/order-fixtures.js';
import { seedOrderDatabase } from './helpers/order-fixtures.js';

const ORDER_DATE = '2026-10-27';
const NOW = new Date('2026-10-26T01:00:00.000Z');

// Shape of the formal 禾拾 menu: a projection version holding H2 BASE and H2 HALF,
// plus repeated normalized change rows for the same identity.
const seedSplitVariantMenu = () => {
  const database = seedOrderDatabase({ balance: 500 });
  database.run(`INSERT INTO vendors (vendor_id, name) VALUES ('vendor-heshi', '禾拾')`);
  database.run(`INSERT INTO calendar_settings (order_date, vendor, mode) VALUES (?, '禾拾', 'A')`, ORDER_DATE);
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES ('version-heshi', '禾拾', '2026-09-17')
  `);
  database.run(`
    INSERT INTO menu_items (menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name, price, enabled, source_order)
    VALUES ('item-h2-base', 'version-heshi', 'H2', 'BASE', '合成板豆腐', 100, 1, 22),
           ('item-h2-half', 'version-heshi', 'H2', 'HALF', '合成板豆腐(半飯)', 100, 1, 23)
  `);
  [
    ['change-base-1', 'BASE', '合成板豆腐', 22, '2026-09-17'],
    ['change-half-1', 'HALF', '合成板豆腐(半飯)', 23, '2026-09-17'],
    ['change-base-2', 'BASE', '合成板豆腐', 22, '2026-09-17'],
    ['change-half-2', 'HALF', '合成板豆腐(半飯)', 23, '2026-09-17'],
    ['change-half-3', 'HALF', '合成板豆腐(半飯)', 23, '2026-09-17']
  ].forEach(([id, variant, name, order, date]) => database.run(`
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, enabled, image_url, note, display_order,
      source_kind, source_record_id, identity_schema_version
    ) VALUES (?, ?, '禾拾', 'H2', ?, ?, 100, 1, '', '', ?, 'admin', ?, 2)
  `, id, date, variant, name, order, id));
  return database;
};

test('ordering a HALF variant stores its persisted menu item ID, not NULL', async () => {
  const database = seedSplitVariantMenu();
  const menu = await callOrderRoute(database, `/api/order-page?targetDate=${ORDER_DATE}`, { now: NOW }, userProfile());
  const items = menu.body.menu || [];
  const half = items.find((item) => item.variant_key === 'HALF');
  assert.ok(half, JSON.stringify(menu.body).slice(0, 400));

  const result = await callOrderRoute(database, '/api/orders', {
    method: 'POST',
    now: NOW,
    headers: { 'Idempotency-Key': 'variant-half' },
    body: {
      targetDate: ORDER_DATE,
      pickupFloor: '1樓',
      items: [{ menu_item_id: half.menu_item_id, quantity: 1 }]
    }
  }, userProfile());
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const line = database.get(`
    SELECT menu_item_id, legacy_item_id, item_name_snapshot FROM order_items
  `);
  assert.equal(line.menu_item_id, 'item-h2-half');
  assert.equal(line.item_name_snapshot, '合成板豆腐(半飯)');
});
