import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bindLineIdentity, employeeGuestLogin } from '../src/domain/guestAccess.js';
import { seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-09-07T01:00:00.000Z');

test('a competing same-LINE bind that loses the conditional update does not revoke sessions', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    userId: 'race-user',
    employeeId: '001234',
    lineUserId: null,
    displayName: 'Race User'
  });
  const firstLogin = await employeeGuestLogin(database, '001234', NOW);
  await employeeGuestLogin(database, '001234', NOW);
  const originalBatch = database.batch.bind(database);

  database.batch = async (statements) => {
    database.run(
      'UPDATE users SET line_user_id = ?, updated_at = ? WHERE user_id = ?',
      'line-race',
      NOW.toISOString(),
      'race-user'
    );
    return originalBatch(statements);
  };

  const result = await bindLineIdentity(database, {
    guestToken: firstLogin.token,
    lineUserId: 'line-race',
    clock: NOW
  });

  assert.equal(result.status, 'ALREADY_BOUND');
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM employee_guest_sessions'
  ).count, 2);
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM employee_guest_sessions WHERE revoked_at IS NOT NULL'
  ).count, 0);
  assert.equal(database.get(
    'SELECT line_user_id FROM users WHERE user_id = ?',
    'race-user'
  ).line_user_id, 'line-race');
});