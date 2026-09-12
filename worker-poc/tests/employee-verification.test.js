import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  digestEmployeeId,
  employeeIdText,
  resolveEmployeeVerification,
  VERIFICATION_DECISIONS
} from '../src/domain/employeeVerification.js';
import { SqliteD1 } from './helpers/formal-db.js';

const addRosterRow = (database, {
  rosterId,
  employeeId = '139653',
  active = 1,
  provenance = 'TRUSTED_IMPORT'
}) => database.run(`
  INSERT INTO employee_roster (roster_id, employee_id, active, provenance, source_ref)
  VALUES (?, ?, ?, ?, 'employee-import.csv')
`, rosterId, employeeId, active, provenance);

test('employee ID digest is canonical and reusable by audit flows', async () => {
  const normalized = await digestEmployeeId(employeeIdText(' 139653 '));
  const direct = await digestEmployeeId('139653');
  assert.equal(normalized, direct);
  assert.match(normalized, /^[0-9a-f]{64}$/);
});

test('legacy resolver auto-verifies a trusted unique active employee record', async () => {
  const database = new SqliteD1();
  addRosterRow(database, { rosterId: 'roster-139653' });
  const result = await resolveEmployeeVerification(database, ' 139653 ');
  assert.equal(result.employeeId, '139653');
  assert.equal(result.verificationStatus, 'VERIFIED');
  assert.equal(result.identityState, 'VERIFIED');
  assert.equal(result.decision, VERIFICATION_DECISIONS.AUTO_VERIFIED);
  assert.equal(result.reason, 'TRUSTED_UNIQUE_ACTIVE');
});

test('legacy resolver keeps missing, inactive, and ambiguous records pending', async () => {
  const missing = await resolveEmployeeVerification(new SqliteD1(), '139653');
  assert.equal(missing.identityState, 'PENDING_VERIFICATION');
  assert.equal(missing.decision, VERIFICATION_DECISIONS.PENDING_TRUST_REVIEW);

  const inactiveDatabase = new SqliteD1();
  addRosterRow(inactiveDatabase, { rosterId: 'inactive', active: 0 });
  assert.equal(
    (await resolveEmployeeVerification(inactiveDatabase, '139653')).identityState,
    'PENDING_VERIFICATION'
  );

  const ambiguousDatabase = new SqliteD1();
  addRosterRow(ambiguousDatabase, { rosterId: 'duplicate-a' });
  addRosterRow(ambiguousDatabase, { rosterId: 'duplicate-b' });
  const ambiguous = await resolveEmployeeVerification(ambiguousDatabase, '139653');
  assert.equal(ambiguous.identityState, 'PENDING_VERIFICATION');
  assert.equal(ambiguous.reason, 'AMBIGUOUS_MATCH');
});

test('employee ID matching remains textual and rejects format-only shortcuts', () => {
  assert.equal(employeeIdText(' e0003 '), 'E0003');
  assert.equal(employeeIdText('001234'), '001234');
  assert.throws(() => employeeIdText('not valid'), (error) => error.code === 'INVALID_EMPLOYEE_ID');
});

test('case-variant roster records remain ambiguous after normalization', async () => {
  const database = new SqliteD1();
  addRosterRow(database, { rosterId: 'lowercase', employeeId: 'e0003' });
  addRosterRow(database, { rosterId: 'uppercase', employeeId: 'E0003' });
  const result = await resolveEmployeeVerification(database, 'e0003');
  assert.equal(result.identityState, 'PENDING_VERIFICATION');
  assert.equal(result.reason, 'AMBIGUOUS_MATCH');
});

test('active LINE binding, claim, and Admin identity paths do not use roster verification', () => {
  const guestAccessSource = readFileSync(
    new URL('../src/domain/guestAccess.js', import.meta.url),
    'utf8'
  );
  const lineBindingSource = guestAccessSource.match(
    /export const lineEmployeeBind[\s\S]*?(?=export const bindLineIdentity)/
  )?.[0] || '';
  const claimSource = readFileSync(
    new URL('../src/domain/employeeClaim.js', import.meta.url),
    'utf8'
  );
  const adminIdentitySource = readFileSync(
    new URL('../src/domain/adminIdentity.js', import.meta.url),
    'utf8'
  );

  assert.match(lineBindingSource, /export const lineEmployeeBind/);
  assert.doesNotMatch(lineBindingSource, /resolveEmployeeVerification|employee_roster/);
  assert.doesNotMatch(claimSource, /resolveEmployeeVerification|employee_roster/);
  assert.doesNotMatch(adminIdentitySource, /resolveEmployeeVerification|employee_roster/);

  const revokePredicate = claimSource.match(
    /const LIVE_MATCHING_GUEST_SESSION_PREDICATE = `([\s\S]*?)`/
  )?.[1] || '';
  const revokeUpdate = claimSource.match(
    /const revokeGuestSessionsStatement[\s\S]*?(?=const revokePostconditionAssertion)/
  )?.[0] || '';
  const revokePostcondition = claimSource.match(
    /const revokePostconditionAssertion[\s\S]*?(?=const auditStatement)/
  )?.[0] || '';
  assert.match(revokePredicate, /auth_mode = 'employee_guest'/);
  assert.match(revokePredicate, /revoked_at IS NULL/);
  assert.match(revokePredicate, /expires_at > \?/);
  assert.match(revokePredicate, /AND \(\s*\(/);
  assert.match(revokePredicate, /\)\s*OR user_id = \?\s*\)/);
  assert.match(revokeUpdate, /LIVE_MATCHING_GUEST_SESSION_PREDICATE/);
  assert.match(revokePostcondition, /LIVE_MATCHING_GUEST_SESSION_PREDICATE/);
});
