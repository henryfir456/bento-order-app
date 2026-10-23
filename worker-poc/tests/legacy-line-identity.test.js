import assert from 'node:assert/strict';
import { test } from 'node:test';

import { seedUser, seedVendor } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';
import {
  LINE_SQL,
  SOURCE_BASIS,
  buildContext,
  planIdentities,
  toInsertSql
} from '../scripts/lib/legacy-line-identity.mjs';

const vendorRows = [
  { vendor_id: 'V-HESHI', name: '禾拾' },
  { vendor_id: 'V-CAI', name: '蔡老師' }
];
const catalogRows = [
  ['禾拾', 'H1', 'BASE', '蕃茄鷹豆泥'], ['禾拾', 'H1', 'HALF', '蕃茄鷹豆泥(半飯)'],
  ['禾拾', 'H2', 'BASE', '醬燒板豆腐'], ['禾拾', 'H3', 'BASE', '紅麴豆腐'],
  ['蔡老師', 'C', 'BASE', 'C.特餐'], ['蔡老師', 'C', 'HALF', 'C.特餐(半飯)']
].map(([vendor, item_code, variant_key, item_name], index) => ({
  vendor, item_code, variant_key, item_name, price: 100, effective_date: '2026-09-17', sequence_number: index
}));
const context = buildContext({ catalogRows, vendorRows });

const line = (overrides) => ({
  order_id: 'o1', line_no: 1, order_date: '2026-08-01', order_status: 'COMPLETED',
  order_vendor: '蔡老師', order_vendor_id: '', attributed_vendor_id: '', auth_mode: 'legacy_import',
  code: 'C', name: 'C.特餐', unit_price: 100, quantity: 1, menu_ref: 'none',
  mi_code: '', mi_variant: '', mi_name: '', mv_vendor: '', lines: 1, qty: 1, qty_kept: 1,
  first_date: '2026-08-01', last_date: '2026-08-01', already_identified: 0, ...overrides
});

const plan = (rows) => planIdentities(rows, context);
const only = (rows) => plan(rows).writes[0];

test('old 禾拾 meals imported under 蔡老師 are matched by name, not by code', () => {
  // Old H3 was today's H2 (醬燒板豆腐); 蕃/番 spellings both match H1.
  assert.equal(only([line({ code: 'H3', name: '醬燒板豆腐' })]).itemCode, 'H2');
  assert.equal(only([line({ code: 'H1', name: '番茄鷹豆泥' })]).itemCode, 'H1');
  const half = only([line({ code: 'H1', name: '蕃茄鷹豆泥(半飯)' })]);
  assert.deepEqual([half.vendorId, half.variantKey, half.basis], ['V-HESHI', 'HALF', SOURCE_BASIS.NAME_TO_MENU]);
});

test('a migrated 禾拾 name missing from the current menu is left for review', () => {
  const result = plan([line({ code: 'H2', name: '紅麴腐乳板豆腐' })]);
  assert.equal(result.writes.length, 0);
  assert.equal(result.reviews.length, 1);
});

test('FR1 and revert1 become non-meal adjustments', () => {
  const rows = plan([line({ code: 'FR1', name: '1元' }), line({ line_no: 2, code: 'revert1', name: '手續費減免', unit_price: -1 })]).writes;
  assert.deepEqual(rows.map((row) => [row.lineKind, row.vendorId ?? null]), [['ADJUSTMENT', null], ['ADJUSTMENT', null]]);
});

test('base code with 半飯 in the name is HALF, and a stored HALF item beats a base code', () => {
  assert.equal(only([line({ name: 'C.特餐(半飯)' })]).variantKey, 'HALF');
  const stored = only([line({ code: 'H1', name: '蕃茄鷹豆泥(半飯)', order_vendor: '禾拾', menu_ref: 'linked', mi_code: 'H1H', mi_variant: '', mv_vendor: '禾拾' })]);
  assert.deepEqual([stored.variantKey, stored.basis], ['HALF', SOURCE_BASIS.STORED_HALF]);
});

test('already identified lines are skipped and partially settled orders are reported', () => {
  const result = plan([
    line({ already_identified: 1 }),
    line({ order_id: 'o2' }),
    line({ order_id: 'o2', line_no: 2, code: 'ZZ', name: '未知' })
  ]);
  assert.equal(result.writes.length, 1);
  assert.deepEqual(result.partialOrders, ['o2']);
});

const seedDb = () => {
  const database = new SqliteD1();
  vendorRows.forEach((vendor) => seedVendor(database, { vendorId: vendor.vendor_id, name: vendor.name }));
  seedUser(database, { userId: 'admin-1', lineUserId: 'line-admin-1', role: 'Admin' });
  seedUser(database, { userId: 'buyer-1', lineUserId: 'line-buyer-1' });
  return database;
};

const addOrder = (database, orderId, vendor, lines) => {
  database.run(`
    INSERT INTO orders (order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id, created_auth_mode, created_at, updated_at)
    VALUES (?, 'buyer-1', 'Synthetic Buyer', '2026-08-01', ?, '1樓', 100, 'COMPLETED', 'buyer-1', 'legacy_import',
      '2026-08-01T01:00:00.000Z', '2026-08-01T01:00:00.000Z')
  `, orderId, vendor);
  lines.forEach(([code, name, price], index) => database.run(`
    INSERT INTO order_items (order_id, line_no, legacy_item_id, item_name_snapshot, quantity, unit_price, subtotal)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `, orderId, index + 1, code, name, price, price));
};

const apply = (database) => {
  const rows = database.database.prepare(LINE_SQL).all();
  const result = planIdentities(rows, context);
  toInsertSql(result.writes, { reviewerUserId: 'admin-1', reviewedAt: '2026-10-23T00:00:00.000Z' })
    .forEach((statement) => database.exec(statement));
  return result;
};

const attribution = (database, orderId) => database.get(
  'SELECT vendor_id FROM vendor_order_vendor_attributions WHERE order_id = ?', orderId
)?.vendor_id ?? null;

test('applying the plan attributes whole orders by their reviewed lines', () => {
  const database = seedDb();
  addOrder(database, 'meal-and-fee', '蔡老師', [['C95', 'C.每日特餐', 100], ['revert1', '手續費減免', -1]]);
  addOrder(database, 'migrated', '蔡老師', [['H3', '醬燒板豆腐', 100]]);
  addOrder(database, 'unknown-line', '蔡老師', [['C95', 'C.每日特餐', 100], ['ZZ', '未知', 50]]);
  assert.equal(attribution(database, 'migrated'), null);

  const result = apply(database);
  assert.equal(result.writes.length, 4);
  assert.equal(attribution(database, 'meal-and-fee'), 'V-CAI');
  assert.equal(attribution(database, 'migrated'), 'V-HESHI');
  assert.equal(attribution(database, 'unknown-line'), null);
  // Applying again is a no-op: every line already has a current identity.
  assert.equal(apply(database).writes.length, 0);
});

test('canonical identities are append-only, reviewed by an Admin, and revised in order', () => {
  const database = seedDb();
  addOrder(database, 'o1', '蔡老師', [['C95', 'C.每日特餐', 100]]);
  const insert = (reviewer, revision) => database.run(`
    INSERT INTO order_line_canonical_identities
      (order_id, line_no, revision, line_kind, vendor_id, item_code, variant_key, basis, reviewed_by_user_id, reviewed_at)
    VALUES ('o1', 1, ?, 'MEAL', 'V-CAI', 'C', 'BASE', 'TEST', ?, '2026-10-23T00:00:00.000Z')
  `, revision, reviewer);
  assert.throws(() => insert('buyer-1', 1), /ORDER_LINE_CANONICAL_IDENTITY_INVALID/);
  assert.throws(() => insert('admin-1', 2), /ORDER_LINE_CANONICAL_IDENTITY_INVALID/);
  insert('admin-1', 1);
  insert('admin-1', 2);
  assert.throws(() => database.run('UPDATE order_line_canonical_identities SET basis = ?', 'X'), /APPEND_ONLY/);
  assert.throws(() => database.run('DELETE FROM order_line_canonical_identities'), /APPEND_ONLY/);
  assert.equal(database.get('SELECT COUNT(*) AS n FROM order_line_current_identities').n, 1);
});

test('risky orders are listed with every line and its planned decision', async () => {
  const { riskyOrdersCsv } = await import('../scripts/legacy-line-identity-plan.mjs');
  const csv = riskyOrdersCsv(plan([
    line({ order_id: 'ok' }),
    line({ order_id: 'half', line_no: 1 }),
    line({ order_id: 'half', line_no: 2, code: 'ZZ', name: '未知' }),
    line({ order_id: 'mix', line_no: 1 }),
    line({ order_id: 'mix', line_no: 2, code: 'H1', name: '蕃茄鷹豆泥' })
  ]));
  assert.ok(!csv.includes(',ok,'));
  assert.equal(csv.trim().split('\r\n').length, 1 + 4);
  assert.ok(csv.includes('店家不一致') && csv.includes('部分行需確認') && csv.includes('需確認：'));
});
