import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prepareStatement, runMutationBatch, sql } from '../src/db/transactions.js';
import { SqliteD1 } from './helpers/formal-db.js';

test('prepared statement helpers bind interpolated values instead of changing SQL text', async () => {
  const database = new SqliteD1();
  const value = "' OR 1 = 1 --";
  const result = await prepareStatement(database, sql`SELECT ${value} AS value`).first();
  assert.equal(result.value, value);
  assert.throws(
    () => prepareStatement(database, 'SELECT ' + value, undefined),
    /explicit bindings array/
  );
});

test('mutation batch rolls back every prior statement when a later statement fails', async () => {
  const database = new SqliteD1();
  const first = prepareStatement(database, `
    INSERT INTO users (user_id, employee_id, line_user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, ['rollback-user', 'employee-rollback', 'line-rollback', 'Rollback', '1樓', 10, 'User']);
  const failing = prepareStatement(database, `
    INSERT INTO users (user_id, employee_id, line_user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, ['rollback-user', 'employee-duplicate', 'line-duplicate', 'Duplicate', '1樓', 20, 'User']);

  await assert.rejects(
    () => runMutationBatch(database, [first, failing]),
    (error) => error.code === 'TRANSACTION_FAILED'
  );
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 0);
});
