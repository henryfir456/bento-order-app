import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest, profileFetch, request, seedUser, seedVendor } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-10-20T00:00:00.000Z');
const vendorUser = { token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor' };

test('the vendor month shows reviewed old order lines under the reviewed vendor and skips non-meal adjustments', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor', name: 'Synthetic Reviewed Bento' });
  seedUser(database, { userId: 'synthetic-admin', lineUserId: 'synthetic-line-admin', role: 'Admin' });
  seedUser(database, { userId: 'synthetic-vendor-user', lineUserId: vendorUser.lineUserId, employeeId: null });
  seedUser(database, { userId: 'synthetic-buyer', lineUserId: 'synthetic-line-buyer', employeeId: 'SYNTHETIC-BUYER' });
  database.run(`INSERT INTO vendor_principals (user_id, principal_role, status) VALUES ('synthetic-vendor-user', 'Vendor', 'ACTIVE')`);
  database.run(`INSERT INTO vendor_memberships (user_id, vendor_id, status) VALUES ('synthetic-vendor-user', 'synthetic-vendor', 'ACTIVE')`);
  // Recorded under another shop name with codes that match no menu.
  database.run(`
    INSERT INTO orders (order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode, created_at, updated_at)
    VALUES ('legacy-order', 'synthetic-buyer', 'Synthetic Buyer', '2026-08-18', 'Other Shop Name', '1樓',
      91, 'ACTIVE', 'synthetic-buyer', 'line', '2026-08-18T01:00:00.000Z', '2026-08-18T01:00:00.000Z')
  `);
  database.run(`
    INSERT INTO order_items (order_id, line_no, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal) VALUES
      ('legacy-order', 1, 'X9', '舊名稱餐點', 1, 90, 90),
      ('legacy-order', 2, 'FR1', '1元', 1, 1, 1)
  `);
  const call = (path) => handleFormalRequest(
    request(path, { token: vendorUser.token }),
    { DB: database },
    { fetchImpl: profileFetch({ ...vendorUser, displayName: 'Synthetic Vendor' }), now: NOW }
  ).then(async (response) => ({ response, body: await response.json() }));

  assert.deepEqual((await call('/api/vendor/orders?month=2026-08')).body.days, []);

  database.run(`
    INSERT INTO order_line_canonical_identities
      (order_id, line_no, revision, line_kind, vendor_id, item_code, variant_key, basis, reviewed_by_user_id, reviewed_at)
    VALUES
      ('legacy-order', 1, 1, 'MEAL', 'synthetic-vendor', 'X', 'BASE', 'TEST', 'synthetic-admin', '2026-10-23T00:00:00.000Z'),
      ('legacy-order', 2, 1, 'ADJUSTMENT', NULL, NULL, NULL, 'TEST', 'synthetic-admin', '2026-10-23T00:00:00.000Z')
  `);
  const { response, body } = await call('/api/vendor/orders?month=2026-08');
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.days.map((day) => day.serviceDate), ['2026-08-18']);
  const day = body.days[0];
  assert.equal(day.source, 'HISTORY');
  assert.equal(day.portionCount, 1);
  assert.deepEqual(day.items.map((item) => item.name), ['舊名稱餐點']);
});
