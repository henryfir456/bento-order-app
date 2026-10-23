import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleFormalRequest, profileFetch, request, seedUser, seedVendor } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-10-28T12:00:00.000Z');
const VENDOR = 'Synthetic Perf Bento';
// Guards the vendor month read against going back to one sequential D1 round
// trip chain per day (it took ~11 s for a month in production).
test('vendor month reads stay batched and build days concurrently', async () => {
  const db = new SqliteD1();
  seedVendor(db, { vendorId: 'bench-vendor', name: VENDOR });
  seedUser(db, { userId: 'bench-vu', lineUserId: 'bench-line-vu', employeeId: null });
  db.run(`INSERT INTO vendor_principals (user_id, principal_role, status) VALUES ('bench-vu', 'Vendor', 'ACTIVE')`);
  db.run(`INSERT INTO vendor_memberships (user_id, vendor_id, status) VALUES ('bench-vu', 'bench-vendor', 'ACTIVE')`);
  db.run('INSERT INTO menu_versions (menu_version_id, vendor, effective_date) VALUES (?, ?, ?)', 'bv', VENDOR, '2026-09-01');
  for (const [i, code] of ['A','B','C','D'].entries()) db.run(`INSERT INTO menu_items (menu_item_id, menu_version_id, legacy_item_id, variant_key, item_name, price, enabled, source_order) VALUES (?, 'bv', ?, 'BASE', ?, 100, 1, ?)`, `bv-${code}`, code, `Dish ${code}`, i+1);
  let n = 0;
  for (let d = 1; d <= 28; d++) {
    const date = `2026-10-${String(d).padStart(2,'0')}`;
    if ([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())) continue;
    db.run(`INSERT OR IGNORE INTO calendar_settings (order_date, vendor, mode) VALUES (?, ?, 'A')`, date, VENDOR);
    for (let k = 0; k < 5; k++) {
      n++; const buyer = `bench-b${n}`;
      seedUser(db, { userId: buyer, lineUserId: `bench-line-${buyer}`, employeeId: `BENCH-${n}` });
      db.run(`INSERT INTO orders (order_id, user_id, display_name_snapshot, order_date, vendor, vendor_id, pickup_floor, total_amount, status, created_by_user_id, created_auth_mode, created_at, updated_at) VALUES (?, ?, 'B', ?, ?, 'bench-vendor', '1樓', 100, 'ACTIVE', ?, 'line', ?, ?)`, `bo${n}`, buyer, date, VENDOR, buyer, `${date}T01:00:00.000Z`, `${date}T01:00:00.000Z`);
      const code = ['A','B','C','D'][k%4];
      db.run(`INSERT INTO order_items (order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal) VALUES (?, 1, ?, ?, ?, 1, 100, 100)`, `bo${n}`, `bv-${code}`, code, `Dish ${code}`);
    }
  }
  // Simulated D1 with a short delay per statement, counting statements and
  // the highest number in flight at once.
  let count = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const timed = async (call) => {
    count++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    try { await new Promise((resolve) => setTimeout(resolve, 5)); return await call(); } finally { inFlight--; }
  };
  const wrap = (stmt) => ({
    bind: (...params) => wrap(stmt.bind(...params)),
    first: (...args) => timed(() => stmt.first(...args)),
    all: (...args) => timed(() => stmt.all(...args)),
    run: (...args) => timed(() => stmt.run(...args)),
    inner: stmt
  });
  const slow = new Proxy(db, { get(target, key) {
    if (key === 'prepare') return (sql) => wrap(target.prepare(sql));
    if (key === 'batch') return (statements) => timed(() => target.batch(statements.map((statement) => statement.inner || statement)));
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const response = await handleFormalRequest(request('/api/vendor/orders?month=2026-10', { token: 'tk' }), { DB: slow },
    { fetchImpl: profileFetch({ token: 'tk', lineUserId: 'bench-line-vu', displayName: 'V' }), now: NOW });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.days.length, 20);
  assert.equal(body.days.find((day) => day.serviceDate === '2026-10-05').portionCount, 5);
  // Before batching: ~170 statements on the first read, run one after another.
  assert.ok(count <= 120, `statements: ${count}`);
  assert.ok(maxInFlight >= 10, `max in flight: ${maxInFlight}`);
});
