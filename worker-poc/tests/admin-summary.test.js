import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const call = async (database, path, profile) => {
  const response = await handleFormalRequest(
    request(path, { token: profile.token }),
    { DB: database },
    { fetchImpl: profileFetch(profile), now: new Date('2026-09-08T00:00:00.000Z') }
  );
  return { response, body: await response.json() };
};

const seedSummary = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  seedUser(database, { lineUserId: 'proxy-1', role: 'ProxyAdmin' });
  seedUser(database, { lineUserId: 'user-1', displayName: 'User One', pickupFloor: '1樓' });
  seedUser(database, { lineUserId: 'user-2', displayName: 'User Two', pickupFloor: '9樓' });
  database.run(`
    INSERT INTO orders (
      order_id, line_user_id, order_date, vendor, pickup_floor, total_amount, status, note
    ) VALUES
      ('summary-active', 'user-1', '2026-09-08', 'Vendor A', '1樓', 80, 'ACTIVE', 'note'),
      ('summary-cancelled', 'user-2', '2026-09-08', 'Vendor A', '9樓', 90, 'CANCELLED', '')
  `);
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal
    ) VALUES ('summary-active', 1, 'A01', 'Bento A', 2, 40, 80)
  `);
  return database;
};

test('admin and proxy summary views aggregate active orders without leaking member balances', async () => {
  const database = seedSummary();
  const proxy = await call(
    database,
    '/api/admin/summary?date=2026-09-08&includeMemberBalances=true',
    { token: 'proxy-token', lineUserId: 'proxy-1' }
  );
  assert.equal(proxy.response.status, 200);
  assert.equal(proxy.body.totalItems, 2);
  assert.equal(proxy.body.totalAmount, 80);
  assert.equal(proxy.body.todayOrders.length, 1);
  assert.deepEqual(proxy.body.usersSummary, []);

  const admin = await call(
    database,
    '/api/admin/summary?date=2026-09-08&includeMemberBalances=true',
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  assert.equal(admin.response.status, 200);
  assert.equal(admin.body.usersSummary.length, 4);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ADMIN_SUMMARY_READ'").count, 1);

  const user = await call(
    database,
    '/api/admin/summary?date=2026-09-08',
    { token: 'user-token', lineUserId: 'user-1' }
  );
  assert.equal(user.response.status, 403);
});
