import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  handleFormalRequest,
  profileFetch,
  request,
  seedUser,
  seedVendor
} from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-10-20T00:00:00.000Z');
const VENDOR = 'Synthetic History Bento';

const call = async (database, path, { method = 'GET', token, lineUserId, body } = {}) => {
  const response = await handleFormalRequest(
    request(path, { method, token, body }),
    { DB: database },
    { fetchImpl: profileFetch({ token, lineUserId, displayName: 'Synthetic Actor' }), now: NOW }
  );
  return { response, body: await response.json() };
};

const admin = { token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin' };
const vendorUser = { token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor' };

const seed = () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-history-vendor', name: VENDOR });
  seedVendor(database, { vendorId: 'synthetic-other-vendor', name: 'Synthetic Other Bento' });
  seedUser(database, { userId: 'synthetic-admin', lineUserId: admin.lineUserId, role: 'Admin' });
  seedUser(database, { userId: 'synthetic-vendor-user', lineUserId: vendorUser.lineUserId, employeeId: null });
  database.run(`INSERT INTO vendor_principals (user_id, principal_role, status) VALUES ('synthetic-vendor-user', 'Vendor', 'ACTIVE')`);
  database.run(`INSERT INTO vendor_memberships (user_id, vendor_id, status) VALUES ('synthetic-vendor-user', 'synthetic-history-vendor', 'ACTIVE')`);
  return database;
};

const addVersion = (database, { vendor = VENDOR, versionId, effectiveDate }) => {
  database.run('INSERT INTO menu_versions (menu_version_id, vendor, effective_date) VALUES (?, ?, ?)',
    versionId, vendor, effectiveDate);
  database.run(`
    INSERT INTO menu_items (menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name, price, enabled, source_order)
    VALUES (?, ?, 'A', 'BASE', 'Synthetic Meal', 90, 1, 1)
  `, `${versionId}-item`, versionId);
};

const addLegacyOrder = (database, { orderId, serviceDate, versionId, quantity = 1, vendorId = null }) => {
  const buyerId = `synthetic-buyer-${orderId}`;
  seedUser(database, { userId: buyerId, lineUserId: `synthetic-line-${buyerId}`, employeeId: `SYNTHETIC-${orderId}` });
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, vendor_id, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode, created_at, updated_at
    ) VALUES (?, ?, 'Synthetic Buyer', ?, ?, ?, '1樓', ?, 'ACTIVE', ?, 'line', ?, ?)
  `, orderId, buyerId, serviceDate, VENDOR, vendorId, quantity * 90, buyerId,
  `${serviceDate}T01:00:00.000Z`, `${serviceDate}T01:00:00.000Z`);
  database.run(`
    INSERT INTO order_items (order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal)
    VALUES (?, 1, ?, 'A', 'Synthetic Meal', ?, 90, ?)
  `, orderId, `${versionId}-item`, quantity, quantity * 90);
};

test('Admin previews and imports a vendor history; legacy days show as historically settled', async () => {
  const database = seed();
  addVersion(database, { versionId: 'v-sep', effectiveDate: '2026-09-01' });
  addVersion(database, { versionId: 'v-oct', effectiveDate: '2026-10-01' });
  addVersion(database, { versionId: 'v-future', effectiveDate: '2026-10-21' });
  addVersion(database, { vendor: 'Synthetic Other Bento', versionId: 'v-other', effectiveDate: '2026-10-01' });
  addLegacyOrder(database, { orderId: 'o1', serviceDate: '2026-09-15', versionId: 'v-sep', quantity: 2 });
  addLegacyOrder(database, { orderId: 'o2', serviceDate: '2026-10-05', versionId: 'v-oct' });
  addLegacyOrder(database, { orderId: 'o3', serviceDate: '2026-10-06', versionId: 'v-other' });

  const before = await call(database, '/api/vendor/orders?month=2026-10', vendorUser);
  assert.equal(before.response.status, 200, JSON.stringify(before.body));
  assert.deepEqual(before.body.days, []);

  const preview = await call(database, '/api/admin/vendor-history-import?vendorId=synthetic-history-vendor', admin);
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.versionCount, 2);
  assert.equal(preview.body.orderCount, 2);
  assert.equal(preview.body.dayCount, 2);
  assert.equal(preview.body.firstOrderDate, '2026-09-15');

  const stale = await call(database, '/api/admin/vendor-history-import', {
    ...admin, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: 3 }
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error, 'VENDOR_HISTORY_PREVIEW_STALE');

  const applied = await call(database, '/api/admin/vendor-history-import', {
    ...admin, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: 2 }
  });
  assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.importedVersions, 2);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_menu_version_mapping_events').count, 2);
  assert.equal(database.get(`SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'VENDOR_HISTORY_MAPPINGS_VERIFIED'`).count, 1);

  const again = await call(database, '/api/admin/vendor-history-import?vendorId=synthetic-history-vendor', admin);
  assert.equal(again.body.versionCount, 0);

  const october = await call(database, '/api/vendor/orders?month=2026-10', vendorUser);
  assert.equal(october.response.status, 200, JSON.stringify(october.body));
  assert.deepEqual(october.body.days.map((day) => day.serviceDate), ['2026-10-05']);
  const day = october.body.days[0];
  assert.equal(day.source, 'HISTORY');
  assert.equal(day.portionCount, 1);
  assert.equal(day.settlement.receivableTwd, 90);
  assert.equal(day.settlement.historicalSettledTwd, 90);
  assert.equal(day.settlement.unregisteredDifferenceTwd, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_day_snapshots').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_transfer_payments').count, 0);

  const september = await call(database, '/api/vendor/orders?month=2026-09', vendorUser);
  assert.equal(september.body.days[0].portionCount, 2);
});

test('a day with a canonical (live) order is not treated as historical', async () => {
  const database = seed();
  addVersion(database, { versionId: 'v-oct', effectiveDate: '2026-10-01' });
  addLegacyOrder(database, { orderId: 'legacy', serviceDate: '2026-10-05', versionId: 'v-oct' });
  addLegacyOrder(database, { orderId: 'live', serviceDate: '2026-10-05', versionId: 'v-oct', vendorId: 'synthetic-history-vendor' });
  const preview = await call(database, '/api/admin/vendor-history-import?vendorId=synthetic-history-vendor', admin);
  await call(database, '/api/admin/vendor-history-import', {
    ...admin, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: preview.body.versionCount }
  });
  const october = await call(database, '/api/vendor/orders?month=2026-10', vendorUser);
  const day = october.body.days.find((entry) => entry.serviceDate === '2026-10-05');
  assert.notEqual(day.source, 'HISTORY');
  assert.equal(day.settlement.historicalSettledTwd, 0);
  assert.equal(day.settlement.unregisteredDifferenceTwd, day.settlement.receivableTwd);
});

test('only an Admin with LINE can preview or import vendor history', async () => {
  const database = seed();
  addVersion(database, { versionId: 'v-oct', effectiveDate: '2026-10-01' });
  const asVendor = await call(database, '/api/admin/vendor-history-import?vendorId=synthetic-history-vendor', vendorUser);
  assert.equal(asVendor.response.status, 403);
  const write = await call(database, '/api/admin/vendor-history-import', {
    ...vendorUser, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: 1 }
  });
  assert.equal(write.response.status, 403);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_menu_version_mapping_events').count, 0);
});
