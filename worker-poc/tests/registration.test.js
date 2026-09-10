import assert from 'node:assert/strict';
import { test } from 'node:test';

import { registerUser, updatePickupFloor } from '../src/domain/users.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { seedUser } from './helpers/formal-fixtures.js';

const unregisteredIdentity = (lineUserId = 'new-user') => ({
  actor: {
    lineUserId,
    displayName: 'Profile Name',
    registered: false
  }
});

test('unregistered LINE registration is blocked until an employee binding exists', async () => {
  const database = new SqliteD1();
  await assert.rejects(
    () => registerUser(
      database,
      unregisteredIdentity(),
      { pickupFloor: '1樓' },
      new Date('2026-09-08T00:00:00.000Z')
    ),
    (error) => error.code === 'EMPLOYEE_BIND_REQUIRED' && error.status === 409
  );
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 0);
});

test('registration rejects invalid floors and never accepts a client role or balance', async () => {
  const database = new SqliteD1();
  await assert.rejects(
    () => registerUser(database, unregisteredIdentity(), {
      pickupFloor: 'invalid',
      role: 'Admin',
      balance: 999
    }),
    (error) => error.code === 'INVALID_PICKUP_FLOOR' && error.status === 400
  );
  assert.equal(database.get('SELECT COUNT(*) AS count FROM users').count, 0);
});

test('pickup floor update is actor-bound and audited', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', pickupFloor: '1樓' });
  const identity = {
    actor: {
      userId: 'user-1',
      lineUserId: 'user-1',
      registered: true,
      role: 'User'
    }
  };
  const result = await updatePickupFloor(
    database,
    identity,
    '9樓',
    new Date('2026-09-08T00:00:00.000Z')
  );
  assert.equal(result.user.floor, '9樓');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 1);
});
