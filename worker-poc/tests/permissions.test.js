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
    userId: lineUserId,
    lineUserId,
    role,
    registered: true
  }
});

test('permission matrix preserves User, ProxyAdmin, and Admin boundaries', () => {
  assert.equal(can('User', ACTIONS.READ_SELF), true);
  assert.equal(can('User', ACTIONS.ADMIN_CALENDAR), false);
  assert.equal(can('User', ACTIONS.READ_ADMIN_SUMMARY), true);
  assert.equal(can('ProxyAdmin', ACTIONS.READ_ADMIN_SUMMARY), true);
  assert.equal(can('ProxyAdmin', ACTIONS.ADMIN_CALENDAR), true);
  assert.equal(can('ProxyAdmin', ACTIONS.READ_MEMBER_BALANCES), false);
  assert.equal(can('ProxyAdmin', ACTIONS.ADMIN_BALANCE), false);
  assert.equal(can('Admin', ACTIONS.READ_MEMBER_BALANCES), true);
  assert.equal(can('Admin', ACTIONS.ADMIN_CALENDAR), true);
  assert.equal(can('Admin', ACTIONS.ADMIN_ROLE), true);
  for (const role of ['Admin', 'ProxyAdmin']) {
    assert.equal(can(role, ACTIONS.READ_SELF, 'employee_guest'), true);
    assert.equal(can(role, ACTIONS.WRITE_SELF, 'employee_guest'), true);
    assert.equal(can(role, ACTIONS.READ_ADMIN_SUMMARY, 'employee_guest'), false);
    assert.equal(can(role, ACTIONS.ADMIN_TOP_UP, 'employee_guest'), false);
    assert.equal(can(role, ACTIONS.ADMIN_ROLE, 'employee_guest'), false);
    assert.equal(can(role, ACTIONS.VIEW_AS, 'employee_guest'), false);
  }
  assert.equal(can('Unknown', ACTIONS.READ_SELF), false);
});

test('User gains only order-summary read access and no other administrative action', () => {
  for (const action of [
    ACTIONS.READ_MEMBER_BALANCES,
    ACTIONS.ADMIN_CALENDAR,
    ACTIONS.ADMIN_TOP_UP,
    ACTIONS.ADMIN_ROLE,
    ACTIONS.ADMIN_ANNOUNCEMENTS,
    ACTIONS.VIEW_AS
  ]) {
    assert.equal(can('User', action), false, `User must not receive ${action}`);
  }
  assert.equal(can('ProxyAdmin', ACTIONS.ADMIN_ANNOUNCEMENTS), false);
  assert.equal(can('ProxyAdmin', ACTIONS.VIEW_AS), false);
  for (const action of Object.values(ACTIONS)) {
    assert.equal(can('Admin', action), true, `Admin must retain ${action}`);
  }
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
