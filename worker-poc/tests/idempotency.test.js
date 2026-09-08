import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  mutationResponseSpec,
  runIdempotentMutation
} from '../src/db/idempotency.js';
import { prepareStatement } from '../src/db/transactions.js';
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
