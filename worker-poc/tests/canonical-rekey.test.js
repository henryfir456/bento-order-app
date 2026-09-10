import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = join(here, '..', 'migrations-formal');
const migrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(migrationDirectory, name), 'utf8'));

test('0002 preserves legacy relational ownership and event evidence', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(migrations[0]);
  database.exec(migrations[1]);

  const user = 'legacy-line-001';
  const batch = 'legacy-batch-001';
  const order = 'legacy-order-001';
  const timestamp = '2026-09-08T01:02:03.000Z';

  database.prepare(`
    INSERT INTO import_batches (batch_id, source_hash, importer_version)
    VALUES (?, ?, ?)
  `).run(batch, 'legacy-source-hash', 'legacy-test');
  database.prepare(`
    INSERT INTO users (
      line_user_id, display_name, pickup_floor, balance, role, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user, 'Legacy User', '1樓', -125, 'Admin', timestamp, timestamp);
  database.prepare(`
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_line_user_id
    ) VALUES (?, ?, ?, ?, ?)
  `).run('2026-09-08', 'Vendor A', 'A', 'CONFIGURED', user);
  database.prepare(`
    INSERT INTO likes (order_date, line_user_id)
    VALUES (?, ?)
  `).run('2026-09-08', user);
  database.prepare(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date, source_batch_id)
    VALUES (?, ?, ?, ?)
  `).run('legacy-version-001', 'Vendor A', '2026-09-08', batch);
  database.prepare(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price, source_order
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run('legacy-menu-001', 'legacy-version-001', 'menu-001', 'Rice', 80, 1);
  database.prepare(`
    INSERT INTO orders (
      order_id, line_user_id, order_date, vendor, pickup_floor, total_amount,
      source_batch_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(order, user, '2026-09-08', 'Vendor A', '1樓', 80, batch, timestamp, timestamp);
  database.prepare(`
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(order, 1, 'legacy-menu-001', 'menu-001', 'Rice', 1, 80, 80);
  database.prepare(`
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_line_user_id,
      reason, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('legacy-transition-001', order, null, 'ACTIVE', user, 'created', timestamp);
  database.prepare(`
    INSERT INTO balance_ledger (
      transaction_id, line_user_id, amount, balance_after, type, reference_id,
      operator_line_user_id, occurred_at, source_batch_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('legacy-transaction-001', user, -125, -125, 'ADJUSTMENT', 'legacy-opening', user, timestamp, batch);
  database.prepare(`
    INSERT INTO idempotency_keys (
      actor_line_user_id, operation, idempotency_key, request_hash, claim_token, status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(user, 'ORDER_CREATE', 'idem-001', 'request-hash', 'claim-001', 'COMPLETED');
  database.prepare(`
    INSERT INTO admin_audit_log (
      audit_id, actor_line_user_id, target_line_user_id, action, occurred_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run('audit-001', user, user, 'LEGACY_IMPORT', timestamp);
  database.prepare(`
    INSERT INTO import_quarantine (
      quarantine_id, batch_id, entity_type, source_sheet, source_row,
      reason_code, raw_payload_json, reviewed_by_line_user_id, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('quarantine-001', batch, 'Users', 'Users', 2, 'REVIEW', '{}', user, timestamp);
  database.prepare(`
    INSERT INTO opening_balance_snapshots (
      line_user_id, snapshot_balance, source_batch_id, policy_status
    ) VALUES (?, ?, ?, ?)
  `).run(user, -125, batch, 'REQUIRED');

  database.exec(migrations[2]);

  const canonicalUser = database.prepare(`
    SELECT user_id, employee_id, line_user_id, balance, created_at, updated_at
    FROM users
    WHERE line_user_id = ?
  `).get(user);
  assert.match(canonicalUser.user_id, /^legacy_[0-9a-f]+$/);
  assert.equal(canonicalUser.employee_id, null);
  assert.equal(canonicalUser.balance, -125);
  assert.equal(canonicalUser.created_at, timestamp);
  assert.equal(canonicalUser.updated_at, timestamp);

  const ownedOrder = database.prepare(`
    SELECT user_id, created_by_user_id, created_auth_mode,
      line_user_id_snapshot, display_name_snapshot
    FROM orders
    WHERE order_id = ?
  `).get(order);
  assert.deepEqual({ ...ownedOrder }, {
    user_id: canonicalUser.user_id,
    created_by_user_id: canonicalUser.user_id,
    created_auth_mode: 'legacy_import',
    line_user_id_snapshot: user,
    display_name_snapshot: 'Legacy User'
  });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM order_items WHERE order_id = ?').get(order).count, 1);
  assert.equal(database.prepare(`
    SELECT actor_user_id, actor_auth_mode, line_user_id_snapshot
    FROM order_status_history
    WHERE transition_id = ?
  `).get('legacy-transition-001').actor_user_id, canonicalUser.user_id);
  assert.equal(database.prepare(`
    SELECT auth_mode, user_id, operator_user_id, line_user_id_snapshot,
      operator_line_user_id_snapshot
    FROM balance_ledger
    WHERE transaction_id = ?
  `).get('legacy-transaction-001').operator_user_id, canonicalUser.user_id);
  assert.equal(database.prepare(`
    SELECT user_id FROM balance_ledger WHERE transaction_id = ?
  `).get('legacy-transaction-001').user_id, canonicalUser.user_id);
  assert.equal(database.prepare(`
    SELECT actor_user_id, target_user_id FROM admin_audit_log WHERE audit_id = ?
  `).get('audit-001').target_user_id, canonicalUser.user_id);
  assert.equal(database.prepare(`
    SELECT actor_user_id FROM idempotency_keys
    WHERE operation = ? AND idempotency_key = ?
  `).get('ORDER_CREATE', 'idem-001').actor_user_id, canonicalUser.user_id);
  assert.equal(database.prepare(`
    SELECT updated_by_user_id FROM calendar_settings WHERE order_date = ?
  `).get('2026-09-08').updated_by_user_id, canonicalUser.user_id);
  assert.equal(database.prepare(`
    SELECT user_id FROM likes WHERE order_date = ?
  `).get('2026-09-08').user_id, canonicalUser.user_id);
  assert.equal(database.prepare(`
    SELECT reviewed_by_user_id FROM import_quarantine WHERE quarantine_id = ?
  `).get('quarantine-001').reviewed_by_user_id, canonicalUser.user_id);
  assert.equal(database.prepare(`
    SELECT user_id, snapshot_balance FROM opening_balance_snapshots WHERE user_id = ?
  `).get(canonicalUser.user_id).snapshot_balance, -125);
  assert.equal(database.prepare(`
    SELECT sequence_number FROM balance_ledger_sequence WHERE transaction_id = ?
  `).get('legacy-transaction-001').sequence_number, 1);
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});
