import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  balanceMutationResponseSpec,
  beginIdempotentOperation,
  completeIdempotentOperation,
  mutationResponseSpec,
  readExistingIdempotencyResult,
  readIdempotencyRecord,
  runIdempotentMutation
} from '../src/db/idempotency.js';
import { prepareStatement, runMutationBatch } from '../src/db/transactions.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { seedUser } from './helpers/formal-fixtures.js';

const runAuditMutation = (database, {
  key,
  requestHash,
  claimToken = 'claim-' + key
}) => runIdempotentMutation(database, {
  actorLineUserId: 'user-1',
  operation: 'TEST_AUDIT_MUTATION',
  idempotencyKey: key,
  requestHash,
  claimToken,
  occurredAt: '2026-09-07T01:00:00.000Z',
  responseSpec: mutationResponseSpec({
    message: 'TEST_OK',
    orderId: 'test-resource',
    balanceUserId: 'user-1'
  }),
  buildStatements: ({ guard }) => [prepareStatement(database, `
    INSERT INTO admin_audit_log (
      audit_id, actor_line_user_id, action, metadata_json, occurred_at
    )
    SELECT ?, ?, 'TEST_AUDIT', '{}', ?
    WHERE ${guard.sql}
  `, ['audit-' + key, 'user-1', '2026-09-07T01:00:00.000Z', ...guard.params])]
});

test('completed idempotency returns one stored result and a changed hash conflicts', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1' });
  const first = await runAuditMutation(database, { key: 'same-key', requestHash: 'hash-a' });
  const retry = await runAuditMutation(database, { key: 'same-key', requestHash: 'hash-a', claimToken: 'claim-retry' });
  assert.deepEqual(retry, first);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 1);

  await assert.rejects(
    () => runAuditMutation(database, { key: 'same-key', requestHash: 'hash-b', claimToken: 'claim-conflict' }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT' && error.status === 409
  );
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 1);
});

test('same-key concurrent claims produce one mutation result', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1' });
  const results = await Promise.all([
    runAuditMutation(database, { key: 'race-key', requestHash: 'race-hash', claimToken: 'claim-a' }),
    runAuditMutation(database, { key: 'race-key', requestHash: 'race-hash', claimToken: 'claim-b' })
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 1);
});

test('interleaved idempotency completions keep actor-operation-key responses isolated', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-a', balance: 100 });
  seedUser(database, { lineUserId: 'user-b', balance: 200 });
  const cases = [
    {
      actorLineUserId: 'user-a', operation: 'TOPUP', idempotencyKey: 'a-topup',
      requestHash: 'hash-a-topup', claimToken: 'claim-a-topup',
      message: 'A_TOPUP', targetLineUserId: 'user-a', transactionId: 'txn-a-topup'
    },
    {
      actorLineUserId: 'user-b', operation: 'ORDER', idempotencyKey: 'b-order',
      requestHash: 'hash-b-order', claimToken: 'claim-b-order',
      message: 'B_ORDER', targetLineUserId: 'user-b', transactionId: 'txn-b-order'
    },
    {
      actorLineUserId: 'user-a', operation: 'CANCEL', idempotencyKey: 'a-cancel',
      requestHash: 'hash-a-cancel', claimToken: 'claim-a-cancel',
      message: 'A_CANCEL', targetLineUserId: 'user-b', transactionId: 'txn-a-cancel'
    },
    {
      actorLineUserId: 'user-b', operation: 'ROLE', idempotencyKey: 'b-role',
      requestHash: 'hash-b-role', claimToken: 'claim-b-role',
      message: 'B_ROLE', targetLineUserId: 'user-a', transactionId: 'txn-b-role'
    }
  ].map((entry) => ({
    ...entry,
    occurredAt: '2026-09-07T01:00:00.000Z',
    responseSpec: balanceMutationResponseSpec({
      message: entry.message,
      targetLineUserId: entry.targetLineUserId,
      balanceUserId: entry.targetLineUserId,
      transactionId: entry.transactionId
    })
  }));

  for (const entry of cases) {
    await runMutationBatch(database, [beginIdempotentOperation(database, entry)]);
  }

  const beforeCompletion = database.database.prepare(`
    SELECT actor_line_user_id, operation, idempotency_key, request_hash,
           claim_token, status, response_json
    FROM idempotency_keys
    ORDER BY actor_line_user_id, operation, idempotency_key
  `).all();
  assert.equal(beforeCompletion.every((row) => row.status === 'IN_PROGRESS'), true);

  for (const index of [1, 3, 0, 2]) {
    const entry = cases[index];
    await runMutationBatch(database, [completeIdempotentOperation(database, entry)]);
  }

  for (const entry of cases) {
    const expected = {
      success: true,
      message: entry.message,
      targetUserId: entry.targetLineUserId,
      transactionId: entry.transactionId,
      newBalance: entry.targetLineUserId === 'user-a' ? 100 : 200
    };
    const replay = await readExistingIdempotencyResult(database, {
      actorLineUserId: entry.actorLineUserId,
      operation: entry.operation,
      idempotencyKey: entry.idempotencyKey,
      requestHash: entry.requestHash
    });
    assert.deepEqual(replay, expected);
    const record = await readIdempotencyRecord(database, entry);
    assert.deepEqual(JSON.parse(record.response_json), expected);
  }

  const afterCompletion = database.database.prepare(`
    SELECT actor_line_user_id, operation, idempotency_key, request_hash,
           claim_token, status, response_json
    FROM idempotency_keys
    ORDER BY actor_line_user_id, operation, idempotency_key
  `).all();
  assert.deepEqual(afterCompletion.map((row) => ({
    actor: row.actor_line_user_id,
    operation: row.operation,
    key: row.idempotency_key,
    hash: row.request_hash,
    claim: row.claim_token,
    status: row.status
  })), beforeCompletion.map((row) => ({
    actor: row.actor_line_user_id,
    operation: row.operation,
    key: row.idempotency_key,
    hash: row.request_hash,
    claim: row.claim_token,
    status: 'COMPLETED'
  })));
});
