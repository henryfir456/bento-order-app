import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseEmployeeId } from '../scripts/lib/import-contract.mjs';
import {
  emptyIdentityMap,
  normalizeIdentityMap,
  resolveLegacyIdentities,
  resolveSourceIdentity
} from '../scripts/lib/identity-mapping.mjs';

test('employee IDs stay textual and preserve leading zeroes', () => {
  assert.deepEqual(parseEmployeeId(' 001234 '), { value: '001234', code: null });
  assert.deepEqual(parseEmployeeId(1234), { value: null, code: 'EMPLOYEE_ID_NUMERIC_UNSAFE' });
  assert.deepEqual(parseEmployeeId(''), { value: null, code: 'EMPLOYEE_ID_REQUIRED' });
  assert.deepEqual(parseEmployeeId('姓名'), { value: null, code: 'EMPLOYEE_ID_INVALID' });
});

test('identity mapping uses only exact employee/source evidence and never a name fallback', () => {
  const identityMap = normalizeIdentityMap({
    bySource: { 'Users:2': '001234' },
    byLegacyLineUserId: { 'legacy-line-1': '009876' }
  });
  assert.deepEqual(identityMap, {
    bySource: { 'Users:2': '001234' },
    byLegacyLineUserId: { 'legacy-line-1': '009876' }
  });

  const sourceMapped = resolveSourceIdentity({
    source: { sheet: 'Users', row: 2 },
    displayName: 'Alice',
    lineUserId: 'untrusted-line'
  }, {}, identityMap);
  assert.equal(sourceMapped.status, 'EXPLICIT_MAPPING_APPLIED');
  assert.equal(sourceMapped.employeeId, '001234');
  assert.match(sourceMapped.userId, /^user_/);

  const noEvidence = resolveSourceIdentity({
    source: { sheet: 'Users', row: 3 },
    displayName: 'Alice',
    lineUserId: 'untrusted-line'
  }, {}, emptyIdentityMap());
  assert.equal(noEvidence.status, 'EXPLICIT_MAPPING_REQUIRED');
  assert.equal(noEvidence.employeeId, null);
  assert.equal(noEvidence.userId, null);

  const conflict = resolveSourceIdentity({
    source: { sheet: 'Users', row: 2 },
    employeeId: '000111',
    lineUserId: 'legacy-line-1'
  }, {}, identityMap);
  assert.equal(conflict.status, 'CONFLICT');
  assert.equal(conflict.userId, null);
});

test('dependent rows inherit the same canonical user from the exact Users mapping', () => {
  const resolved = resolveLegacyIdentities({
    shapeIssues: [],
    Users: [{
      source: { sheet: 'Users', row: 2 },
      employeeId: null,
      employeeIdIssue: 'EMPLOYEE_ID_REQUIRED',
      lineUserId: 'legacy-line-1',
      displayName: 'Mapped employee',
      pickupFloor: '1樓',
      balance: 0,
      role: 'User'
    }],
    Orders: [{
      source: { sheet: 'Orders', row: 2 },
      employeeId: null,
      employeeIdIssue: 'EMPLOYEE_ID_REQUIRED',
      lineUserId: 'legacy-line-1'
    }],
    Likes: [],
    TopupHistory: []
  }, {
    identityMap: {
      bySource: { 'Users:2': '001234' },
      byLegacyLineUserId: { 'legacy-line-1': '001234' }
    }
  });

  assert.equal(resolved.Users[0].identity.employeeId, '001234');
  assert.equal(resolved.Orders[0].identity.employeeId, '001234');
  assert.equal(resolved.Orders[0].identity.userId, resolved.Users[0].identity.userId);
});

test('a dependent row with contradictory employee and known LINE identities is blocked', () => {
  const resolved = resolveLegacyIdentities({
    shapeIssues: [],
    Users: [
      {
        source: { sheet: 'Users', row: 2 },
        employeeId: '000001',
        employeeIdIssue: null,
        lineUserId: 'line-one',
        displayName: 'One'
      },
      {
        source: { sheet: 'Users', row: 3 },
        employeeId: '000002',
        employeeIdIssue: null,
        lineUserId: 'line-two',
        displayName: 'Two'
      }
    ],
    Orders: [{
      source: { sheet: 'Orders', row: 2 },
      employeeId: '000001',
      employeeIdIssue: null,
      lineUserId: 'line-two'
    }],
    Likes: [],
    TopupHistory: []
  });

  assert.equal(resolved.Orders[0].identity.status, 'CONFLICT');
  assert.equal(resolved.Orders[0].identity.userId, null);
});
