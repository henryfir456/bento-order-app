import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  CLEANUP_SQL,
  FORMAL_CLEANUP_TARGET,
  POST_CLEANUP_COUNTS,
  PRE_CLEANUP_COUNTS,
  PRE_CLEANUP_LEDGER_BY_TYPE,
  assertFormalCleanupTarget,
  buildCleanupStatements,
  compareCleanupSnapshot,
  readCleanupSnapshot,
  runFormalCleanup,
  validateCleanupBaseline
} from '../scripts/lib/formal-cleanup.mjs';
import { assertSnapshotOutputPath, runCli } from '../scripts/cleanup-formal-test-data.mjs';
import { openLocalCleanupDatabase } from '../scripts/lib/local-db.mjs';
import { SqliteD1 } from './helpers/formal-db.js';

const insert = (database, sql, ...params) => database.run(sql, ...params);

const seedCleanupFixture = () => {
  const database = new SqliteD1();

  // Wrangler creates this internal history table on a D1 database.  The
  // local test helper applies application migrations only, so model it here.
  database.exec(`
    CREATE TABLE _cf_KV (
      key TEXT PRIMARY KEY,
      value BLOB
    )
  `);
  database.exec(`
    CREATE TABLE d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  insert(database, `
    INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?), (?, ?)
  `, '0000_formal_initial_schema.sql', '2026-09-01T00:00:00.000Z',
    '0001_balance_integrity_primitives.sql', '2026-09-01T00:01:00.000Z');

  insert(database, `
    INSERT INTO import_batches (batch_id, source_hash, importer_version, status)
    VALUES (?, ?, ?, ?)
  `, 'batch-formal-test', 'hash-formal-test', 'formal-wave1', 'QUARANTINED');

  const users = [
    ['user-1', 'Test One', '1樓', -300, 'Admin'],
    ['user-2', 'Test Two', '9樓', -180, 'User'],
    ['user-3', 'Test Three', '1樓', 0, 'User']
  ];
  for (const user of users) {
    insert(database, `
      INSERT INTO users (line_user_id, display_name, pickup_floor, balance, role)
      VALUES (?, ?, ?, ?, ?)
    `, ...user);
  }

  const menuVersions = [
    ['version-he-shi-0902', '禾拾', '2026-09-02'],
    ['version-he-shi-0906', '禾拾', '2026-09-06'],
    ['version-cai-0902', '蔡老師', '2026-09-02']
  ];
  for (const version of menuVersions) {
    insert(database, `
      INSERT INTO menu_versions (menu_version_id, vendor, effective_date, source_batch_id)
      VALUES (?, ?, ?, ?)
    `, ...version, 'batch-formal-test');
  }

  for (let index = 0; index < 28; index += 1) {
    const versionId = menuVersions[index < 10 ? 0 : index < 19 ? 1 : 2][0];
    insert(database, `
      INSERT INTO menu_items (
        menu_item_id, menu_version_id, legacy_item_id, item_name, price,
        enabled, note, image_url, source_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    `menu-item-${index + 1}`,
    versionId,
    `legacy-${index + 1}`,
    `Menu item ${index + 1}`,
    80 + ((index % 5) * 10),
    1,
    '',
    '',
    index + 1);
  }

  insert(database, `
    INSERT INTO announcements (
      announcement_id, title, content, start_date, end_date, enabled, source_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)
  `,
  'announcement-1', 'Test announcement 1', 'Test content 1', '2026-09-01', '2026-09-30', 1, 1,
  'announcement-2', 'Test announcement 2', 'Test content 2', '2026-10-01', '2026-10-31', 1, 2);

  for (let index = 0; index < 15; index += 1) {
    const day = String(index + 1).padStart(2, '0');
    insert(database, `
      INSERT INTO calendar_settings (
        order_date, vendor, mode, vendor_source, updated_by_line_user_id
      ) VALUES (?, ?, ?, ?, ?)
    `, `2026-09-${day}`, index % 2 === 0 ? '禾拾' : '蔡老師', index % 2 === 0 ? 'A' : 'B',
    'CONFIGURED', 'user-1');
  }

  const likes = [
    ['2026-09-01', 'user-1'],
    ['2026-09-01', 'user-2'],
    ['2026-09-02', 'user-1'],
    ['2026-09-03', 'user-2'],
    ['2026-09-04', 'user-3'],
    ['2026-09-05', 'user-1'],
    ['2026-09-06', 'user-2']
  ];
  for (const [orderDate, userId] of likes) {
    insert(database, `
      INSERT INTO likes (order_date, line_user_id, created_at)
      VALUES (?, ?, ?)
    `, orderDate, userId, '2026-09-01T00:00:00.000Z');
  }

  for (let index = 0; index < 17; index += 1) {
    const orderId = `order-${index + 1}`;
    const status = index % 2 === 0 ? 'ACTIVE' : 'CANCELLED';
    const userId = users[index % users.length][0];
    insert(database, `
      INSERT INTO orders (
        order_id, line_user_id, order_date, vendor, pickup_floor, note,
        total_amount, status, source_batch_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    orderId,
    userId,
    `2026-10-${String(index + 1).padStart(2, '0')}`,
    index % 2 === 0 ? '禾拾' : '蔡老師',
    users[index % users.length][2],
    `note-${index + 1}`,
    100 + index,
    status,
    index < 15 ? 'batch-formal-test' : null);

    const itemCount = index < 4 ? 2 : 1;
    for (let line = 0; line < itemCount; line += 1) {
      const menuIndex = (index + line) % 28;
      insert(database, `
        INSERT INTO order_items (
          order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
          quantity, unit_price, subtotal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      orderId,
      line + 1,
      `menu-item-${menuIndex + 1}`,
      `legacy-${menuIndex + 1}`,
      `Menu item ${menuIndex + 1}`,
      1,
      100,
      100);
    }

    insert(database, `
      INSERT INTO order_status_history (
        transition_id, order_id, from_status, to_status, actor_line_user_id,
        reason, metadata_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    `transition-${index + 1}`,
    orderId,
    null,
    status,
    'user-1',
    'fixture',
    '{}',
    '2026-10-01T00:00:00.000Z');
  }

  insert(database, `
    INSERT INTO balance_ledger (
      transaction_id, line_user_id, amount, balance_after, type,
      reference_id, note, occurred_at, source_batch_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  'transaction-order-1', 'user-1', -100, -100, 'ORDER', 'order-1', 'fixture',
  '2026-10-01T00:00:00.000Z', null,
  'transaction-order-2', 'user-1', -200, -300, 'ORDER', 'order-2', 'fixture',
  '2026-10-02T00:00:00.000Z', null);

  const snapshots = [
    ['user-1', -300, 'REQUIRED'],
    ['user-2', 0, 'NOT_REQUIRED'],
    ['user-3', 0, 'NOT_REQUIRED']
  ];
  for (const [userId, balance, policyStatus] of snapshots) {
    insert(database, `
      INSERT INTO opening_balance_snapshots (
        line_user_id, snapshot_balance, source_batch_id, policy_status
      ) VALUES (?, ?, ?, ?)
    `, userId, balance, 'batch-formal-test', policyStatus);
  }

  for (let index = 0; index < 2; index += 1) {
    insert(database, `
      INSERT INTO idempotency_keys (
        actor_line_user_id, operation, idempotency_key, request_hash,
        claim_token, status, response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    'user-1',
    'CREATE_OR_REPLACE_ORDER',
    `idempotency-${index + 1}`,
    `request-hash-${index + 1}`,
    `claim-${index + 1}`,
    'COMPLETED',
    '{}');
  }

  for (let index = 0; index < 11; index += 1) {
    insert(database, `
      INSERT INTO admin_audit_log (
        audit_id, actor_line_user_id, target_line_user_id, action, metadata_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    `audit-${index + 1}`,
    'user-1',
    index % 2 === 0 ? 'user-2' : null,
    index === 0 ? 'CALENDAR_SETTING_UPDATED' : 'VIEW_AS_ADMIN_SUMMARY',
    '{}',
    '2026-09-01T00:00:00.000Z');
  }

  for (let index = 0; index < 5; index += 1) {
    insert(database, `
      INSERT INTO import_quarantine (
        quarantine_id, batch_id, entity_type, source_sheet, source_row,
        reason_code, raw_payload_json, normalized_payload_json, review_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    `quarantine-${index + 1}`,
    'batch-formal-test',
    index < 3 ? 'Orders' : 'TopupHistory',
    index < 3 ? 'Orders' : 'TopupHistory',
    index + 2,
    index < 3 ? 'ORPHAN_ORDER_USER' : 'INCOMPLETE_LEDGER_POLICY',
    JSON.stringify({ sourceRow: index + 2 }),
    null,
    'OPEN');
  }

  return database;
};

const formalOptions = (overrides = {}) => ({
  target: FORMAL_CLEANUP_TARGET.name,
  databaseId: FORMAL_CLEANUP_TARGET.databaseId,
  configuredDatabaseId: FORMAL_CLEANUP_TARGET.databaseId,
  ...overrides
});

test('cleanup statements are prepared, fixed, and never target users for deletion', () => {
  const database = seedCleanupFixture();
  assert.equal(CLEANUP_SQL.length, 11);
  assert.equal(buildCleanupStatements(database).length, CLEANUP_SQL.length);
  assert.equal(CLEANUP_SQL.some((sql) => /\bDROP\s+(TABLE|DATABASE)\b/i.test(sql)), false);
  assert.equal(CLEANUP_SQL.some((sql) => /\bDELETE\s+FROM\s+users\b/i.test(sql)), false);
  assert.equal(CLEANUP_SQL.some((sql) => /\bDELETE\s+FROM\s+menu_(versions|items)\b/i.test(sql)), false);
});

test('cleanup target verification rejects the POC database, mismatched UUID, and missing UUID', () => {
  assert.throws(
    () => assertFormalCleanupTarget({ target: 'bento-poc', databaseId: FORMAL_CLEANUP_TARGET.databaseId }),
    (error) => error.code === 'CLEANUP_TARGET_INVALID'
  );
  assert.throws(
    () => assertFormalCleanupTarget({ target: FORMAL_CLEANUP_TARGET.name, databaseId: 'wrong-uuid' }),
    (error) => error.code === 'CLEANUP_DATABASE_ID_INVALID'
  );
  assert.throws(
    () => assertFormalCleanupTarget({ target: FORMAL_CLEANUP_TARGET.name }),
    (error) => error.code === 'CLEANUP_DATABASE_ID_REQUIRED'
  );
});

test('admin audit count drift is allowed before cleanup but remains required to reach zero', async () => {
  const database = seedCleanupFixture();
  const observed = await readCleanupSnapshot(database, formalOptions());
  const baseline = {
    ...observed,
    counts: {
      ...observed.counts,
      admin_audit_log: 13
    }
  };
  assert.doesNotThrow(() => validateCleanupBaseline(baseline));

  const laterAuditSnapshot = {
    ...baseline,
    counts: {
      ...baseline.counts,
      admin_audit_log: 19
    }
  };
  assert.equal(compareCleanupSnapshot(laterAuditSnapshot, baseline).matches, true);

  const unrelatedDrift = {
    ...laterAuditSnapshot,
    counts: {
      ...laterAuditSnapshot.counts,
      orders: laterAuditSnapshot.counts.orders + 1
    }
  };
  assert.equal(compareCleanupSnapshot(unrelatedDrift, baseline).matches, false);

  const result = await runFormalCleanup(database, formalOptions({
    baseline,
    dryRun: false,
    confirmed: true
  }));
  assert.equal(result.reconciliation.passed, true);
  assert.equal(result.after.counts.admin_audit_log, 0);
});

test('remote execution is rejected and dry-run is read-only until a reviewed baseline is supplied', async () => {
  const database = seedCleanupFixture();
  const before = await readCleanupSnapshot(database, formalOptions());
  const dryRun = await runFormalCleanup(database, formalOptions());

  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.readyForExecute, false);
  assert.deepEqual(dryRun.before.counts, before.counts);
  assert.deepEqual(dryRun.before.metrics, before.metrics);

  await assert.rejects(
    () => runFormalCleanup(database, formalOptions({ executionMode: 'remote', dryRun: false })),
    (error) => error.code === 'REMOTE_CLEANUP_DISABLED'
  );
  assert.deepEqual((await readCleanupSnapshot(database, formalOptions())).counts, PRE_CLEANUP_COUNTS);
});

test('execute fails closed when confirmation is missing or the preflight baseline changed', async () => {
  const database = seedCleanupFixture();
  const baseline = await readCleanupSnapshot(database, formalOptions());

  await assert.rejects(
    () => runFormalCleanup(database, formalOptions({ baseline, dryRun: false })),
    (error) => error.code === 'CLEANUP_CONFIRMATION_REQUIRED'
  );
  assert.deepEqual((await readCleanupSnapshot(database, formalOptions())).counts, PRE_CLEANUP_COUNTS);

  insert(database, `
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_line_user_id
    ) VALUES (?, ?, ?, ?, ?)
  `, '2026-09-30', '禾拾', 'A', 'CONFIGURED', 'user-1');

  await assert.rejects(
    () => runFormalCleanup(database, formalOptions({ baseline, dryRun: false, confirmed: true })),
    (error) => error.code === 'CLEANUP_BASELINE_MISMATCH'
  );
  assert.equal(database.get('SELECT COUNT(*) AS count FROM orders').count, 17);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM calendar_settings').count, 16);
});

test('preserved identity or menu digests also fail closed even when row counts stay equal', async () => {
  const database = seedCleanupFixture();
  const baseline = await readCleanupSnapshot(database, formalOptions());
  insert(database, `
    UPDATE users SET display_name = ? WHERE line_user_id = ?
  `, 'Tampered identity', 'user-3');

  await assert.rejects(
    () => runFormalCleanup(database, formalOptions({ baseline, dryRun: false, confirmed: true })),
    (error) => error.code === 'CLEANUP_BASELINE_MISMATCH'
  );
  assert.deepEqual((await readCleanupSnapshot(database, formalOptions())).counts, PRE_CLEANUP_COUNTS);
  assert.equal(database.get('SELECT balance FROM users WHERE line_user_id = ?', 'user-1').balance, -300);
});

test('execute uses one atomic batch and reconciles all post-clean invariants', async () => {
  const database = seedCleanupFixture();
  const baseline = await readCleanupSnapshot(database, formalOptions());
  const result = await runFormalCleanup(database, formalOptions({
    baseline,
    dryRun: false,
    confirmed: true
  }));

  assert.equal(result.mode, 'execute');
  assert.equal(result.reconciliation.passed, true);
  assert.deepEqual(result.after.counts, POST_CLEANUP_COUNTS);
  assert.equal(result.after.metrics.usersBalanceTotal, 0);
  assert.deepEqual(result.after.metrics.ledgerByType, {
    TOPUP: { count: 0, amountTotal: 0 },
    ORDER: { count: 0, amountTotal: 0 },
    REFUND: { count: 0, amountTotal: 0 },
    ADJUSTMENT: { count: 0, amountTotal: 0 }
  });
  assert.deepEqual(result.after.digests, baseline.digests);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 3);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM menu_items').count, 28);
});

test('a later statement failure rolls back all earlier cleanup statements', async () => {
  const database = seedCleanupFixture();
  const baseline = await readCleanupSnapshot(database, formalOptions());
  const failingDatabase = {
    prepare: (...args) => database.prepare(...args),
    batch: (statements) => database.batch(statements.map((statement, index) => (
      index === 3
        ? { async run() { throw new Error('injected cleanup failure'); } }
        : statement
    )))
  };

  await assert.rejects(
    () => runFormalCleanup(failingDatabase, formalOptions({
      baseline,
      dryRun: false,
      confirmed: true
    })),
    (error) => error.code === 'CLEANUP_TRANSACTION_FAILED'
  );

  const afterFailure = await readCleanupSnapshot(database, formalOptions());
  assert.deepEqual(afterFailure.counts, PRE_CLEANUP_COUNTS);
  assert.deepEqual(afterFailure.metrics.ledgerByType, PRE_CLEANUP_LEDGER_BY_TYPE);
  assert.equal(afterFailure.metrics.usersBalanceTotal, -480);
});

test('CLI rejects an explicit remote mode before opening any database', async () => {
  await assert.rejects(
    () => runCli(['--remote']),
    (error) => error.code === 'REMOTE_CLEANUP_DISABLED'
  );
});

test('local cleanup adapter opens an existing database read-only without applying migrations', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bento-formal-cleanup-'));
  const databasePath = join(directory, 'existing.sqlite');
  const source = new DatabaseSync(databasePath);
  source.exec('CREATE TABLE marker (value TEXT NOT NULL)');
  source.prepare('INSERT INTO marker (value) VALUES (?)').run('untouched');
  source.close();

  let database;
  try {
    database = openLocalCleanupDatabase(databasePath, { readOnly: true });
    assert.equal((await database.prepare('SELECT value FROM marker').bind().first()).value, 'untouched');
    assert.equal((await database.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE name IN ('d1_migrations', 'users')
    `).bind().first()).count, 0);
    await assert.rejects(
      () => database.prepare('CREATE TABLE should_not_be_created (id INTEGER)').bind().run()
    );
  } finally {
    database?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI dry-run reads an existing formal database and does not mutate its baseline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bento-formal-cleanup-cli-'));
  const databasePath = join(directory, 'existing.sqlite');
  const snapshotPath = join(directory, 'snapshot.json');
  const source = seedCleanupFixture();
  const escapedDatabasePath = databasePath.replaceAll("'", "''");
  source.exec(`VACUUM INTO '${escapedDatabasePath}'`);

  try {
    assert.throws(
      () => assertSnapshotOutputPath(databasePath, databasePath),
      (error) => error.code === 'CLEANUP_SNAPSHOT_OUTPUT_INVALID'
    );
    await assert.rejects(
      () => runCli([
        '--dry-run',
        '--database',
        databasePath,
        '--snapshot-output',
        databasePath
      ], {}),
      (error) => error.code === 'CLEANUP_SNAPSHOT_OUTPUT_INVALID'
    );

    const result = await runCli([
      '--dry-run',
      '--database',
      databasePath,
      '--snapshot-output',
      snapshotPath
    ], {});
    assert.equal(result.mode, 'dry-run');
    assert.deepEqual(result.before.counts, PRE_CLEANUP_COUNTS);
    assert.equal(result.readyForExecute, false);

    const after = new DatabaseSync(databasePath);
    assert.equal(after.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 17);
    assert.equal(after.prepare('SELECT COALESCE(SUM(balance), 0) AS total FROM users').get().total, -480);
    assert.equal(after.prepare('SELECT COUNT(*) AS count FROM d1_migrations').get().count, 2);
    after.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
