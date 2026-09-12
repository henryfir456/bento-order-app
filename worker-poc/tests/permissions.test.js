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
    employeeId: 'employee-' + lineUserId,
    role,
    registered: true,
    active: true,
    authMode: 'line'
  }
});

test('permission matrix preserves User, ProxyAdmin, and Admin boundaries', () => {
  assert.equal(can('User', ACTIONS.READ_SELF, 'line', true, 'employee-user'), true);
  assert.equal(can('User', ACTIONS.ADMIN_CALENDAR, 'line', true, 'employee-user'), false);
  assert.equal(can('User', ACTIONS.READ_ADMIN_SUMMARY, 'line', true, 'employee-user'), true);
  assert.equal(can('ProxyAdmin', ACTIONS.READ_ADMIN_SUMMARY, 'line', true, 'employee-proxy'), true);
  assert.equal(can('ProxyAdmin', ACTIONS.ADMIN_CALENDAR, 'line', true, 'employee-proxy'), true);
  assert.equal(can('ProxyAdmin', ACTIONS.READ_MEMBER_BALANCES, 'line', true, 'employee-proxy'), false);
  assert.equal(can('ProxyAdmin', ACTIONS.ADMIN_BALANCE, 'line', true, 'employee-proxy'), false);
  assert.equal(can('Admin', ACTIONS.READ_MEMBER_BALANCES, 'line', true, 'employee-admin'), true);
  assert.equal(can('Admin', ACTIONS.ADMIN_CALENDAR, 'line', true, 'employee-admin'), true);
  assert.equal(can('Admin', ACTIONS.ADMIN_ROLE, 'line', true, 'employee-admin'), true);
  for (const role of ['User', 'ProxyAdmin', 'Admin']) {
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
    assert.equal(
      can('User', action, 'line', true, 'employee-user'),
      false,
      'User must not receive ' + action
    );
  }
  assert.equal(
    can('ProxyAdmin', ACTIONS.ADMIN_ANNOUNCEMENTS, 'line', true, 'employee-proxy'),
    false
  );
  assert.equal(can('ProxyAdmin', ACTIONS.VIEW_AS, 'line', true, 'employee-proxy'), false);
  for (const action of Object.values(ACTIONS)) {
    assert.equal(
      can('Admin', action, 'line', true, 'employee-admin'),
      true,
      'Admin must retain ' + action
    );
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

test('verification status does not change registered LINE or guest capabilities', () => {
  const registeredLineCapabilities = [
    ACTIONS.READ_SELF,
    ACTIONS.REGISTER_SELF,
    ACTIONS.WRITE_SELF,
    ACTIONS.READ_ADMIN_SUMMARY
  ].sort();
  assert.deepEqual(
    capabilitiesFor('User', 'line', true, '139653'),
    registeredLineCapabilities
  );
  assert.deepEqual(
    capabilitiesFor('User', 'employee_guest', true, '139653'),
    [ACTIONS.READ_SELF, ACTIONS.REGISTER_SELF, ACTIONS.WRITE_SELF].sort()
  );
  assert.equal(
    can('User', ACTIONS.WRITE_SELF, 'line', true, '139653'),
    true
  );
  assert.equal(
    can('User', ACTIONS.WRITE_SELF, 'employee_guest', true, '139653'),
    true
  );
});

test('UNVERIFIED registered LINE Admin principals retain Admin capabilities', () => {
  const adminMutations = [
    ACTIONS.ADMIN_BALANCE,
    ACTIONS.ADMIN_TOP_UP,
    ACTIONS.ADMIN_CALENDAR,
    ACTIONS.ADMIN_ROLE,
    ACTIONS.ADMIN_ANNOUNCEMENTS,
    ACTIONS.ADMIN_EMPLOYEE_BIND,
    ACTIONS.VIEW_AS
  ];
  const principal = {
    actor: {
      userId: 'unverified-admin',
      lineUserId: 'line-unverified-admin',
      employeeId: '139653',
      role: 'Admin',
      active: true,
      registered: true,
      authMode: 'line',
      verificationStatus: 'UNVERIFIED'
    }
  };
  for (const action of adminMutations) {
    assert.equal(
      can('Admin', action, 'line', true, '139653'),
      true,
      action
    );
    assert.doesNotThrow(() => assertCan(principal, action), action);
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
    authMode: 'employee_guest',
    provisional: true,
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
    authMode: 'line',
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
    capabilitiesFor('Admin', 'line', true, null, true),
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
      can('Admin', action, 'line', true, null, true),
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
