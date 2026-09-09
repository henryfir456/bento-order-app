import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { runProductionReplace } from '../scripts/import-legacy-workbook.mjs';
import { normalizeLegacyWorkbook } from '../scripts/lib/import-normalizer.mjs';
import { validateImport } from '../scripts/lib/import-validator.mjs';
import {
  assertProductionTarget,
  assertReviewedInput,
  APPROVED_TEST_ORDER_EXCLUSIONS,
  buildDryRunArtifact,
  buildReplacementSql,
  findReplacementBlockers,
  replaceImport
} from '../scripts/lib/replacement-import.mjs';
import { makeFormalWorkbook } from './fixtures/formal-workbook.js';
import { SqliteD1 } from './helpers/formal-db.js';

const validationFor = () => validateImport(
  normalizeLegacyWorkbook(makeFormalWorkbook(), {
    sourceHash: 'synthetic-source',
    importerVersion: 'test-version'
  })
);

const validationWithOrderExclusion = () => validateImport(
  normalizeLegacyWorkbook(makeFormalWorkbook(), {
    sourceHash: 'synthetic-source',
    importerVersion: 'test-version'
  }),
  {
    orderExclusions: new Map([
      ['order-1', { reason: 'Approved disposable synthetic test data.' }]
    ])
  }
);

const seedDisposableState = (database) => {
  database.exec(`
    CREATE TABLE d1_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    INSERT INTO d1_migrations (id, name, applied_at)
      VALUES (1, '0000_formal_initial_schema.sql', 'before-replacement');
    INSERT INTO users (line_user_id, display_name, pickup_floor, balance, role)
      VALUES ('legacy-test-user', 'Legacy Test User', '1樓', 999, 'User');
    INSERT INTO orders (
      order_id, line_user_id, order_date, vendor, pickup_floor,
      total_amount, status
    ) VALUES ('legacy-test-order', 'legacy-test-user', '2026-09-08', 'Legacy', '1樓', 999, 'ACTIVE');
    INSERT INTO idempotency_keys (
      actor_line_user_id, operation, idempotency_key, request_hash,
      claim_token, status
    ) VALUES ('legacy-test-user', 'test', 'legacy-key', 'legacy-hash', 'legacy-claim', 'COMPLETED');
    INSERT INTO admin_audit_log (
      audit_id, actor_line_user_id, action
    ) VALUES ('legacy-audit', 'legacy-test-user', 'LEGACY_TEST');
    INSERT INTO import_batches (
      batch_id, source_hash, importer_version, status
    ) VALUES ('legacy-batch', 'legacy-source', 'legacy', 'STAGED');
  `);
};

test('production replacement clears disposable state, preserves migration metadata, and reconciles', async () => {
  const database = new SqliteD1();
  const validation = validationFor();
  seedDisposableState(database);

  const result = await replaceImport(database, validation, {
    target: 'bento-formal',
    databaseId: 'e75bc185-afb5-4a5d-abc9-81bd79525cff',
    confirmed: true,
    clock: new Date('2026-09-09T00:00:00.000Z')
  });

  assert.equal(database.get("SELECT COUNT(*) AS count FROM d1_migrations WHERE name = '0000_formal_initial_schema.sql'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM users WHERE line_user_id = 'legacy-test-user'").count, 0);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE order_id = 'legacy-test-order'").count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM idempotency_keys').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 0);
  assert.equal(result.targetCounts.users, 2);
  assert.equal(result.targetCounts.orders, 1);
  assert.equal(result.targetCounts.order_items, 1);
  assert.equal(result.targetCounts.menu_items, 3);
  assert.equal(result.targetCounts.announcements, 1);
  assert.equal(result.targetCounts.calendar_settings, 1);
  assert.equal(result.targetCounts.likes, 1);
  assert.equal(result.targetCounts.import_quarantine, 2);
  assert.equal(result.targetCounts.opening_balance_snapshots, 2);
  assert.equal(result.targetCounts.balance_ledger, 0);
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'admin-1'").balance, -20);
  assert.equal(result.importBatch.source_hash, 'synthetic-source');
  assert.equal(result.importBatch.batch_id, validation.batchId);
  assert.equal(result.noUnexpectedRows, true);
  assert.equal(result.noUnexpectedDuplicates, true);
  assert.equal(result.allConsistent, true);
  assert.equal(result.balanceReconciliation.openingBalancePolicyRequiredCount, 2);

  await assert.rejects(
    replaceImport(database, validation, {
      target: 'bento-formal',
      databaseId: 'e75bc185-afb5-4a5d-abc9-81bd79525cff',
      confirmed: true
    }),
    (error) => error.code === 'REPLACEMENT_ALREADY_APPLIED'
  );
});

test('generated replacement SQL reproduces the local replacement and preserves migration metadata', () => {
  const database = new SqliteD1();
  const validation = validationFor();
  seedDisposableState(database);
  database.exec(buildReplacementSql(validation, {
    clock: new Date('2026-09-09T00:00:00.000Z')
  }));

  assert.equal(database.get('SELECT COUNT(*) AS count FROM d1_migrations').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 2);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM order_items').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_items').count, 3);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
  assert.equal(database.get("SELECT balance FROM users WHERE line_user_id = 'admin-1'").balance, -20);
});

test('production target and reviewed source guards fail closed', () => {
  assert.throws(
    () => assertProductionTarget({ target: 'bento-poc', databaseId: 'e75bc185-afb5-4a5d-abc9-81bd79525cff' }),
    (error) => error.code === 'PRODUCTION_TARGET_INVALID'
  );
  assert.throws(
    () => assertProductionTarget({ target: 'bento-formal' }),
    (error) => error.code === 'PRODUCTION_DATABASE_ID_INVALID'
  );

  const validation = validationFor();
  const artifact = buildDryRunArtifact({
    validation,
    inputPath: '便當系統設定.xlsx',
    destructiveCommand: 'future-command'
  });
  assert.equal(assertReviewedInput(validation, artifact), true);
  assert.throws(
    () => assertReviewedInput(validation, { ...artifact, readyForReplacement: false }),
    (error) => error.code === 'REVIEWED_ARTIFACT_NOT_READY'
  );
  assert.throws(
    () => assertReviewedInput({ ...validation, sourceHash: 'different-source' }, artifact),
    (error) => error.code === 'REVIEWED_SOURCE_MISMATCH'
  );
});

test('explicit order exclusions are auditable and removed from accepted production rows', () => {
  const validation = validationWithOrderExclusion();
  assert.equal(validation.accepted.Orders.length, 0);
  assert.equal(validation.summary.acceptedCounts.Orders, 0);
  assert.deepEqual(validation.exclusions, [{
    entityType: 'Orders',
    orderId: 'order-1',
    sourceSheet: 'Orders',
    sourceRow: 2,
    reason: 'Approved disposable synthetic test data.'
  }]);
  const artifact = buildDryRunArtifact({
    validation,
    inputPath: 'synthetic.xlsx',
    destructiveCommand: 'future-command'
  });
  assert.equal(artifact.exclusionCount, 1);
  assert.deepEqual(artifact.exclusions, validation.exclusions);
  assert.equal(artifact.readyForReplacement, true);
});

test('approved exclusion policy contains only the two authorized literal OrderIDs', () => {
  assert.deepEqual(
    APPROVED_TEST_ORDER_EXCLUSIONS.map((item) => item.orderId),
    ['ORD-1788326205642', 'ORD-1788415593733']
  );
});

test('preserved active-order uniqueness conflicts block replacement before SQL generation', () => {
  const validation = validationFor();
  validation.accepted.Orders.push({
    ...validation.accepted.Orders[0],
    orderId: 'order-2'
  });
  const blockers = findReplacementBlockers(validation);
  assert.equal(blockers[0].code, 'ACTIVE_ORDER_UNIQUENESS_CONFLICT');
  assert.throws(
    () => buildReplacementSql(validation),
    (error) => error.code === 'REPLACEMENT_SCHEMA_CONFLICT'
  );
  const artifact = buildDryRunArtifact({
    validation,
    inputPath: 'synthetic.xlsx',
    destructiveCommand: 'future-command'
  });
  assert.equal(artifact.readyForReplacement, false);
  assert.equal(artifact.blockers.length, 1);
});

test('production-replace dry-run writes a review artifact without touching a database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bento-production-replace-'));
  const inputPath = join(directory, 'synthetic.xlsx');
  const outputPath = join(directory, 'dry-run.json');
  await writeFile(inputPath, 'synthetic workbook bytes', 'utf8');
  try {
    const result = await runProductionReplace({
      inputPath,
      outputPath,
      target: 'bento-formal',
      databaseId: 'e75bc185-afb5-4a5d-abc9-81bd79525cff',
      dryRun: true,
      adapter: { read: async () => makeFormalWorkbook() },
      importerVersion: 'test-version'
    });
    const artifact = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(result.mode, 'dry-run');
    assert.equal(artifact.target.name, 'bento-formal');
    assert.equal(artifact.target.databaseId, 'e75bc185-afb5-4a5d-abc9-81bd79525cff');
    assert.equal(artifact.acceptedCounts.Users, 2);
    assert.equal(artifact.acceptedCounts.Orders, 1);
    assert.equal(artifact.quarantineCount, 2);
    assert.equal(artifact.warningCount, 2);
    assert.match(artifact.destructiveCommand, /--confirm-production-replace/);
    assert.match(artifact.destructiveCommand, /--remote/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
