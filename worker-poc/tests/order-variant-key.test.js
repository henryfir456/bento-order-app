import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest, profileFetch, request, seedMenuVersion, seedUser, seedVendor } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-09-17T01:00:00.000Z');
const USER_ID = 'user-variant';
const LINE_USER_ID = 'line-user-variant';
const LINE_TOKEN = 'line-token-variant';

const call = async (database, path, options = {}) => {
  const response = await handleFormalRequest(
    request(path, { token: LINE_TOKEN, ...options }),
    { DB: database },
    { now: NOW, fetchImpl: profileFetch({ token: LINE_TOKEN, lineUserId: LINE_USER_ID, displayName: 'Variant User' }) }
  );
  return { response, body: await response.json() };
};

const addChange = (database, id, variant, name) => database.run(`
  INSERT INTO menu_item_changes (
    menu_item_change_id, effective_date, vendor, item_code, variant_key,
    item_name, price, enabled, image_url, note, display_order,
    source_kind, source_table, source_record_id, identity_schema_version
  ) VALUES (?, '2026-09-17', '禾拾', 'H2', ?, ?, 100, 1, '', '', 1, 'admin', 'test', ?, 2)
`, id, variant, name, id);

// A HALF variant that exists only as a menu change (its date has not been
// opened, so nothing is persisted in menu_items) must keep its variant on the order line.
test('order of a not-yet-persisted 半飯 variant stores and resolves its variant', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'vendor-variant', name: '禾拾' });
  seedUser(database, {
    userId: USER_ID, employeeId: '009922', lineUserId: LINE_USER_ID,
    displayName: 'Variant User', pickupFloor: '1樓', balance: 250
  });
  seedUser(database, { lineUserId: 'admin-variant', role: 'Admin' });
  seedMenuVersion(database, { menuVersionId: 'baseline-variant', vendor: '禾拾', effectiveDate: '2026-09-01' });
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name,
      price, enabled, note, image_url, source_order
    ) VALUES ('h2-base', 'baseline-variant', 'H2', 'BASE', '醬燒板豆腐', 100, 1, '', '', 1)
  `);
  addChange(database, 'change-base', 'BASE', '醬燒板豆腐');
  addChange(database, 'change-half', 'HALF', '醬燒板豆腐(半飯)');
  database.run(`INSERT INTO calendar_settings (order_date, vendor, mode) VALUES ('2026-09-22', '禾拾', 'A')`);

  const page = await call(database, '/api/order-page?targetDate=2026-09-22');
  assert.equal(page.response.status, 200);
  const half = page.body.menu.find((item) => item.variant_key === 'HALF');
  assert.ok(half, 'HALF row is offered');

  const created = await call(database, '/api/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'order-variant-half' },
    body: { targetDate: '2026-09-22', pickupFloor: '1樓', items: [{ menu_item_id: half.menu_item_id, quantity: 1 }] }
  });
  assert.equal(created.response.status, 200);
  const line = database.get('SELECT menu_item_id, legacy_item_id, variant_key FROM order_items WHERE order_id = ?', created.body.orderId);
  assert.equal(line.legacy_item_id, 'H2');
  assert.equal(line.variant_key, 'HALF');

  const summaryResponse = await handleFormalRequest(
    request('/api/admin/summary?date=2026-09-22', { token: 'admin-token' }),
    { DB: database },
    { now: NOW, fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-variant' }) }
  );
  const summary = { body: await summaryResponse.json() };
  const row = summary.body.todayOrders.find((order) => order.order_id === created.body.orderId);
  assert.equal(row.item_name_resolved, true);
  assert.equal(row.item_variant_key, 'HALF');
});
