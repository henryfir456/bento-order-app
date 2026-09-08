import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const call = async (database, path, options = {}, profile = {}) => {
  const response = await handleFormalRequest(
    request(path, options),
    { DB: database },
    { fetchImpl: profileFetch(profile), now: new Date('2026-09-08T00:00:00.000Z') }
  );
  return { response, body: await response.json() };
};

const seedDatabase = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', balance: 100 });
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  seedUser(database, { lineUserId: 'proxy-1', role: 'ProxyAdmin' });
  return database;
};

const admin = (database, key, body = {}) => call(
  database,
  '/api/admin/balances/top-up',
  {
    method: 'POST',
    token: 'admin-token',
    headers: { 'Idempotency-Key': key },
    body: { targetUserId: 'user-1', amount: 25, note: 'cash', ...body }
  },
  { token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin' }
);

test('admin top-up atomically updates balance, ledger, audit, and idempotency', async () => {
  const database = seedDatabase();
  const first = await admin(database, 'top-up-once');
  const retry = await admin(database, 'top-up-once');

  assert.equal(first.response.status, 200);
  assert.equal(first.body.success, true);
  assert.equal(first.body.newBalance, 125);
  assert.deepEqual(retry.body, first.body);
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 125);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'TOPUP'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'BALANCE_TOP_UP'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM idempotency_keys WHERE status = 'COMPLETED'").count, 1);
});

test('top-up rejects changed idempotency payloads, non-admins, invalid amounts, and View As writes', async () => {
  const database = seedDatabase();
  await admin(database, 'top-up-conflict');
  const conflict = await admin(database, 'top-up-conflict', { amount: 30 });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.body.error, 'IDEMPOTENCY_CONFLICT');

  const nonAdmin = await call(database, '/api/admin/balances/top-up', {
    method: 'POST',
    token: 'user-token',
    headers: { 'Idempotency-Key': 'not-admin' },
    body: { targetUserId: 'user-1', amount: 10 }
  }, { token: 'user-token', lineUserId: 'user-1' });
  assert.equal(nonAdmin.response.status, 403);

  const invalid = await admin(database, 'top-up-invalid', { amount: 1.5 });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error, 'TOP_UP_AMOUNT_INVALID');

  const viewAs = await call(database, '/api/admin/balances/top-up?viewAs=user-1', {
    method: 'POST',
    token: 'admin-token',
    headers: { 'Idempotency-Key': 'top-up-view-as' },
    body: { targetUserId: 'user-1', amount: 10 }
  }, { token: 'admin-token', lineUserId: 'admin-1' });
  assert.equal(viewAs.response.status, 403);
  assert.equal(viewAs.body.error, 'VIEW_AS_FORBIDDEN');
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 125);
});

test('serialized top-ups preserve every positive delta', async () => {
  const database = seedDatabase();
  const results = await Promise.all([
    admin(database, 'top-up-a', { amount: 10 }),
    admin(database, 'top-up-b', { amount: 15 }),
    admin(database, 'top-up-c', { amount: 20 })
  ]);
  assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 200, 200]);
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'user-1'").balance, 145);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'TOPUP'").count, 3);
});
