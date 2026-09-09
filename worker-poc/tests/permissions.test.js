import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIONS,
  assertCan,
  assertSelfTarget,
  can
} from '../src/auth/permissions.js';

const identity = (role, lineUserId = 'user-1') => ({
  actor: {
    lineUserId,
    role,
    registered: true
  }
});

test('permission matrix preserves User, ProxyAdmin, and Admin boundaries', () => {
  assert.equal(can('User', ACTIONS.READ_SELF), true);
  assert.equal(can('User', ACTIONS.ADMIN_CALENDAR), false);
  assert.equal(can('User', ACTIONS.READ_ADMIN_SUMMARY), false);
  assert.equal(can('ProxyAdmin', ACTIONS.READ_ADMIN_SUMMARY), true);
  assert.equal(can('ProxyAdmin', ACTIONS.ADMIN_CALENDAR), true);
  assert.equal(can('ProxyAdmin', ACTIONS.READ_MEMBER_BALANCES), false);
  assert.equal(can('ProxyAdmin', ACTIONS.ADMIN_BALANCE), false);
  assert.equal(can('Admin', ACTIONS.READ_MEMBER_BALANCES), true);
  assert.equal(can('Admin', ACTIONS.ADMIN_CALENDAR), true);
  assert.equal(can('Admin', ACTIONS.ADMIN_ROLE), true);
  assert.equal(can('Unknown', ACTIONS.READ_SELF), false);
});

test('assertCan requires a registered actor and assertSelfTarget rejects impersonation', () => {
  assert.doesNotThrow(() => assertCan(identity('User'), ACTIONS.WRITE_SELF));
  assert.throws(
    () => assertCan({ actor: { registered: false, role: 'Admin' } }, ACTIONS.READ_SELF),
    (error) => error.code === 'FORBIDDEN'
  );
  assert.doesNotThrow(() => assertSelfTarget(identity('User'), 'user-1'));
  assert.throws(
    () => assertSelfTarget(identity('User'), 'other-user'),
    (error) => error.code === 'FORBIDDEN_TARGET'
  );
});
