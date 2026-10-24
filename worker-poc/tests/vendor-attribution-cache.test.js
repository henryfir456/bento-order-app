import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureAttributionCache } from '../src/domain/attributionCache.js';
import { seedUser, seedVendor } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const cachedVendor = (db, orderId) => db.get(
  'SELECT vendor_id FROM vendor_order_vendor_attributions WHERE order_id = ?', orderId
)?.vendor_id ?? null;

const seed = () => {
  const db = new SqliteD1();
  seedVendor(db, { vendorId: 'cache-vendor', name: 'Cache Bento' });
  seedUser(db, { userId: 'cache-admin', lineUserId: 'cache-line-admin', role: 'Admin' });
  seedUser(db, { userId: 'cache-buyer', lineUserId: 'cache-line-buyer' });
  db.run("INSERT INTO menu_versions (menu_version_id, vendor, effective_date) VALUES ('cache-mv', 'Cache Bento', '2026-09-01')");
  db.run("INSERT INTO menu_items (menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name, price, enabled, source_order) VALUES ('cache-mi', 'cache-mv', 'A', 'BASE', 'Dish A', 100, 1, 1)");
  db.run(`INSERT INTO orders (order_id, user_id, order_date, vendor, status, total_amount, created_at, updated_at)
    VALUES ('cache-order', 'cache-buyer', '2026-09-10', 'Cache Bento', 'ACTIVE', 100, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z')`);
  db.run(`INSERT INTO order_items (order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal)
    VALUES ('cache-order', 1, 'cache-mi', 'A', 'Dish A', 1, 100, 100)`);
  return db;
};

test('legacy attribution cache stays empty until a mapping is reviewed, then refreshes lazily', async () => {
  const db = seed();
  assert.equal(await ensureAttributionCache(db), false);
  assert.equal(cachedVendor(db, 'cache-order'), null);

  db.run(`INSERT INTO vendor_menu_version_mapping_events (
    event_id, menu_version_id, revision, vendor_id, effective_date,
    mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at
  ) VALUES ('cache-event', 'cache-mv', 1, 'cache-vendor', '2026-09-01', 'VERIFIED',
    'MENU_VERSION_ID_EFFECTIVE_DATE', 'cache-admin', '2026-10-01T00:00:00.000Z')`);
  // Stale until the Worker rebuilds it, and the rebuild is a no-op afterwards.
  assert.equal(cachedVendor(db, 'cache-order'), null);
  assert.equal(await ensureAttributionCache(db), true);
  assert.equal(cachedVendor(db, 'cache-order'), 'cache-vendor');
  assert.equal(await ensureAttributionCache(db), false);

  db.run(`INSERT INTO vendor_menu_version_mapping_events (
    event_id, menu_version_id, revision, vendor_id, effective_date,
    mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at
  ) VALUES ('cache-revoke', 'cache-mv', 2, NULL, '2026-09-01', 'REVOKED',
    'MENU_VERSION_ID_EFFECTIVE_DATE', 'cache-admin', '2026-10-02T00:00:00.000Z')`);
  assert.equal(await ensureAttributionCache(db), true);
  assert.equal(cachedVendor(db, 'cache-order'), null);
});

test('direct assignments win over cached legacy rows and the cache matches the live view', async () => {
  const db = seed();
  db.run(`INSERT INTO vendor_menu_version_mapping_events (
    event_id, menu_version_id, revision, vendor_id, effective_date,
    mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at
  ) VALUES ('cache-event', 'cache-mv', 1, 'cache-vendor', '2026-09-01', 'VERIFIED',
    'MENU_VERSION_ID_EFFECTIVE_DATE', 'cache-admin', '2026-10-01T00:00:00.000Z')`);
  await ensureAttributionCache(db);
  const live = db.all('SELECT order_id, vendor_id FROM vendor_order_vendor_attributions_live ORDER BY order_id');
  const cached = db.all('SELECT order_id, vendor_id FROM vendor_order_vendor_attributions ORDER BY order_id');
  assert.deepEqual(cached, live);
});
