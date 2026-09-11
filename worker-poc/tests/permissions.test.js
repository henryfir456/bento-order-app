import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  ACTIONS,
  assertCan,
  assertSelfTarget,
  can,
  capabilitiesFor,
  identityStateFor,
  IDENTITY_STATES
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

test('UNVERIFIED User principals receive only central onboarding capabilities', () => {
  const expectedCapabilities = [
    ACTIONS.CAN_BIND_LINE,
    ACTIONS.CAN_COMPLETE_PROFILE,
    ACTIONS.CAN_VIEW_SELF_ONBOARDING_STATE
  ];
  for (const authMode of ['line', 'employee_guest']) {
    const capabilities = capabilitiesFor('User', authMode, 'UNVERIFIED', true);
    assert.deepEqual(capabilities, expectedCapabilities);
  }
  for (const action of [
    ACTIONS.READ_SELF,
    ACTIONS.WRITE_SELF,
    ACTIONS.READ_ADMIN_SUMMARY,
    ACTIONS.READ_MEMBER_BALANCES,
    ACTIONS.ADMIN_TOP_UP,
    ACTIONS.ADMIN_CALENDAR,
    ACTIONS.ADMIN_ROLE,
    ACTIONS.ADMIN_ANNOUNCEMENTS,
    ACTIONS.VIEW_AS
  ]) {
    assert.equal(can('User', action, 'line', 'UNVERIFIED', true), false, action);
    assert.throws(
      () => assertCan({
        actor: {
          userId: 'unverified-user',
          role: 'User',
          active: true,
          registered: true,
          verificationStatus: 'UNVERIFIED'
        }
      }, action),
      (error) => error.code === 'FORBIDDEN',
      action
    );
  }
});

test('identity state distinguishes a missing provisional user from an existing UNVERIFIED user', () => {
  assert.equal(identityStateFor({
    userId: null,
    registered: false,
    provisional: true,
    verificationStatus: 'UNVERIFIED'
  }), IDENTITY_STATES.NEW_PROVISIONAL_EMPLOYEE);
  assert.equal(identityStateFor({
    userId: 'unverified-user',
    registered: false,
    employeeId: '139653',
    verificationStatus: 'UNVERIFIED'
  }), IDENTITY_STATES.PENDING_VERIFICATION);
  assert.equal(identityStateFor({
    userId: 'line-user-without-employee',
    authMode: 'line',
    registered: false,
    employeeId: null,
    verificationStatus: 'UNVERIFIED'
  }), IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED);
  assert.equal(identityStateFor({
    userId: 'verified-user',
    registered: true,
    employeeId: '139654',
    active: true,
    verificationStatus: 'VERIFIED'
  }), IDENTITY_STATES.VERIFIED);
  assert.equal(identityStateFor({
    userId: null,
    registered: false,
    verificationStatus: null
  }), IDENTITY_STATES.UNREGISTERED);
});

test('LINE canonical users without employee IDs receive only employee-binding capability', () => {
  assert.deepEqual(
    capabilitiesFor('Admin', 'line', 'VERIFIED', true, null, true),
    [ACTIONS.CAN_BIND_EMPLOYEE, ACTIONS.CAN_VIEW_SELF_ONBOARDING_STATE]
  );
  for (const action of [
    ACTIONS.READ_SELF,
    ACTIONS.WRITE_SELF,
    ACTIONS.READ_ADMIN_SUMMARY,
    ACTIONS.READ_MEMBER_BALANCES,
    ACTIONS.ADMIN_TOP_UP,
    ACTIONS.ADMIN_CALENDAR,
    ACTIONS.ADMIN_ROLE,
    ACTIONS.VIEW_AS
  ]) {
    assert.equal(
      can('Admin', action, 'line', 'VERIFIED', true, null, true),
      false,
      action
    );
  }
  assert.doesNotThrow(() => assertCan({
    actor: {
      userId: 'line-unbound',
      role: 'Admin',
      active: true,
      registered: false,
      authMode: 'line',
      employeeId: null,
      requiresEmployeeBinding: true,
      verificationStatus: 'VERIFIED'
    }
  }, ACTIONS.CAN_BIND_EMPLOYEE));
  assert.throws(
    () => assertCan({
      actor: {
        userId: 'line-unbound',
        role: 'Admin',
        active: true,
        registered: false,
        authMode: 'line',
        employeeId: null,
        requiresEmployeeBinding: true,
        verificationStatus: 'VERIFIED'
      }
    }, ACTIONS.READ_SELF),
    (error) => error.code === 'FORBIDDEN'
  );
});

test('admin summary derives member visibility from central capabilities, not a role-only gate', () => {
  const source = readFileSync(new URL('../src/domain/adminSummary.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /identity\.actor\.role\s*===\s*['"]Admin['"]/);
  assert.match(source, /identity\.actor\.capabilities\?\.includes\(ACTIONS\.READ_MEMBER_BALANCES\)/);
});
