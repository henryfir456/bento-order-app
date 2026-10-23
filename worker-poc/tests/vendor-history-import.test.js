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

const addLegacyOrder = (database, { orderId, serviceDate, versionId, quantity = 1, vendorId = null, vendor = VENDOR, lines = null, status = 'ACTIVE' }) => {
  const buyerId = `synthetic-buyer-${orderId}`;
  seedUser(database, { userId: buyerId, lineUserId: `synthetic-line-${buyerId}`, employeeId: `SYNTHETIC-${orderId}` });
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, vendor_id, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode, created_at, updated_at
    ) VALUES (?, ?, 'Synthetic Buyer', ?, ?, ?, '1樓', ?, ?, ?, ?, ?, ?)
  `, orderId, buyerId, serviceDate, vendor, vendorId, quantity * 90, status, buyerId,
  status === 'COMPLETED' ? 'legacy_import' : 'line',
  `${serviceDate}T01:00:00.000Z`, `${serviceDate}T01:00:00.000Z`);
  (lines || [{ menuItemId: `${versionId}-item`, legacyItemId: 'A', name: 'Synthetic Meal' }]).forEach((line, index) => {
    database.run(`
      INSERT INTO order_items (order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal)
      VALUES (?, ?, ?, ?, ?, ?, 90, ?)
    `, orderId, index + 1, line.menuItemId, line.legacyItemId, line.name, quantity, quantity * 90);
  });
};

test('Admin previews and imports a vendor history; legacy days show as historically settled', async () => {
  const database = seed();
  addVersion(database, { versionId: 'v-sep', effectiveDate: '2026-09-01' });
  addVersion(database, { versionId: 'v-oct', effectiveDate: '2026-10-01' });
  addVersion(database, { versionId: 'v-future', effectiveDate: '2026-10-21' });
  addVersion(database, { vendor: 'Synthetic Other Bento', versionId: 'v-other', effectiveDate: '2026-10-01' });
  addLegacyOrder(database, { orderId: 'o1', serviceDate: '2026-09-15', versionId: 'v-sep', quantity: 2 });
  addLegacyOrder(database, { orderId: 'o2', serviceDate: '2026-10-05', versionId: 'v-oct' });
  addLegacyOrder(database, { orderId: 'o3', serviceDate: '2026-10-06', versionId: 'v-other', vendor: 'Synthetic Other Bento' });

  const before = await call(database, '/api/vendor/orders?month=2026-10', vendorUser);
  assert.equal(before.response.status, 200, JSON.stringify(before.body));
  assert.deepEqual(before.body.days, []);

  const preview = await call(database, '/api/admin/vendor-history-import?vendorId=synthetic-history-vendor', admin);
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.versionCount, 2);
  assert.equal(preview.body.orderCount, 2);
  assert.equal(preview.body.dayCount, 2);
  assert.equal(preview.body.nameCount, 1);
  assert.equal(preview.body.firstOrderDate, '2026-09-15');

  const stale = await call(database, '/api/admin/vendor-history-import', {
    ...admin, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: 3, expectedNames: 1 }
  });
  assert.equal(stale.response.status, 409);
  assert.equal(stale.body.error, 'VENDOR_HISTORY_PREVIEW_STALE');

  const applied = await call(database, '/api/admin/vendor-history-import', {
    ...admin, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: 2, expectedNames: 1 }
  });
  assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.importedVersions, 2);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_menu_version_mapping_events').count, 2);
  assert.equal(database.get(`SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'VENDOR_HISTORY_MAPPINGS_VERIFIED'`).count, 1);

  const again = await call(database, '/api/admin/vendor-history-import?vendorId=synthetic-history-vendor', admin);
  assert.equal(again.body.versionCount, 0);
  assert.equal(again.body.nameCount, 0);
  assert.equal(again.body.orderCount, 0);

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
    ...admin, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: preview.body.versionCount, expectedNames: preview.body.nameCount }
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

test('legacy orders under the shop name count in full, even with unverified lines', async () => {
  const database = seed();
  addVersion(database, { versionId: 'v-oct', effectiveDate: '2026-10-01' });
  addVersion(database, { vendor: 'Synthetic Other Bento', versionId: 'v-other', effectiveDate: '2026-10-01' });
  // Verified line only.
  addLegacyOrder(database, { orderId: 'verified', serviceDate: '2026-10-13', versionId: 'v-oct' });
  // One verified line plus one line with no menu identity: previously dropped whole.
  addLegacyOrder(database, { orderId: 'mixed', serviceDate: '2026-10-13', versionId: 'v-oct', lines: [
    { menuItemId: 'v-oct-item', legacyItemId: 'A', name: 'Synthetic Meal' },
    { menuItemId: null, legacyItemId: 'H2', name: 'Synthetic Half Rice' }
  ] });
  // No menu identity at all.
  addLegacyOrder(database, { orderId: 'unverified', serviceDate: '2026-10-13', versionId: 'v-oct', lines: [
    { menuItemId: null, legacyItemId: 'H2', name: 'Synthetic Half Rice' }
  ] });
  // Same shop name but a line verified for another vendor: never attributed by name.
  database.run(`
    INSERT INTO vendor_menu_version_mapping_events (event_id, menu_version_id, revision, vendor_id, effective_date,
      mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at)
    VALUES ('other-map', 'v-other', 1, 'synthetic-other-vendor', '2026-10-01', 'VERIFIED',
      'MENU_VERSION_ID_EFFECTIVE_DATE', 'synthetic-admin', '2026-10-01T00:00:00.000Z')
  `);
  addLegacyOrder(database, { orderId: 'conflict', serviceDate: '2026-10-13', versionId: 'v-other' });
  // Another shop's legacy order.
  addLegacyOrder(database, { orderId: 'other-shop', serviceDate: '2026-10-13', versionId: 'v-oct', vendor: 'Synthetic Other Bento',
    lines: [{ menuItemId: null, legacyItemId: 'Z', name: 'Other Meal' }] });

  const preview = await call(database, '/api/admin/vendor-history-import?vendorId=synthetic-history-vendor', admin);
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.versionCount, 1);
  assert.equal(preview.body.nameCount, 1);
  const applied = await call(database, '/api/admin/vendor-history-import', {
    ...admin, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: 1, expectedNames: 1 }
  });
  assert.equal(applied.response.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.importedNames, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_legacy_name_mapping_events').count, 1);

  const october = await call(database, '/api/vendor/orders?month=2026-10', vendorUser);
  const day = october.body.days.find((entry) => entry.serviceDate === '2026-10-13');
  assert.equal(day.source, 'HISTORY');
  assert.equal(day.orderCount, 3);
  assert.equal(day.portionCount, 4);
  assert.equal(day.settlement.historicalSettledTwd, 360);
  assert.ok(day.items.some((item) => item.name.includes('Synthetic Half Rice')), JSON.stringify(day.items));

  const again = await call(database, '/api/admin/vendor-history-import?vendorId=synthetic-history-vendor', admin);
  assert.equal(again.body.nameCount, 0);
  const noop = await call(database, '/api/admin/vendor-history-import', {
    ...admin, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: 0, expectedNames: 0 }
  });
  assert.equal(noop.body.importedNames, 0);
});

test('name mapping events are append-only and need an Admin reviewer', async () => {
  const database = seed();
  assert.throws(() => database.run(`
    INSERT INTO vendor_legacy_name_mapping_events (event_id, vendor_name, revision, vendor_id, before_date, mapping_status, reviewed_by_user_id, reviewed_at)
    VALUES ('e1', ?, 1, 'synthetic-history-vendor', '2026-10-20', 'VERIFIED', 'synthetic-vendor-user', '2026-10-20T00:00:00.000Z')
  `, VENDOR), /VENDOR_LEGACY_NAME_MAPPING_INVALID/);
  database.run(`
    INSERT INTO vendor_legacy_name_mapping_events (event_id, vendor_name, revision, vendor_id, before_date, mapping_status, reviewed_by_user_id, reviewed_at)
    VALUES ('e2', ?, 1, 'synthetic-history-vendor', '2026-10-20', 'VERIFIED', 'synthetic-admin', '2026-10-20T00:00:00.000Z')
  `, VENDOR);
  assert.throws(() => database.run(`UPDATE vendor_legacy_name_mapping_events SET before_date = '2026-12-01'`), /APPEND_ONLY/);
  assert.throws(() => database.run('DELETE FROM vendor_legacy_name_mapping_events'), /APPEND_ONLY/);
});

test('completed legacy-import orders on past days count for the vendor, like the Admin summary', async () => {
  const database = seed();
  addVersion(database, { versionId: 'v-oct', effectiveDate: '2026-10-01' });
  addLegacyOrder(database, { orderId: 'live', serviceDate: '2026-10-13', versionId: 'v-oct' });
  addLegacyOrder(database, { orderId: 'done-1', serviceDate: '2026-10-13', versionId: 'v-oct', status: 'COMPLETED' });
  addLegacyOrder(database, { orderId: 'done-2', serviceDate: '2026-10-13', versionId: 'v-oct', quantity: 2, status: 'COMPLETED' });

  const preview = await call(database, '/api/admin/vendor-history-import?vendorId=synthetic-history-vendor', admin);
  assert.equal(preview.body.orderCount, 3, JSON.stringify(preview.body));
  await call(database, '/api/admin/vendor-history-import', {
    ...admin, method: 'POST', body: { vendorId: 'synthetic-history-vendor', expectedVersions: preview.body.versionCount, expectedNames: preview.body.nameCount }
  });

  const october = await call(database, '/api/vendor/orders?month=2026-10', vendorUser);
  const day = october.body.days.find((entry) => entry.serviceDate === '2026-10-13');
  assert.equal(day.orderCount, 3);
  assert.equal(day.portionCount, 4);
  assert.equal(day.settlement.receivableTwd, 360);
});
