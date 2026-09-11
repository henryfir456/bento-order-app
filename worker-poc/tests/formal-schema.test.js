import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = join(here, '..', 'migrations-formal');
const migrationSql = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(migrationDirectory, name), 'utf8'));

const openDatabase = () => {
  const database = new DatabaseSync(':memory:');
  migrationSql.forEach((sql) => database.exec(sql));
  return database;
};

const rows = (database, sql, ...params) => (
  database.prepare(sql).all(...params)
);

const tableNames = (database) => new Set(
  rows(database, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).map((row) => row.name)
);

const tableColumns = (database, tableName) => new Map(
  rows(database, `PRAGMA table_info(` + tableName + `)`)
    .map((row) => [row.name, row])
);

test('formal migration creates every source-of-truth table', () => {
  const database = openDatabase();
  const expected = [
    'import_batches',
    'users',
    'calendar_settings',
    'likes',
    'menu_versions',
    'menu_items',
    'announcements',
    'orders',
    'order_items',
    'order_status_history',
    'balance_ledger',
    'balance_ledger_sequence',
    'idempotency_keys',
    'admin_audit_log',
    'import_quarantine',
    'opening_balance_snapshots',
    'employee_guest_sessions'
  ];

  const actual = tableNames(database);
  for (const table of expected) assert.equal(actual.has(table), true, table);
});

test('formal migration creates lookup indexes for concurrency-sensitive data', () => {
  const database = openDatabase();
  const expected = [
    'idx_menu_items_version_legacy',
    'idx_menu_items_customer',
    'idx_orders_actor_date_status',
    'idx_orders_date_vendor_status',
    'idx_orders_one_active_actor_date',
    'idx_order_status_history_order_time',
    'idx_balance_ledger_actor_time',
    'idx_balance_ledger_reference',
    'idx_balance_ledger_unique_order_reference',
    'idx_idempotency_actor_operation',
    'idx_import_quarantine_batch_state'
  ];
  const actual = new Set(rows(database, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
  `).map((row) => row.name));
  for (const indexName of expected) assert.equal(actual.has(indexName), true, indexName);
});

test('formal monetary columns are INTEGER and negative balances remain valid', () => {
  const database = openDatabase();
  const monetaryColumns = [
    ['users', 'balance'],
    ['menu_items', 'price'],
    ['orders', 'total_amount'],
    ['order_items', 'unit_price'],
    ['order_items', 'subtotal'],
    ['balance_ledger', 'amount'],
    ['balance_ledger', 'balance_after']
  ];

  for (const [tableName, columnName] of monetaryColumns) {
    assert.equal(tableColumns(database, tableName).get(columnName).type, 'INTEGER');
  }

  database.prepare(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor, balance, role
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('user-negative', '000125', 'line-negative', 'Negative-compatible user', '1樓', -125, 'User');

  const user = database
    .prepare('SELECT balance FROM users WHERE user_id = ?')
    .get('user-negative');
  assert.equal(user.balance, -125);
});

test('duplicate legacy menu IDs remain distinct internal menu items', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO import_batches (batch_id, source_hash, importer_version)
    VALUES (?, ?, ?)
  `).run('batch-menu', 'hash-menu', 'wave1');
  database.prepare(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date, source_batch_id)
    VALUES (?, ?, ?, ?)
  `).run('version-menu', 'vendor', '2026-09-08', 'batch-menu');

  const insertItem = database.prepare(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, source_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertItem.run('menu-internal-1', 'version-menu', 'legacy-duplicate', 'Item A', 80, 1, 1);
  insertItem.run('menu-internal-2', 'version-menu', 'legacy-duplicate', 'Item B', 90, 1, 2);

  const duplicateRows = database
    .prepare(`
      SELECT menu_item_id, legacy_item_id
      FROM menu_items
      WHERE menu_version_id = ? AND legacy_item_id = ?
      ORDER BY source_order
    `)
    .all('version-menu', 'legacy-duplicate');
  assert.deepEqual(duplicateRows.map((row) => row.menu_item_id), [
    'menu-internal-1',
    'menu-internal-2'
  ]);
});

test('disabled menu rows remain stored for audit and customer queries can filter them', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES (?, ?, ?)
  `).run('version-enabled', 'vendor', '2026-09-08');
  const insertItem = database.prepare(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, source_order
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertItem.run('menu-enabled', 'version-enabled', 'enabled', 'Enabled', 80, 1, 1);
  insertItem.run('menu-disabled', 'version-enabled', 'disabled', 'Disabled', 90, 0, 2);

  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count
    FROM menu_items
    WHERE menu_version_id = ?
  `).get('version-enabled').count, 2);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count
    FROM menu_items
    WHERE menu_version_id = ? AND enabled = 1
  `).get('version-enabled').count, 1);
});

test('foreign keys protect operational orders from orphan users', () => {
  const database = openDatabase();
  assert.throws(() => database.prepare(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor, total_amount,
      created_by_user_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'order-orphan', 'unknown-user', 'Unknown', '2026-09-08', 'vendor', '1樓', 80,
    'unknown-user'
  ), /FOREIGN KEY/i);
});

test('formal migration exposes canonical relational identity columns', () => {
  const database = new DatabaseSync(':memory:');
  migrationSql.forEach((sql) => database.exec(sql));
  assert.deepEqual(
    [...tableColumns(database, 'users').keys()],
    [
      'user_id', 'employee_id', 'line_user_id', 'display_name', 'pickup_floor',
      'balance', 'role', 'active', 'created_at', 'updated_at', 'verification_status'
    ]
  );
  assert.equal(tableColumns(database, 'orders').has('user_id'), true);
  assert.equal(tableColumns(database, 'orders').has('line_user_id'), false);
  assert.equal(tableColumns(database, 'balance_ledger').has('user_id'), true);
  assert.equal(tableColumns(database, 'idempotency_keys').has('actor_user_id'), true);
});

test('formal migration assigns a committed sequence on ledger insertion', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor, balance, role
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('sequence-user', '000126', 'sequence-line', 'Sequence User', '1樓', 0, 'User');
  database.prepare(`
    INSERT INTO balance_ledger (
      transaction_id, user_id, amount, balance_after, type, reference_id
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run('sequence-assigned', 'sequence-user', 1, 1, 'TOPUP', 'audit-missing');
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count
    FROM balance_ledger_sequence
    WHERE transaction_id = ?
  `).get('sequence-assigned').count, 1);
});

test('sequence migration backfills existing formal ledger rows without changing timestamps', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(migrationSql[0]);
  database.prepare(`
    INSERT INTO users (line_user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('backfill-user', 'Backfill User', '1樓', 0, 'User');
  database.prepare(`
    INSERT INTO balance_ledger (
      transaction_id, line_user_id, amount, balance_after, type, reference_id, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'backfill-transaction',
    'backfill-user',
    1,
    1,
    'TOPUP',
    'audit-backfill',
    '2026-09-07T01:00:00.000Z'
  );

  database.exec(migrationSql[1]);
  const row = database.prepare(`
    SELECT bl.occurred_at, bls.sequence_number
    FROM balance_ledger bl
    JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
    WHERE bl.transaction_id = ?
  `).get('backfill-transaction');
  assert.equal(row.occurred_at, '2026-09-07T01:00:00.000Z');
  assert.equal(row.sequence_number, 1);
});
