import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
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

test('trusted unique active employee records auto-verify', async () => {
  const database = new SqliteD1();
  addRosterRow(database, { rosterId: 'roster-139653' });
  const result = await resolveEmployeeVerification(database, ' 139653 ');
  assert.equal(result.employeeId, '139653');
  assert.equal(result.verificationStatus, 'VERIFIED');
  assert.equal(result.identityState, 'VERIFIED');
  assert.equal(result.decision, VERIFICATION_DECISIONS.AUTO_VERIFIED);
  assert.equal(result.reason, 'TRUSTED_UNIQUE_ACTIVE');
});

test('missing, inactive, and ambiguous employee records remain pending', async () => {
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
