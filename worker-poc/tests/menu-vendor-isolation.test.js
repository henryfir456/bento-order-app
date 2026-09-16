import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  mergeEffectiveMenuRows,
  normalizeLegacyMenuIdentity,
  resolveMenuItemChanges,
  resolveMenuItemChangesFromRows
} from '../src/domain/menuItemChanges.js';
import {
  buildHistoricalImageFallbackIndex,
  resolveHistoricalImageDisplayUrl
} from '../src/domain/menuImageFallback.js';
import { SqliteD1 } from './helpers/formal-db.js';

const change = ({
  id,
  vendor,
  code,
  variant = '',
  name = code,
  date = '2026-09-17',
  schema = 1,
  source = 'admin',
  order = 1
}) => ({
  menu_item_change_id: id,
  effective_date: date,
  vendor,
  item_code: code,
  variant_key: variant,
  item_name: name,
  price: 100,
  enabled: 1,
  image_url: '',
  note: '',
  display_order: order,
  source_kind: source,
  identity_schema_version: schema,
  sequence_number: order
});

const insertChange = (database, row) => database.run(`
  INSERT INTO menu_item_changes (
    menu_item_change_id, effective_date, vendor, item_code, variant_key,
    item_name, price, enabled, image_url, note, display_order,
    source_kind, identity_schema_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, row.menu_item_change_id, row.effective_date, row.vendor, row.item_code,
row.variant_key, row.item_name, row.price, row.enabled, row.image_url, row.note,
row.display_order, row.source_kind, row.identity_schema_version);

test('both-vendor 2026-09-17 fixture keeps AP with 蔡老師 and H rows with 禾拾', () => {
  const rows = [
    change({
      id: 'cai-ap', vendor: '蔡老師', code: 'AP',
      name: '風味便當(主食加量)', date: '2026-09-02', source: 'gas_compatibility'
    }),
    ...['H1', 'H2', 'H3', 'H4', 'H5'].flatMap((code, index) => [
      change({ id: `he-${code}-base`, vendor: '禾拾', code, variant: 'BASE', schema: 2, order: index * 2 + 1 }),
      change({ id: `he-${code}-half`, vendor: '禾拾', code, variant: 'HALF', schema: 2, order: index * 2 + 2 })
    ]),
    ...[
      ['A', 'BASE'], ['A', 'PLUS'], ['AM', 'BASE'], ['AM', 'PLUS']
    ].map(([code, variant], index) => change({
      id: `cai-${code}-${variant.toLowerCase()}`,
      vendor: '蔡老師', code, variant, schema: 2, order: index + 1
    }))
  ];

  const heShi = resolveMenuItemChangesFromRows(rows, {
    vendor: '禾拾', targetDate: '2026-09-17'
  });
  assert.deepEqual(
    heShi.rows.map((row) => [row.vendor, row.item_code, row.variant_key]),
    ['H1', 'H2', 'H3', 'H4', 'H5'].flatMap((code) => [
      ['禾拾', code, 'BASE'], ['禾拾', code, 'HALF']
    ])
  );
  assert.equal(heShi.rows.some((row) => row.item_code === 'AP'), false);
  assert.equal(heShi.rows.some((row) => row.vendor === '蔡老師'), false);

  const cai = resolveMenuItemChangesFromRows(rows, {
    vendor: '蔡老師', targetDate: '2026-09-17'
  });
  assert.deepEqual(
    cai.rows.map((row) => [row.vendor, row.item_code, row.variant_key]),
    [
      ['蔡老師', 'A', 'BASE'], ['蔡老師', 'A', 'PLUS'],
      ['蔡老師', 'AM', 'BASE'], ['蔡老師', 'AM', 'PLUS']
    ]
  );
  assert.equal(cai.rows.some((row) => row.item_code === 'AP'), false);
  assert.equal(cai.rows.some((row) => row.vendor === '禾拾'), false);
});

test('legacy H mapping and SQL resolution remain vendor-scoped', async () => {
  const database = new SqliteD1();
  const caiH1 = change({
    id: 'z-cai-h1', vendor: '蔡老師', code: 'H1', name: '蔡老師 H1',
    date: '2026-09-01', source: 'legacy_sql'
  });
  const heH1 = change({
    id: 'a-he-h1', vendor: '禾拾', code: 'H1', name: '禾拾 H1',
    date: '2026-09-01', source: 'legacy_sql'
  });
  insertChange(database, caiH1);
  insertChange(database, heH1);

  const resolvedHeShi = await resolveMenuItemChanges(database, {
    vendor: '禾拾', targetDate: '2026-09-10'
  });
  assert.deepEqual(resolvedHeShi.rows.map((row) => [row.vendor, row.item_name]), [
    ['禾拾', '禾拾 H1']
  ]);

  const resolvedCai = await resolveMenuItemChanges(database, {
    vendor: '蔡老師', targetDate: '2026-09-10'
  });
  assert.deepEqual(resolvedCai.rows.map((row) => [row.vendor, row.item_name]), [
    ['蔡老師', '蔡老師 H1']
  ]);
});

test('AP mapping is only valid for 蔡老師', () => {
  assert.deepEqual(normalizeLegacyMenuIdentity({
    vendor: '蔡老師', itemCode: 'AP', itemName: '風味便當(主食加量)'
  }), { item_code: 'A', variant_key: 'PLUS' });
  assert.equal(normalizeLegacyMenuIdentity({
    vendor: '禾拾', itemCode: 'AP', itemName: '風味便當(主食加量)'
  }), null);
  assert.equal(normalizeLegacyMenuIdentity({
    vendor: '蔡老師', itemCode: 'H1', variantKey: 'BASE'
  }), null);
});

test('merge keeps same item_code and normalized variant independent by vendor', () => {
  const baseline = change({
    id: 'he-a-base', vendor: '禾拾', code: 'A', variant: 'BASE', schema: 2,
    name: '禾拾 A', order: 1
  });
  const caiChange = change({
    id: 'cai-a-base', vendor: '蔡老師', code: 'A', variant: 'BASE', schema: 2,
    name: '蔡老師 A', order: 2
  });
  const merged = mergeEffectiveMenuRows({
    baselineRows: [baseline],
    changeRows: [caiChange]
  });
  assert.deepEqual(merged.map((row) => [row.vendor, row.item_code, row.variant_key]), [
    ['禾拾', 'A', 'BASE'], ['蔡老師', 'A', 'BASE']
  ]);
});

test('historical image fallback keys include vendor', () => {
  const index = buildHistoricalImageFallbackIndex([
    { vendor: '蔡老師', item_name: '風味便當', image_url: 'https://cai.example/a.jpg', enabled: 1 },
    { vendor: '禾拾', item_name: '風味便當', image_url: 'https://he.example/a.jpg', enabled: 1 }
  ]);
  assert.equal(resolveHistoricalImageDisplayUrl({
    vendor: '蔡老師', item_name: 'A.風味便當', image_url: ''
  }, index), 'https://cai.example/a.jpg');
  assert.equal(resolveHistoricalImageDisplayUrl({
    vendor: '禾拾', item_name: 'A.風味便當', image_url: ''
  }, index), 'https://he.example/a.jpg');
});
