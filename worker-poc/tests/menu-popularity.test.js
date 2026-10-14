import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCaiTeacherMenu } from '../src/domain/menuPopularity.js';

const menu = [
  { legacy_item_id: 'C01', variant_key: 'BASE', item_name: '照燒杏鮑菇蓋飯', price: 120 },
  { legacy_item_id: 'C02', variant_key: 'BASE', item_name: '煙燻茶鵝便當', price: 150 },
  { legacy_item_id: 'C03', variant_key: 'BASE', item_name: '精緻商務便當', price: 150 },
  { legacy_item_id: 'S', variant_key: 'BASE', item_name: '小而美', price: 80 },
  { legacy_item_id: 'S', variant_key: 'HALF', item_name: '小而美(半飯)', price: 80 },
  { legacy_item_id: 'C', variant_key: 'BASE', item_name: '特餐', price: 100 },
  { legacy_item_id: 'C', variant_key: 'HALF', item_name: '特餐(半飯)', price: 100 },
  { legacy_item_id: 'E', variant_key: 'BASE', item_name: '風味餐', price: 80 },
  { legacy_item_id: 'E', variant_key: 'PLUS', item_name: '風味餐(主食加量)', price: 90 },
  { legacy_item_id: 'FR', variant_key: 'BASE', item_name: '免費加飯', price: 0 }
];
const now = new Date('2026-10-14T05:00:00.000Z');
const fakeDb = (rows) => {
  const state = {sql:'', bindings:[]};
  return {
    state,
    prepare(sql) {
      state.sql = sql;
      return {bind(...args) {state.bindings = args;return {all:async()=>({results:rows})};}};
    }
  };
};
const row = (legacy_item_id, quantity, order_date='2026-10-10', item_name_snapshot='') => ({
  legacy_item_id, quantity, order_date, item_name_snapshot
});

test('Cai Teacher: flavor is pinned, canonical variants share a rank, popularity beats original menu position', async () => {
  const db = fakeDb([
    row('S', 7), row('S_half', 6),
    row('C', 5),
    row('C01', 2), row('C02', 1), row('C03', 1),
    row('E', 100)
  ]);
  const ranked = await rankCaiTeacherMenu(db, menu, {vendor:'蔡老師',now});
  assert.deepEqual(ranked.map(x=>x.legacy_item_id), [
    'E','E','S','S','C','C','C01','C02','C03','FR'
  ]);
  assert.equal(ranked[2].popularity_rank, ranked[3].popularity_rank);
  assert.equal(ranked[4].popularity_rank, ranked[5].popularity_rank);
  assert.equal(ranked[2].price, 80);
  assert.deepEqual(db.state.bindings, ['蔡老師','2026-09-17','2026-10-14']);
  assert.match(db.state.sql, /o.status IN \('ACTIVE', 'COMPLETED'\)/);
  assert.match(db.state.sql, /o.vendor = \?/);
});

test('synthetic fee/refund rows never rank above real meals, despite exaggerated quantity', async () => {
  const db = fakeDb([row('FR1', 99999), row('revert1', 99999),
    row('C', 6), row('S', 3)]);
  const ranked = await rankCaiTeacherMenu(db, menu, {vendor:'蔡老師',now});
  assert.equal(ranked[0].legacy_item_id,'E');
  assert.equal(ranked[2].legacy_item_id,'C');
  assert.equal(ranked[4].legacy_item_id,'S');
  assert.equal(ranked.at(-1).legacy_item_id,'FR');
});

test('90-day counts break a close recent ranking and no-orders fallback is stable', async () => {
  const db = fakeDb([row('S', 8,'2026-10-11'),row('C', 8,'2026-10-11'),
    row('C', 20,'2026-09-21')]);
  const ranked=await rankCaiTeacherMenu(db,menu,{vendor:'蔡老師',now});
  assert.ok(ranked.find(x=>x.legacy_item_id==='C').popularity_score >
    ranked.find(x=>x.legacy_item_id==='S').popularity_score);
  const empty=await rankCaiTeacherMenu(fakeDb([]),menu,{vendor:'蔡老師',now});
  assert.deepEqual(empty.slice(0,4).map(x=>x.legacy_item_id),['E','E','S','S']);
});

test('non Cai Teacher vendors preserve their original menu and do not query D1', async () => {
  const db={prepare(){throw Error('should not query')}};
  assert.strictEqual(await rankCaiTeacherMenu(db,menu,{vendor:'禾拾',now}),menu);
});

test('pre-migration aliases and ambiguous AP do not contribute', async () => {
  const db=fakeDb([row('AP',90,'2026-10-11','測試雜項'),row('C95',50),row('S',1)]);
  const ranked=await rankCaiTeacherMenu(db,menu,{vendor:'蔡老師',now});
  assert.equal(ranked[2].legacy_item_id,'S');
});
