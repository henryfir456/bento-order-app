import { performance } from 'node:perf_hooks';
import { getHistoricalOrderDetails } from '../src/db/ledgerQueries.js';
import { seedUser } from '../tests/helpers/formal-fixtures.js';
import { SqliteD1 } from '../tests/helpers/formal-db.js';

const database = new SqliteD1();
seedUser(database, { lineUserId: 'bench-user', balance: 0 });
const allIds = [];
const monthIds = [];
for (let index = 0; index < 100; index += 1) {
  const id = 'perf-order-' + index;
  const current = index >= 92;
  const date = current ? '2026-10-15' : '2026-09-15';
  database.run(`INSERT INTO orders
    (order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor, total_amount, status, created_by_user_id)
    VALUES ('${id}', 'bench-user', 'Benchmark', '${date}', 'Vendor', '1樓', 80, 'ACTIVE', 'bench-user')`);
  allIds.push(id);
  if (current) monthIds.push(id);
}
async function measure(ids, iterations = 30) {
  const times = [];
  for (let i = 0; i < iterations + 5; i += 1) {
    const begin = performance.now();
    const rows = await getHistoricalOrderDetails(database, ids);
    if (rows.size !== ids.length) throw new Error('Unexpected order detail count');
    if (i >= 5) times.push(performance.now() - begin);
  }
  times.sort((a, b) => a - b);
  return { requests: ids.length, medianMs: Number(times[Math.floor(times.length / 2)].toFixed(3)), p95Ms: Number(times[Math.floor(times.length * 0.95)].toFixed(3)) };
}
const baseline = await measure(allIds);
const optimized = await measure(monthIds);
console.log(JSON.stringify({ label: 'synthetic-local-sqlite-order-detail-hydration-not-production-D1',
  fixtureOrders: allIds.length, selectedMonthOrders: monthIds.length,
  before: baseline, after: optimized,
  note: 'One CI-run sample; order-detail SQL only, not end-to-end monthly ledger performance.'
}, null, 2));
