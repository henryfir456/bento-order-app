import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

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

const columns = (database, tableName) => new Map(
  database.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => [row.name, row])
);

test('0003 adds verification state and a backward-compatible provisional session shape', () => {
  const database = openDatabase();
  assert.deepEqual([...columns(database, 'users').keys()], [
    'user_id', 'employee_id', 'line_user_id', 'display_name', 'pickup_floor',
    'balance', 'role', 'active', 'created_at', 'updated_at', 'verification_status'
  ]);
  assert.deepEqual([...columns(database, 'employee_guest_sessions').keys()], [
    'session_id', 'token_hash', 'user_id', 'employee_id', 'auth_mode', 'status',
    'created_at', 'expires_at', 'revoked_at', 'revoked_reason'
  ]);
  assert.equal(columns(database, 'employee_guest_sessions').get('user_id').notnull, 0);
  assert.equal(columns(database, 'employee_guest_sessions').get('employee_id').notnull, 0);
  assert.equal(columns(database, 'employee_guest_sessions').get('status').dflt_value, "'VERIFIED'");
});

test('0003 keeps existing users verified and permits only explicit provisional status', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO users (user_id, employee_id, line_user_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('verified-user', '139653', null, 'Verified User', '1樓', 0, 'User');
  assert.equal(database.prepare(
    'SELECT verification_status FROM users WHERE user_id = ?'
  ).get('verified-user').verification_status, 'VERIFIED');

  assert.throws(() => database.prepare(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, verification_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('invalid-user', 'ABC123', null, 'Invalid User', '1樓', 0, 'User', 'PENDING'), /CHECK/i);
});

test('0003 accepts a provisional session without inventing a user_id', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, employee_id, status, expires_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run('provisional-session', 'hash-provisional', 'ABC123', 'UNVERIFIED_EMPLOYEE', '2099-01-01T00:00:00.000Z');

  const row = database.prepare(`
    SELECT user_id, employee_id, status
    FROM employee_guest_sessions
    WHERE session_id = ?
  `).get('provisional-session');
  assert.equal(row.user_id, null);
  assert.equal(row.employee_id, 'ABC123');
  assert.equal(row.status, 'UNVERIFIED_EMPLOYEE');
  assert.throws(() => database.prepare(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, employee_id, status, expires_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run('bad-session', 'hash-bad', 'ABC123', 'PENDING', '2099-01-01T00:00:00.000Z'), /CHECK/i);
});

test('0003 preserves old Worker guest inserts without requiring new columns', () => {
  const database = openDatabase();
  database.prepare(`
    INSERT INTO users (user_id, employee_id, display_name, pickup_floor, balance, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('legacy-compatible-user', '001234', 'Legacy Compatible', '1樓', 0, 'User');
  database.prepare(`
    INSERT INTO employee_guest_sessions (session_id, token_hash, user_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run('legacy-compatible-session', 'hash-legacy', 'legacy-compatible-user', '2099-01-01T00:00:00.000Z');
  const row = database.prepare(`
    SELECT employee_id, status FROM employee_guest_sessions WHERE session_id = ?
  `).get('legacy-compatible-session');
  assert.equal(row.employee_id, null);
  assert.equal(row.status, 'VERIFIED');
});
