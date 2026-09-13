import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  parseLegacySqlDump,
  readLegacySqlDump
} from '../scripts/lib/legacy-sql-adapter.mjs';

const sqlPath = new URL('../../gas/bento_script.sql', import.meta.url);

test('SQL adapter parses the UTF-16LE historical dump into typed facts', async () => {
  const parsed = await readLegacySqlDump(sqlPath);

  assert.equal(parsed.encoding, 'utf16le');
  assert.equal(parsed.tableRowCounts.bento_order_count, 3030);
  assert.equal(parsed.tableRowCounts.bento_order_status, 5007);
  assert.equal(parsed.tableRowCounts.bento_price, 34);
  assert.equal(parsed.tableRowCounts.bento_type, 50);
  assert.equal(parsed.historicalOrderFacts.length, 3030 + 2795);
  assert.equal(parsed.historicalLikeFacts.length, 458 + 85);
  assert.equal(parsed.historicalWalletFacts.length, 1009 + 168);
  assert.equal(parsed.historicalMenuFacts.length, 34);
  assert.equal(parsed.historicalTypeFacts.length, 50);
  assert.equal(parsed.sqlHistoricalIdentityCount, 49);
  assert.match(parsed.sourceHash, /^[0-9a-f]{64}$/);
});

test('SQL facts retain strict employee identity, source evidence, and updater evidence', async () => {
  const parsed = await readLegacySqlDump(sqlPath);
  const order = parsed.historicalOrderFacts.find((fact) => fact.sourceTable === 'bento_order_count');
  const status = parsed.historicalOrderFacts.find((fact) => fact.sourceTable === 'bento_order_status');
  const wallet = parsed.historicalWalletFacts[0];

  assert.ok(order.normalizedEmployeeId);
  assert.equal(order.sourceTable, 'bento_order_count');
  assert.ok(Number.isInteger(order.sourceRow));
  assert.ok(Number.isInteger(order.sourceId));
  assert.ok(order.rawEvidence);
  assert.equal(order.ownerIdentitySource, 'username');
  assert.ok(status.originalEventType === 'order');
  assert.equal(status.ownerIdentitySource, 'username');
  assert.ok(wallet.rawEvidence.username_update !== undefined);
  assert.equal(wallet.ownerIdentitySource, 'username');
  assert.notEqual(wallet.ownerIdentitySource, 'username_update');
});

test('SQL order facts never fabricate modern order IDs', async () => {
  const parsed = await readLegacySqlDump(sqlPath);
  for (const fact of parsed.historicalOrderFacts.slice(0, 20)) {
    assert.equal(Object.hasOwn(fact, 'orderId'), false);
    assert.equal(Object.hasOwn(fact, 'modernOrderId'), false);
    assert.equal(fact.syntheticOrderId, false);
  }
});

test('SQL parser accepts bytes or decoded text without executing SQL', async () => {
  const bytes = await readFile(sqlPath);
  const fromBytes = parseLegacySqlDump(bytes);
  const fromText = parseLegacySqlDump(bytes.toString('utf16le').replace(/^\uFEFF/, ''));

  assert.equal(fromBytes.sourceHash, fromText.sourceHash);
  assert.equal(fromBytes.historicalOrderFacts.length, fromText.historicalOrderFacts.length);
});
