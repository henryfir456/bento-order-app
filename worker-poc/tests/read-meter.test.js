import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReadMeter, meterDatabase } from '../src/db/readMeter.js';

const fakeDatabase = () => {
  const statement = (rows) => {
    const self = {
      bind: () => self,
      all: async () => ({ results: [], meta: { rows_read: rows } }),
      run: async () => ({ meta: { rows_read: rows } }),
      first: async () => null
    };
    return self;
  };
  return {
    prepare: (sql) => statement(sql.includes('big') ? 100 : 3),
    batch: async (statements) => statements.map(() => ({ meta: { rows_read: 7 } }))
  };
};

test('read meter sums rows_read across all, run, bind and batch', async () => {
  const meter = createReadMeter();
  const database = meterDatabase(fakeDatabase(), meter);
  await database.prepare('select small').bind(1).all();
  await database.prepare('select big').run();
  await database.prepare('select small').first();
  const stmts = [database.prepare('a'), database.prepare('b')];
  await database.batch(stmts);
  assert.equal(meter.rows, 3 + 100 + 14);
  assert.equal(meter.queries, 5);
});

test('read meter tolerates results without meta', async () => {
  const meter = createReadMeter();
  const database = meterDatabase({
    prepare: () => ({ all: async () => ({ results: [] }), bind() { return this; } })
  }, meter);
  await database.prepare('x').all();
  assert.equal(meter.rows, 0);
});
