import assert from 'node:assert/strict';
import test from 'node:test';
import { STATUS, buildReport, toCsv } from '../scripts/legacy-order-identity-report.mjs';

const vendorRows = [{ vendor_id: 'V00001', name: '禾拾' }, { vendor_id: 'V00002', name: '蔡老師' }];
const catalogRows = [
  { vendor: '蔡老師', item_code: 'C', variant_key: 'BASE', item_name: '每日特餐', price: 95, effective_date: '2026-09-17', sequence_number: 1 },
  { vendor: '蔡老師', item_code: 'C', variant_key: 'HALF', item_name: '每日特餐（半飯）', price: 90, effective_date: '2026-09-17', sequence_number: 2 },
  { vendor: '禾拾', item_code: 'H3', variant_key: 'HALF', item_name: '舊名', price: 100, effective_date: '2026-09-17', sequence_number: 3 },
  { vendor: '禾拾', item_code: 'H3', variant_key: 'HALF', item_name: '新名', price: 100, effective_date: '2026-10-01', sequence_number: 4 }
];
const group = (overrides) => ({
  order_vendor: '蔡老師', order_vendor_id: '', attributed_vendor_id: '', auth_mode: 'legacy_import',
  code: 'C', name: '每日特餐', unit_price: 95, menu_ref: 'none', mi_code: '', mi_variant: '', mi_name: '',
  mv_vendor: '', mv_mapped_vendor_id: '', lines: 2, qty: 3, qty_kept: 3,
  first_date: '2026-05-01', last_date: '2026-06-01', ...overrides
});

test('legacy codes map through the reviewed table and propose the canonical vendor', () => {
  const [row] = buildReport({ groups: [group({ code: 'C95' })], catalogRows, vendorRows });
  assert.equal(row.status, STATUS.CODE);
  assert.equal(row.proposedVendorId, 'V00002');
  assert.deepEqual([row.proposedCode, row.proposedVariant, row.officialName], ['C', 'BASE', '每日特餐']);
});

test('a base code whose name says 半飯 is proposed as HALF and flagged as a name inference', () => {
  const [row] = buildReport({ groups: [group({ name: '每日特餐(半飯)' })], catalogRows, vendorRows });
  assert.equal(row.status, STATUS.HALF_BY_NAME);
  assert.equal(row.proposedVariant, 'HALF');
});

test('a stored HALF menu item under a base code is a conflict that keeps the HALF item', () => {
  const [row] = buildReport({
    groups: [group({ order_vendor: '合十', code: 'H3', menu_ref: 'linked', mi_code: 'H3H', mv_vendor: '合十' })],
    catalogRows,
    vendorRows
  });
  assert.equal(row.status, STATUS.CONFLICT);
  assert.deepEqual([row.vendor, row.proposedVendorId, row.proposedVariant, row.officialName], ['禾拾', 'V00001', 'HALF', '新名']);
});

test('unknown codes are left for manual review and the CSV opens in Excel', () => {
  const rows = buildReport({ groups: [group({ code: 'ZZ', name: 'a,"b"' })], catalogRows, vendorRows });
  assert.equal(rows[0].status, STATUS.NO_MATCH);
  const csv = toCsv(rows);
  assert.ok(csv.startsWith('﻿狀態,'));
  assert.ok(csv.includes('"a,""b"""'));
});
