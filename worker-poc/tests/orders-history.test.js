import test from 'node:test';
import assert from 'node:assert/strict';
import { getHistoricalOrderSummaries } from '../src/domain/ordersRead.js';

test('historical orders use bound user ID and persisted line-item snapshots', async () => {
  let query = '';
  let values = [];
  const db = {
    prepare(sql) {
      query = sql;
      return {
        bind(...args) {
          values = args;
          return { all: async () => ({ results: [
            { order_id: 'O1', order_date: '2026-10-09', status: 'COMPLETED', vendor: '蔡老師', pickup_floor: '9樓', note: '少油', total_amount: 120, line_no: 1, item_name_snapshot: '風味餐', quantity: 2, unit_price: 60, subtotal: 120 },
            { order_id: 'O2', order_date: '2026-10-10', status: 'ACTIVE', vendor: '禾拾', pickup_floor: '1樓', note: '', total_amount: 85, line_no: 1, item_name_snapshot: '套餐', quantity: 1, unit_price: 85, subtotal: 85 }
          ] }) };
        }
      };
    }
  };
  const result = await getHistoricalOrderSummaries(db, 'U-A', new Date('2026-10-14T01:00:00Z'));
  assert.equal(values[0], 'U-A');
  assert.equal(values[1], '2026-10-14');
  assert.match(query, /o\.user_id = \?/);
  assert.match(query, /o\.status = 'ACTIVE'/);
  assert.match(query, /o\.status = 'COMPLETED'/);
  assert.deepEqual(result.map((x) => x.orderId), ['O1', 'O2']);
  assert.deepEqual(result[0].items, [{ name: '風味餐', quantity: 2, unitPrice: 60, subtotal: 120 }]);
});

test('historical orders include empty items only for records without line rows', async () => {
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [
    { order_id: 'O3', order_date: '2026-10-12', status: 'ACTIVE', total_amount: 0, line_no: null }
  ] }) }) }) };
  const result = await getHistoricalOrderSummaries(db, 'U-A');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].items, []);
});
