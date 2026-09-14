import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import {
  profileFetch,
  request,
  seedLedgerRow,
  seedUser
} from './helpers/formal-fixtures.js';

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
  seedUser(database, { lineUserId: 'user-2', employeeId: null, displayName: 'User Two', pickupFloor: '9樓' });
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, note, created_by_user_id
    ) VALUES
      ('summary-active', 'user-1', 'User One', '2026-09-08', 'Vendor A', '1樓', 80, 'ACTIVE', 'note', 'user-1'),
      ('summary-cancelled', 'user-2', 'User Two', '2026-09-08', 'Vendor A', '9樓', 90, 'CANCELLED', '', 'user-2')
  `);
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal
    ) VALUES ('summary-active', 1, 'A01', 'Bento A', 2, 40, 80)
  `);
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES
      ('summary-history', 'user-1', 'User One', '2026-09-07', 'Vendor A', '1樓', 40, 'COMPLETED', 'user-1', 'legacy_import'),
      ('summary-completed-current', 'user-1', 'User One', '2026-09-08', 'Vendor A', '1樓', 50, 'COMPLETED', 'user-1', 'legacy_import')
  `);
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal
    ) VALUES
      ('summary-history', 1, 'A02', 'Historical Bento', 1, 40, 40),
      ('summary-completed-current', 1, 'A03', 'Current Completed Bento', 1, 50, 50)
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
  assert.equal(user.response.status, 200);
  assert.equal(user.body.requesterRole, 'User');
  assert.equal(user.body.totalItems, 2);
  assert.equal(user.body.totalAmount, 80);
  assert.deepEqual(user.body.usersSummary, []);

  const userWithMemberBalances = await call(
    database,
    '/api/admin/summary?date=2026-09-08&includeMemberBalances=true',
    { token: 'user-token', lineUserId: 'user-1' }
  );
  assert.equal(userWithMemberBalances.response.status, 200);
  assert.deepEqual(userWithMemberBalances.body.usersSummary, []);
});

test('User, ProxyAdmin, and Admin all read order summaries while only Admin reads member balances', async () => {
  const database = seedSummary();
  const results = await Promise.all([
    call(database, '/api/admin/summary?date=2026-09-08&includeMemberBalances=true', {
      token: 'user-token',
      lineUserId: 'user-1'
    }),
    call(database, '/api/admin/summary?date=2026-09-08&includeMemberBalances=true', {
      token: 'proxy-token',
      lineUserId: 'proxy-1'
    }),
    call(database, '/api/admin/summary?date=2026-09-08&includeMemberBalances=true', {
      token: 'admin-token',
      lineUserId: 'admin-1'
    })
  ]);

  assert.deepEqual(results.map(({ response }) => response.status), [200, 200, 200]);
  assert.deepEqual(results.map(({ body }) => body.requesterRole), ['User', 'ProxyAdmin', 'Admin']);
  assert.deepEqual(results.slice(0, 2).map(({ body }) => body.usersSummary), [[], []]);
  assert.equal(results[2].body.usersSummary.length, 4);
});

test('historical summaries include completed orders while current summaries remain active-only', async () => {
  const database = seedSummary();
  const historical = await call(
    database,
    '/api/admin/summary?date=2026-09-07',
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  assert.equal(historical.response.status, 200);
  assert.equal(historical.body.todayOrders.length, 1);
  assert.equal(historical.body.todayOrders[0].status, 'COMPLETED');
  assert.equal(historical.body.todayOrders[0].readOnly, true);
  assert.equal(historical.body.totalItems, 1);
  assert.equal(historical.body.totalAmount, 40);

  const current = await call(
    database,
    '/api/admin/summary?date=2026-09-08',
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  assert.equal(current.response.status, 200);
  assert.equal(current.body.todayOrders.length, 1);
  assert.equal(current.body.todayOrders[0].order_id, 'summary-active');
  assert.equal(current.body.totalAmount, 80);
});

test('member balances are Admin-only, token-derived, and mapped to public member rows', async () => {
  const database = seedSummary();
  const admin = await call(
    database,
    '/api/admin/members/balances',
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  assert.equal(admin.response.status, 200);
  assert.equal(admin.body.success, true);
  assert.equal(admin.body.requesterRole, 'Admin');
  assert.deepEqual(admin.body.members.map((member) => ({
    userId: member.userId,
    employeeId: member.employeeId,
    name: member.name,
    floor: member.floor,
    balance: member.balance,
    role: member.role
  })), [
    { userId: 'user-1', employeeId: 'employee-user-1', name: 'User One', floor: '1樓', balance: 0, role: 'User' },
    { userId: 'user-2', employeeId: null, name: 'User Two', floor: '9樓', balance: 0, role: 'User' },
    { userId: 'admin-1', employeeId: 'employee-admin-1', name: 'admin-1', floor: '1樓', balance: 0, role: 'Admin' },
    { userId: 'proxy-1', employeeId: 'employee-proxy-1', name: 'proxy-1', floor: '1樓', balance: 0, role: 'ProxyAdmin' }
  ]);

  const user = await call(
    database,
    '/api/admin/members/balances',
    { token: 'user-token', lineUserId: 'user-1' }
  );
  assert.equal(user.response.status, 403);

  const unauthenticatedResponse = await handleFormalRequest(
    new Request('https://formal.test/api/admin/members/balances'),
    { DB: database },
    { fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-1' }) }
  );
  assert.equal(unauthenticatedResponse.status, 401);
  assert.deepEqual(await unauthenticatedResponse.json(), { error: 'AUTH_REQUIRED' });
});

test('member balance reads use latest sequenced ledger state with users.balance fallback', async () => {
  const database = seedSummary();
  database.run(`UPDATE users SET balance = 37 WHERE user_id = 'user-2'`);
  seedLedgerRow(database, {
    transactionId: 'member-history',
    userId: 'user-1',
    amount: 125,
    balanceAfter: 125
  });

  const admin = await call(
    database,
    '/api/admin/members/balances',
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  const rows = Object.fromEntries(admin.body.members.map((member) => [member.userId, member.balance]));
  assert.equal(rows['user-1'], 125);
  assert.equal(rows['user-2'], 37);

  const viewAs = await call(
    database,
    '/api/admin/summary?date=2026-09-08&includeMemberBalances=true&viewAs=user-1',
    { token: 'admin-token', lineUserId: 'admin-1' }
  );
  assert.equal(viewAs.response.status, 200);
  assert.equal(
    viewAs.body.usersSummary.find((member) => member.userId === 'user-1').balance,
    125
  );
});

test('member balance projection is batch-based rather than one ledger query per member', async () => {
  const database = seedSummary();
  const queries = [];
  const countedDatabase = {
    prepare(sql) {
      queries.push(sql);
      return database.prepare(sql);
    },
    batch(statements) {
      return database.batch(statements);
    }
  };
  const response = await handleFormalRequest(
    request('/api/admin/members/balances', { token: 'admin-token' }),
    { DB: countedDatabase },
    {
      fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-1' }),
      now: new Date('2026-09-08T00:00:00.000Z')
    }
  );
  assert.equal(response.status, 200);
  assert.equal(queries.filter((sql) => /SELECT u\.user_id[\s\S]*FROM users u/i.test(sql)).length, 1);
});
