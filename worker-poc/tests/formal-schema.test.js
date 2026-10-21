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
    'announcement_user_preferences',
    'orders',
    'order_items',
    'order_status_history',
    'balance_ledger',
    'balance_ledger_sequence',
    'idempotency_keys',
    'admin_audit_log',
    'import_quarantine',
    'opening_balance_snapshots',
    'employee_guest_sessions',
    'employee_roster',
    'menu_item_changes',
    'menu_item_change_sequence',
    'vendors',
    'vendor_daily_flavors',
    'vendor_daily_flavor_sync_runs',
    'taiwan_government_holidays',
    'protected_account_employee_mappings',
    'protected_account_access_audit',
    'vendor_principals',
    'vendor_memberships',
    'vendor_day_snapshots',
    'vendor_transfer_payments',
    'vendor_transfer_allocations',
    'vendor_transfer_allocation_events',
    'vendor_payment_events',
    'vendor_menu_version_mapping_events',
    'canonical_order_vendor_assignments'
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
    'idx_import_quarantine_batch_state',
    'idx_employee_roster_employee_id',
    'users_employee_id_normalized_unique',
    'idx_menu_item_changes_effective',
    'idx_menu_item_changes_identity',
    'idx_menu_item_changes_legacy_identity_unique',
    'idx_menu_item_change_sequence_id',
    'idx_menu_items_version_identity',
    'idx_vendors_enabled_name',
    'idx_orders_vendor_id_date_status',
    'idx_vendor_payment_events_latest',
    'idx_vendor_payment_events_one_vendor_response',
    'idx_vendor_payment_events_one_resolution',
    'idx_vendor_payment_events_one_reversal',
    'idx_vendor_daily_flavors_date',
    'idx_vendor_daily_flavor_sync_runs_started',
    'idx_taiwan_government_holidays_year',
    'idx_users_invalid_reason',
    'idx_announcement_user_preferences_user_read',
    'idx_protected_account_access_audit_time',
    'idx_vendor_memberships_vendor_status',
    'idx_vendor_menu_version_mapping_latest',
    'idx_canonical_order_vendor_assignments_vendor_date'
  ];
  const actual = new Set(rows(database, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
  `).map((row) => row.name));
  for (const indexName of expected) assert.equal(actual.has(indexName), true, indexName);
});

test('0019 adds nullable vendor identity without inferring historical orders from display text', () => {
  const database = openDatabase();
  const ordersColumns = tableColumns(database, 'orders');
  assert.equal(ordersColumns.get('vendor_id').type, 'TEXT');
  assert.equal(ordersColumns.get('vendor_id').notnull, 0);
  database.prepare('INSERT INTO users (user_id, display_name, pickup_floor, balance, role) VALUES (?, ?, ?, ?, ?)')
    .run('synthetic-vendor-buyer', 'Synthetic Buyer', '1樓', 0, 'User');
  database.prepare('INSERT INTO vendors (vendor_id, name) VALUES (?, ?)')
    .run('synthetic-canonical-vendor', '禾拾');
  database.prepare(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'synthetic-order-alias', 'synthetic-vendor-buyer', 'Synthetic Buyer',
    '2026-10-20', '合十', '1樓', 80, 'ACTIVE', 'synthetic-vendor-buyer'
  );
  assert.equal(database.prepare('SELECT vendor_id FROM orders WHERE order_id = ?')
    .get('synthetic-order-alias').vendor_id, null);
  database.prepare(`
    INSERT INTO vendor_transfer_payments (
      payment_id, vendor_id, amount_twd, transferred_on, idempotency_key,
      request_hash, created_by_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'synthetic-vendor-payment', 'synthetic-canonical-vendor', 80, '2026-10-20',
    'synthetic-idempotency', '{}', 'synthetic-vendor-buyer', '2026-10-20T00:00:00.000Z'
  );
  database.prepare(`
    INSERT INTO vendor_payment_events (
      event_id, payment_id, event_type, actor_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    'synthetic-payment-event', 'synthetic-vendor-payment', 'DISPUTED',
    'synthetic-vendor-buyer', '2026-10-20T00:00:00.000Z'
  );
  assert.throws(() => database.prepare('DELETE FROM vendor_payment_events').run(),
    /VENDOR_PAYMENT_EVENT_APPEND_ONLY/);
});

test('0019 leaves pre-existing order rows unchanged and unmapped', () => {
  const database = new DatabaseSync(':memory:');
  migrationSql.slice(0, -2).forEach((sql) => database.exec(sql));
  database.prepare('INSERT INTO users (user_id, display_name, pickup_floor, balance, role) VALUES (?, ?, ?, ?, ?)')
    .run('synthetic-vendor-buyer', 'Synthetic Buyer', '1樓', 0, 'User');
  database.prepare('INSERT INTO vendors (vendor_id, name) VALUES (?, ?)')
    .run('synthetic-canonical-vendor', '禾拾');
  database.prepare(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'synthetic-order-before-migration', 'synthetic-vendor-buyer', 'Synthetic Buyer',
    '2026-10-20', '合十', '1樓', 180, 'ACTIVE', 'synthetic-vendor-buyer'
  );
  const before = database.prepare('SELECT * FROM orders WHERE order_id = ?')
    .get('synthetic-order-before-migration');
  database.exec(migrationSql.at(-2));
  const order = database.prepare('SELECT * FROM orders WHERE order_id = ?')
    .get('synthetic-order-before-migration');
  assert.equal(order.vendor_id, null);
  assert.equal(order.total_amount, 180);
  for (const column of ['order_id', 'user_id', 'display_name_snapshot', 'order_date', 'vendor', 'pickup_floor', 'total_amount', 'status', 'created_by_user_id']) {
    assert.equal(order[column], before[column], column);
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM balance_ledger').get().count, 0);
  database.close();
});

test('0020 exposes only explicitly reviewed menu-version mappings and keeps the mapping ledger append-only', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO users (user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('synthetic-mapping-admin', 'Synthetic Admin', '1樓', 0, 'Admin');
  database.prepare('INSERT INTO vendors (vendor_id, name) VALUES (?, ?)')
    .run('synthetic-mapping-vendor', 'Synthetic Vendor');
  database.prepare(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES (?, ?, ?)
  `).run('synthetic-mapping-version', 'Synthetic Vendor', '2026-10-01');
  database.prepare(`
    INSERT INTO vendor_menu_version_mapping_events (
      event_id, menu_version_id, revision, vendor_id, effective_date,
      mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, 'VERIFIED', 'MENU_VERSION_ID_EFFECTIVE_DATE', ?, ?)
  `).run(
    'synthetic-mapping-event', 'synthetic-mapping-version', 1,
    'synthetic-mapping-vendor', '2026-10-01', 'synthetic-mapping-admin',
    '2026-10-20T00:00:00.000Z'
  );
  database.prepare(`
    INSERT INTO users (user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('synthetic-mapping-buyer', 'Synthetic Buyer', '1樓', 0, 'User');
  database.prepare(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, source_order
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'synthetic-mapping-item', 'synthetic-mapping-version', 'SYN-MAP-01',
    'Synthetic Meal', 80, 1
  );
  database.prepare(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, pickup_floor,
      total_amount, status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'synthetic-mapped-order', 'synthetic-mapping-buyer', 'Synthetic Buyer',
    '2026-10-20', 'Untrusted Legacy Label', '1樓', 80, 'ACTIVE', 'synthetic-mapping-buyer'
  );
  database.prepare(`
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'synthetic-mapped-order', 1, 'synthetic-mapping-item', 'SYN-MAP-01',
    'Old snapshot', 1, 80, 80
  );
  assert.deepEqual(database.prepare(`
    SELECT vendor_id FROM vendor_order_vendor_attributions WHERE order_id = ?
  `).all('synthetic-mapped-order').map((row) => row.vendor_id), ['synthetic-mapping-vendor']);
  database.prepare(`
    INSERT INTO vendor_menu_version_mapping_events (
      event_id, menu_version_id, revision, vendor_id, effective_date,
      mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at
    ) VALUES (?, ?, 2, NULL, ?, 'REVOKED', 'MENU_VERSION_ID_EFFECTIVE_DATE', ?, ?)
  `).run(
    'synthetic-mapping-revocation', 'synthetic-mapping-version', '2026-10-01',
    'synthetic-mapping-admin', '2026-10-20T00:01:00.000Z'
  );
  assert.deepEqual(database.prepare(`
    SELECT vendor_id FROM vendor_order_vendor_attributions WHERE order_id = ?
  `).all('synthetic-mapped-order'), []);
  assert.throws(() => database.prepare(`
    INSERT INTO vendor_menu_version_mapping_events (
      event_id, menu_version_id, revision, vendor_id, effective_date,
      mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, 'VERIFIED', 'MENU_VERSION_ID_EFFECTIVE_DATE', ?, ?)
  `).run(
    'synthetic-invalid-date-event', 'synthetic-mapping-version', 2,
    'synthetic-mapping-vendor', '2026-10-02', 'synthetic-mapping-admin',
    '2026-10-20T00:00:00.000Z'
  ), /VENDOR_MENU_VERSION_MAPPING_INVALID/);
  assert.throws(() => database.prepare(`
    UPDATE vendor_menu_version_mapping_events SET mapping_status = 'REVOKED'
    WHERE event_id = ?
  `).run('synthetic-mapping-event'), /APPEND_ONLY/);
  assert.throws(() => database.prepare(`
    DELETE FROM vendor_menu_version_mapping_events WHERE event_id = ?
  `).run('synthetic-mapping-event'), /APPEND_ONLY/);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('0020 leaves older inferred vendor IDs untouched but excludes them from scope until an item-version mapping resolves', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO users (user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
  `).run(
    'synthetic-forward-admin', 'Synthetic Admin', '1樓', 0, 'Admin',
    'synthetic-forward-buyer', 'Synthetic Buyer', '1樓', 0, 'User'
  );
  database.prepare('INSERT INTO vendors (vendor_id, name) VALUES (?, ?), (?, ?)')
    .run('synthetic-inferred-vendor', 'Synthetic Historical Label', 'synthetic-resolved-vendor', 'Synthetic Canonical Vendor');
  database.prepare(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES (?, ?, ?)
  `).run('synthetic-forward-version', 'Synthetic Canonical Vendor', '2026-10-01');
  database.prepare(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, source_order
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run('synthetic-forward-item', 'synthetic-forward-version', 'SYN-FORWARD-01', 'Synthetic Meal', 80, 1);
  database.exec('DROP TRIGGER canonical_order_vendor_assignment_after_insert');
  database.exec(`
    CREATE TRIGGER orders_vendor_identity_after_update
    AFTER UPDATE OF vendor ON orders
    BEGIN
      UPDATE orders SET vendor_id = 'synthetic-inferred-vendor'
      WHERE order_id = NEW.order_id;
    END;
  `);
  database.prepare(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor, vendor_id,
      pickup_floor, total_amount, status, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'synthetic-forward-order', 'synthetic-forward-buyer', 'Synthetic Buyer',
    '2026-10-20', 'Synthetic Historical Label', 'synthetic-inferred-vendor',
    '1樓', 80, 'ACTIVE', 'synthetic-forward-buyer'
  );
  database.prepare(`
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'synthetic-forward-order', 1, 'synthetic-forward-item', 'SYN-FORWARD-01',
    'Old snapshot', 1, 80, 80
  );
  const before = database.prepare(`
    SELECT order_id, vendor, vendor_id, total_amount FROM orders WHERE order_id = ?
  `).get('synthetic-forward-order');

  database.exec(migrationSql.at(-1));

  const after = database.prepare(`
    SELECT order_id, vendor, vendor_id, total_amount FROM orders WHERE order_id = ?
  `).get('synthetic-forward-order');
  assert.deepEqual(after, before);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM canonical_order_vendor_assignments WHERE order_id = ?
  `).get('synthetic-forward-order').count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM vendor_order_vendor_attributions WHERE order_id = ?
  `).get('synthetic-forward-order').count, 0);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'trigger' AND name = 'orders_vendor_identity_after_update'
  `).get().count, 0);
  database.prepare(`
    INSERT INTO vendor_menu_version_mapping_events (
      event_id, menu_version_id, revision, vendor_id, effective_date,
      mapping_status, evidence_kind, reviewed_by_user_id, reviewed_at
    ) VALUES (?, ?, 1, ?, ?, 'VERIFIED', 'MENU_VERSION_ID_EFFECTIVE_DATE', ?, ?)
  `).run(
    'synthetic-forward-mapping', 'synthetic-forward-version', 'synthetic-resolved-vendor',
    '2026-10-01', 'synthetic-forward-admin', '2026-10-20T00:00:00.000Z'
  );
  assert.deepEqual(database.prepare(`
    SELECT vendor_id FROM vendor_order_vendor_attributions WHERE order_id = ?
  `).all('synthetic-forward-order').map((row) => row.vendor_id), ['synthetic-resolved-vendor']);
  assert.equal(database.prepare(`
    SELECT vendor_id FROM orders WHERE order_id = ?
  `).get('synthetic-forward-order').vendor_id, 'synthetic-inferred-vendor');
});

test('0016 adds nullable popup eligibility and independent per-user preference timestamps', () => {
  const database = openDatabase();
  const announcementColumns = tableColumns(database, 'announcements');
  const preferenceColumns = tableColumns(database, 'announcement_user_preferences');
  assert.equal(announcementColumns.get('auto_popup_eligible_at').type, 'TEXT');
  assert.equal(announcementColumns.get('auto_popup_eligible_at').notnull, 0);
  assert.equal(preferenceColumns.get('read_at').notnull, 0);
  assert.equal(preferenceColumns.get('dismiss_auto_popup_at').notnull, 0);
  assert.equal(preferenceColumns.get('user_id').pk, 1);
  assert.equal(preferenceColumns.get('announcement_id').pk, 2);
  const foreignKeys = rows(database, 'PRAGMA foreign_key_list(announcement_user_preferences)');
  assert.deepEqual(new Set(foreignKeys.map((key) => key.table)), new Set(['users', 'announcements']));
});

test('0018 adds separate Vendor principal and multi-vendor membership constraints', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO users (user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('synthetic-vendor-user', '合成廠商使用者', '1樓', 0, 'User');
  database.prepare(`
    INSERT INTO vendors (vendor_id, name) VALUES (?, ?), (?, ?)
  `).run('synthetic-vendor-a', '合成店家 A', 'synthetic-vendor-b', '合成店家 B');
  database.prepare(`
    INSERT INTO vendor_principals (user_id) VALUES (?)
  `).run('synthetic-vendor-user');
  database.prepare(`
    INSERT INTO vendor_memberships (user_id, vendor_id) VALUES (?, ?), (?, ?)
  `).run(
    'synthetic-vendor-user', 'synthetic-vendor-a',
    'synthetic-vendor-user', 'synthetic-vendor-b'
  );
  assert.equal(database.prepare(
    'SELECT COUNT(*) AS count FROM vendor_memberships WHERE user_id = ?'
  ).get('synthetic-vendor-user').count, 2);
  assert.throws(() => database.prepare(`
    INSERT INTO vendor_memberships (user_id, vendor_id) VALUES (?, ?)
  `).run('synthetic-vendor-user', 'synthetic-vendor-a'), /UNIQUE/i);
  assert.throws(() => database.prepare(`
    INSERT INTO vendor_memberships (user_id, vendor_id, status) VALUES (?, ?, ?)
  `).run('synthetic-vendor-user', 'synthetic-vendor-a', 'ENABLED'), /CHECK|constraint/i);
  assert.throws(() => database.prepare(`
    INSERT INTO vendor_principals (user_id, principal_role) VALUES (?, ?)
  `).run('synthetic-vendor-user', 'Admin'), /CHECK|constraint/i);
  assert.throws(() => database.prepare(`
    INSERT INTO vendor_principals (user_id, status) VALUES (?, ?)
  `).run('synthetic-vendor-user', 'ENABLED'), /CHECK|constraint/i);
  assert.throws(() => database.prepare(
    'INSERT INTO vendor_memberships (user_id, vendor_id) VALUES (?, ?)'
  ).run('synthetic-vendor-user', 'synthetic-vendor-missing'), /FOREIGN KEY/i);
  assert.throws(() => database.prepare(
    'INSERT INTO vendor_principals (user_id) VALUES (?)'
  ).run('synthetic-vendor-missing-user'), /FOREIGN KEY/i);
  database.prepare(`
    INSERT INTO users (user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?)
  `).run('synthetic-admin-user', '合成管理者', '1樓', 0, 'Admin');
  assert.throws(() => database.prepare(`
    INSERT INTO vendor_principals (user_id) VALUES (?)
  `).run('synthetic-admin-user'), /VENDOR_PRINCIPAL_REQUIRES_USER/);
  assert.equal(database.prepare(
    'SELECT role FROM users WHERE user_id = ?'
  ).get('synthetic-vendor-user').role, 'User');
  assert.throws(() => database.prepare(`
    UPDATE users SET role = ? WHERE user_id = ?
  `).run('Admin', 'synthetic-vendor-user'), /VENDOR_PRINCIPAL_REQUIRES_USER/);
  assert.equal(database.prepare(
    'SELECT role FROM users WHERE user_id = ?'
  ).get('synthetic-vendor-user').role, 'User');
});

test('0015 adds a constrained invalid employee marker without rewriting existing user rows', () => {
  const database = new DatabaseSync(':memory:');
  const migrationIndex = migrationSql.findIndex((sql) => sql.includes('ADD COLUMN invalid_reason'));
  assert.ok(migrationIndex > 0);
  migrationSql.slice(0, migrationIndex).forEach((sql) => database.exec(sql));
  database.prepare(`
    INSERT INTO users (user_id, employee_id, line_user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('user-migration-synthetic', 'SYNTHETIC-EMPLOYEE-MIGRATION', 'synthetic-line-migration', '合成使用者', '9樓', 42, 'User');
  const before = database.prepare('SELECT * FROM users WHERE user_id = ?').get('user-migration-synthetic');
  database.exec(migrationSql[migrationIndex]);
  const after = database.prepare('SELECT * FROM users WHERE user_id = ?').get('user-migration-synthetic');
  assert.equal(after.invalid_reason, null);
  for (const column of ['user_id', 'employee_id', 'line_user_id', 'display_name', 'pickup_floor', 'balance', 'role', 'active']) {
    assert.equal(after[column], before[column], column);
  }
  database.prepare('UPDATE users SET invalid_reason = ? WHERE user_id = ?').run('INVALID_EMPLOYEE_ID', 'user-migration-synthetic');
  assert.equal(database.prepare('SELECT invalid_reason FROM users WHERE user_id = ?').get('user-migration-synthetic').invalid_reason, 'INVALID_EMPLOYEE_ID');
  assert.throws(() => database.prepare('UPDATE users SET invalid_reason = ? WHERE user_id = ?').run('SYNTHETIC_OTHER_REASON', 'user-migration-synthetic'), /CHECK|constraint/i);
});

test('0017 adds a deidentified append-only protected-account access audit', () => {
  const database = openDatabase();
  const mappingColumns = tableColumns(database, 'protected_account_employee_mappings');
  assert.deepEqual([...mappingColumns.keys()], ['account_key', 'employee_id', 'created_at']);
  database.prepare(`
    INSERT INTO protected_account_employee_mappings (account_key, employee_id, created_at)
    VALUES (?, ?, ?)
  `).run('RESERVED_VENDOR_OWNER', 'SYNTHETIC-PROTECTED-EMPLOYEE', '2026-10-20T12:00:00.000Z');
  assert.throws(() => database.prepare(`
    INSERT INTO protected_account_employee_mappings (account_key, employee_id, created_at)
    VALUES (?, ?, ?)
  `).run('ANOTHER_SYNTHETIC_ACCOUNT', 'SYNTHETIC-PROTECTED-EMPLOYEE', '2026-10-20T12:00:00.000Z'), /UNIQUE|constraint/i);
  assert.throws(() => database.prepare(`
    INSERT INTO protected_account_employee_mappings (account_key, employee_id, created_at)
    VALUES (?, ?, ?)
  `).run('', 'SYNTHETIC-OTHER-EMPLOYEE', '2026-10-20T12:00:00.000Z'), /CHECK|constraint/i);

  const columns = tableColumns(database, 'protected_account_access_audit');
  assert.deepEqual([...columns.keys()], ['event_id', 'auth_mode', 'reason_code', 'occurred_at']);
  database.prepare(`
    INSERT INTO protected_account_access_audit (event_id, auth_mode, reason_code, occurred_at)
    VALUES (?, ?, ?, ?)
  `).run('synthetic-audit-event', 'line', 'LINE_OWNER_MISMATCH', '2026-10-20T12:00:00.000Z');
  assert.throws(() => database.prepare(`
    INSERT INTO protected_account_access_audit (event_id, auth_mode, reason_code, occurred_at)
    VALUES (?, ?, ?, ?)
  `).run('synthetic-invalid-auth', 'admin', 'LINE_OWNER_MISMATCH', '2026-10-20T12:00:00.000Z'), /CHECK|constraint/i);
  assert.throws(() => database.prepare(`
    INSERT INTO protected_account_access_audit (event_id, auth_mode, reason_code, occurred_at)
    VALUES (?, ?, ?, ?)
  `).run('synthetic-invalid-reason', 'line', 'SENSITIVE_VALUE', '2026-10-20T12:00:00.000Z'), /CHECK|constraint/i);
  assert.throws(() => database.prepare(`
    UPDATE protected_account_access_audit SET reason_code = ? WHERE event_id = ?
  `).run('AUTHORIZATION_UNVERIFIED', 'synthetic-audit-event'), /append-only/i);
  assert.throws(() => database.prepare(`
    DELETE FROM protected_account_access_audit WHERE event_id = ?
  `).run('synthetic-audit-event'), /append-only/i);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('0010 backfills canonical vendors without duplicating historical aliases', () => {
  const database = new DatabaseSync(':memory:');
  migrationSql.slice(0, 10).forEach((sql) => database.exec(sql));
  database.prepare(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES (?, ?, ?)
  `).run('vendor-menu-1', '禾拾', '2026-09-10');
  database.prepare(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES (?, ?, ?)
  `).run('2026-09-11', '合十', 'B');
  database.exec(migrationSql[10]);

  const vendors = database.prepare('SELECT vendor_id, name, enabled FROM vendors ORDER BY name').all();
  assert.deepEqual(vendors.map((vendor) => vendor.name), ['禾拾']);
  assert.equal(vendors.filter((vendor) => vendor.name === '禾拾').length, 1);
  assert.equal(vendors.find((vendor) => vendor.name === '禾拾').enabled, 1);
});

test('menu item changes are append-only metadata with exact identity and signed prices', () => {
  const database = openDatabase();
  const columns = tableColumns(database, 'menu_item_changes');
  for (const column of [
    'menu_item_change_id',
    'effective_date',
    'vendor',
    'item_code',
    'variant_key',
    'item_name',
    'price',
    'enabled',
    'image_url',
    'note',
    'display_order',
    'source_kind',
    'source_batch_id',
    'source_table',
    'source_row',
    'source_record_id',
    'created_at',
    'updated_at',
    'updated_by_user_id',
    'identity_schema_version'
  ]) assert.equal(columns.has(column), true, column);
  assert.equal(columns.get('price').type, 'INTEGER');
  assert.equal(columns.get('variant_key').dflt_value, "''");
  database.prepare(`
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, source_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('change-schema-row', '2026-09-11', '蔡老師', 'AP', 'ap-variant-1', 'AP one', -1, 'admin');
  assert.throws(() => database.prepare(`
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, source_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('change-schema-duplicate', '2026-09-11', '蔡老師', 'AP', 'ap-variant-1', 'AP two', 2, 'admin'), /UNIQUE|constraint/i);
  database.prepare(`
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, source_kind, identity_schema_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('change-schema-v2', '2026-09-11', '蔡老師', 'AP', 'ap-variant-1', 'AP v2', 2, 'admin', 2);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM menu_item_change_sequence
  `).get().count, 2);
  assert.ok(database.prepare(`
    SELECT sequence_number FROM menu_item_change_sequence WHERE menu_item_change_id = ?
  `).get('change-schema-v2').sequence_number > 0);
  assert.throws(() => database.prepare(`
    UPDATE menu_item_changes SET note = 'changed' WHERE menu_item_change_id = ?
  `).run('change-schema-row'), /append-only/i);
  assert.throws(() => database.prepare(`
    UPDATE menu_item_change_sequence SET menu_item_change_id = ? WHERE menu_item_change_id = ?
  `).run('change-schema-renamed', 'change-schema-row'), /append-only/i);
  assert.throws(() => database.prepare(`
    DELETE FROM menu_item_changes WHERE menu_item_change_id = ?
  `).run('change-schema-row'), /append-only/i);
  assert.throws(() => database.prepare(`
    DELETE FROM menu_item_change_sequence WHERE menu_item_change_id = ?
  `).run('change-schema-row'), /append-only/i);
  assert.equal(tableColumns(database, 'menu_items').has('variant_key'), true);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('0011 preserves legacy menu change rows and backfills their persisted order', () => {
  const database = new DatabaseSync(':memory:');
  migrationSql.slice(0, 11).forEach((sql) => database.exec(sql));
  database.prepare(`
    INSERT INTO menu_item_changes (
      menu_item_change_id, effective_date, vendor, item_code, variant_key,
      item_name, price, enabled, image_url, note, display_order, source_kind,
      source_table, source_row, source_record_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'legacy-preserve', '2026-09-02', '蔡老師', 'AP', '', '風味會議', 120, 1,
    'https://example.test/ap.jpg', 'legacy note', 20, 'legacy_sql',
    'bento_price', 20, 'legacy-record', '2026-09-02T00:00:00.000Z',
    '2026-09-02T00:00:00.000Z'
  );
  database.exec(migrationSql[11]);
  assert.deepEqual({ ...database.prepare(`
    SELECT menu_item_change_id, effective_date, vendor, item_code, variant_key,
           item_name, price, enabled, image_url, note, display_order, source_kind,
           source_table, source_row, source_record_id, created_at, updated_at,
           identity_schema_version
    FROM menu_item_changes WHERE menu_item_change_id = 'legacy-preserve'
  `).get() }, {
    menu_item_change_id: 'legacy-preserve', effective_date: '2026-09-02', vendor: '蔡老師',
    item_code: 'AP', variant_key: '', item_name: '風味會議', price: 120, enabled: 1,
    image_url: 'https://example.test/ap.jpg', note: 'legacy note', display_order: 20,
    source_kind: 'legacy_sql', source_table: 'bento_price', source_row: 20,
    source_record_id: 'legacy-record', created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z', identity_schema_version: 1
  });
  assert.deepEqual(database.prepare(`
    SELECT sequence_number, menu_item_change_id
    FROM menu_item_change_sequence
  `).all().map((row) => ({ ...row })), [{ sequence_number: 1, menu_item_change_id: 'legacy-preserve' }]);
});

test('normalized employee ownership rejects case-variant canonical duplicates', () => {
  const database = openDatabase();
  const insert = database.prepare(`
    INSERT INTO users (user_id, employee_id, display_name, pickup_floor)
    VALUES (?, ?, ?, ?)
  `);
  insert.run('case-owner-a', 'e0003', 'Case A', '1樓');
  assert.throws(
    () => insert.run('case-owner-b', 'E0003', 'Case B', '1樓'),
    /UNIQUE|constraint/i
  );
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

test('balance ledger stores a nullable structured top-up method without changing historical rows', () => {
  const database = openDatabase();
  const columns = tableColumns(database, 'balance_ledger');
  assert.equal(columns.get('topup_method').type, 'TEXT');
  assert.equal(columns.get('topup_method').notnull, 0);

  database.prepare(`
    INSERT INTO users (user_id, display_name, pickup_floor)
    VALUES (?, ?, ?)
  `).run('topup-schema-user', 'Topup Schema User', '1樓');
  database.prepare(`
    INSERT INTO balance_ledger (
      transaction_id, user_id, amount, balance_after, type, auth_mode
    ) VALUES (?, ?, ?, ?, 'TOPUP', 'legacy_import')
  `).run('topup-schema-legacy', 'topup-schema-user', 1, 1);
  database.prepare(`
    INSERT INTO balance_ledger (
      transaction_id, user_id, amount, balance_after, type, topup_method, auth_mode
    ) VALUES (?, ?, ?, ?, 'TOPUP', ?, 'line')
  `).run('topup-schema-new', 'topup-schema-user', 1, 2, 'CASH');

  assert.equal(database.prepare(`
    SELECT topup_method FROM balance_ledger WHERE transaction_id = 'topup-schema-legacy'
  `).get().topup_method, null);
  assert.equal(database.prepare(`
    SELECT topup_method FROM balance_ledger WHERE transaction_id = 'topup-schema-new'
  `).get().topup_method, 'CASH');
  assert.throws(() => database.prepare(`
    INSERT INTO balance_ledger (
      transaction_id, user_id, amount, balance_after, type, topup_method, auth_mode
    ) VALUES (?, ?, ?, ?, 'TOPUP', ?, 'line')
  `).run('topup-schema-invalid', 'topup-schema-user', 1, 3, 'CRYPTO'), /CHECK|constraint/i);
});

test('historical negative order money is scoped to completed legacy imports', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO users (user_id, display_name, pickup_floor)
    VALUES (?, ?, ?)
  `).run('order-schema-user', 'Order Schema User', '1樓');
  const insertOrder = database.prepare(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, status, created_by_user_id, created_auth_mode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertOrder.run(
    'order-schema-live', 'order-schema-user', 'Order Schema User',
    '2026-09-08', 'Vendor A', '1樓', 1, 'ACTIVE', 'order-schema-user', 'line'
  );
  insertOrder.run(
    'order-schema-cancelled', 'order-schema-user', 'Order Schema User',
    '2026-09-09', 'Vendor A', '1樓', 1, 'CANCELLED', 'order-schema-user', 'line'
  );
  insertOrder.run(
    'order-schema-historical', 'order-schema-user', 'Order Schema User',
    '2026-09-10', 'Vendor A', '1樓', 0, 'COMPLETED', 'order-schema-user', 'legacy_import'
  );

  const insertItem = database.prepare(`
    INSERT INTO order_items (
      order_id, line_no, item_name_snapshot, quantity, unit_price, subtotal
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  assert.throws(
    () => insertItem.run('order-schema-live', 1, 'Live item', 1, -1, -1),
    /completed legacy import/i
  );
  insertItem.run('order-schema-live', 1, 'Live item', 1, 1, 1);
  assert.throws(
    () => database.prepare(`
      UPDATE order_items
      SET unit_price = -1, subtotal = -1
      WHERE order_id = ? AND line_no = ?
    `).run('order-schema-live', 1),
    /completed legacy import/i
  );
  insertItem.run('order-schema-historical', 1, 'Fee waiver', 1, -1, -1);
  database.prepare(`
    UPDATE order_items
    SET unit_price = ?, subtotal = ?
    WHERE order_id = ? AND line_no = ?
  `).run(-2, -2, 'order-schema-historical', 1);
  const historicalItem = database.prepare(`
    SELECT unit_price, subtotal
    FROM order_items
    WHERE order_id = ? AND line_no = ?
  `).get('order-schema-historical', 1);
  assert.equal(historicalItem.unit_price, -2);
  assert.equal(historicalItem.subtotal, -2);
  assert.throws(
    () => database.prepare(`
      UPDATE orders SET status = 'ACTIVE' WHERE order_id = ?
    `).run('order-schema-historical'),
    /completed legacy import/i
  );

  database.prepare(`
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_user_id, reason
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    'transition-schema-completed', 'order-schema-historical', null,
    'COMPLETED', 'order-schema-user', 'IMPORT_COMPLETED'
  );
  assert.deepEqual(
    database.prepare(`
      SELECT order_id FROM orders WHERE status = 'ACTIVE' ORDER BY order_id
    `).all().map((row) => row.order_id),
    ['order-schema-live']
  );
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
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
    [...tableColumns(database, 'users').keys()].sort(),
    [
      'user_id', 'employee_id', 'line_user_id', 'display_name', 'pickup_floor',
      'balance', 'role', 'active', 'created_at', 'updated_at', 'verification_status', 'invalid_reason'
    ].sort()
  );
  assert.equal(tableColumns(database, 'orders').has('user_id'), true);
  assert.equal(tableColumns(database, 'orders').has('line_user_id'), false);
  assert.equal(tableColumns(database, 'balance_ledger').has('user_id'), true);
  assert.equal(tableColumns(database, 'idempotency_keys').has('actor_user_id'), true);
  assert.equal(
    tableColumns(database, 'employee_guest_sessions').get('token_hash').notnull,
    1
  );
});

test('0005 preserves canonical users and relationships while making pickup floor an incomplete-profile field', () => {
  const database = new DatabaseSync(':memory:');
  migrationSql.slice(0, 5).forEach((sql) => database.exec(sql));
  const timestamp = '2026-09-07T01:00:00.000Z';
  database.prepare(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('migration-user', 'M0005', null, 'Migration User', '9樓', 12, 'User', timestamp, timestamp);
  database.prepare(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('migration-order', 'migration-user', 'Migration User', '2026-09-08', 'Vendor A', '9樓', 0, 'migration-user', timestamp, timestamp);

  database.exec(migrationSql[5]);

  assert.equal(database.prepare(`
    SELECT employee_id, pickup_floor, balance FROM users WHERE user_id = ?
  `).get('migration-user').pickup_floor, '9樓');
  assert.equal(database.prepare(`
    SELECT user_id FROM orders WHERE order_id = ?
  `).get('migration-order').user_id, 'migration-user');
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(tableColumns(database, 'users').get('pickup_floor').notnull, 0);

  database.prepare(`
    INSERT INTO users (user_id, employee_id, display_name, pickup_floor)
    VALUES (?, ?, ?, ?)
  `).run('migration-incomplete', 'M0006', 'Incomplete User', null);
  assert.throws(() => database.prepare(`
    UPDATE users SET pickup_floor = '3樓' WHERE user_id = ?
  `).run('migration-incomplete'), /CHECK|constraint/i);
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
