import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { SqliteD1 } from './helpers/formal-db.js';

const here = dirname(fileURLToPath(import.meta.url));

test('local formal migration keeps guest-session constraints and canonical ownership safe', () => {
  const database = new SqliteD1();
  database.run(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor, balance, role, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, 'foundation-user', '001234', null, 'Foundation User', '1樓', -40, 'Admin', 1);

  database.run(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, expires_at
    ) VALUES (?, ?, ?, ?)
  `, 'guest-session-1', 'hash-1', 'foundation-user', '2099-01-01T00:00:00.000Z');
  database.run(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, expires_at
    ) VALUES (?, ?, ?, ?)
  `, 'guest-session-2', 'hash-2', 'foundation-user', '2099-01-01T00:00:00.000Z');

  assert.equal(database.get(
    'SELECT balance FROM users WHERE user_id = ?',
    'foundation-user'
  ).balance, -40);
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM employee_guest_sessions WHERE user_id = ?',
    'foundation-user'
  ).count, 2);
  assert.throws(() => database.run(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor, role
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, 'duplicate-employee', '001234', null, 'Duplicate Employee', '1樓', 'User'), /UNIQUE/i);
  database.run(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor, role
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, 'line-owner', '009999', 'line-unique', 'Line Owner', '9樓', 'User');
  assert.throws(() => database.run(`
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor, role
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, 'duplicate-line', '000007', 'line-unique', 'Duplicate Line', '1樓', 'User'), /UNIQUE/i);
  assert.throws(() => database.run(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, expires_at
    ) VALUES (?, ?, ?, ?)
  `, 'guest-session-duplicate', 'hash-1', 'foundation-user', '2099-01-01T00:00:00.000Z'), /UNIQUE/i);
  assert.throws(() => database.run(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, auth_mode, expires_at
    ) VALUES (?, ?, ?, ?, ?)
  `, 'guest-session-invalid-mode', 'hash-3', 'foundation-user', 'line', '2099-01-01T00:00:00.000Z'), /CHECK/i);
  assert.deepEqual(database.database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('formal migration docs define backup, verify, and restore recovery without remote execution', async () => {
  const source = await readFile(join(here, '..', 'migrations-formal', 'README.md'), 'utf8');
  assert.match(source, /backup.*apply migration.*verify.*restore/i);
  assert.match(source, /does\s+not exercise the remote path/i);
  assert.match(source, /remote D1 migration can be rolled back/i);
});
