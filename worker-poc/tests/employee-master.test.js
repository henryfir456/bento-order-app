import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import {
  buildEmployeeMasterReport,
  parseEmployeeMasterText,
  planEmployeeMaster
} from '../scripts/lib/employee-master.mjs';
import { runEmployeeMasterDryRun } from '../scripts/preload-employee-master.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('employee master keeps IDs textual and plans seven inserts plus one reviewed LINE rekey', async () => {
  const [source, existing] = await Promise.all([
    readFile(join(here, 'fixtures', 'employee-master.sample.json'), 'utf8'),
    readFile(join(here, 'fixtures', 'employee-master.sample-existing-users.json'), 'utf8')
  ]);
  const parsed = parseEmployeeMasterText(source, {
    format: 'json',
    sourceName: 'employee-master.sample.json'
  });
  const plan = planEmployeeMaster({
    records: parsed.records,
    issues: parsed.issues,
    existingUsers: JSON.parse(existing)
  });

  assert.equal(parsed.records[0].employeeId, '001234');
  assert.equal(plan.executable, false);
  assert.deepEqual(plan.counts, {
    insert: 7,
    update: 1,
    skip: 0,
    conflict: 0,
    invalid: 4
  });
  assert.equal(plan.operations.length, 0, 'invalid input must not produce an executable plan');
  assert.ok(parsed.issues.some((item) => item.code === 'EMPLOYEE_ID_DUPLICATE'));
  assert.ok(parsed.issues.some((item) => item.code === 'INVALID_PICKUP_FLOOR'));
  assert.ok(parsed.issues.some((item) => item.code === 'INVALID_ROLE'));
  assert.ok(parsed.issues.some((item) => item.code === 'EMPLOYEE_ID_REQUIRED'));

  const validParsed = parseEmployeeMasterText(JSON.stringify([
    JSON.parse(source)[0],
    JSON.parse(source)[7]
  ]), { format: 'json', sourceName: 'valid.json' });
  const validPlan = planEmployeeMaster({
    records: validParsed.records,
    issues: validParsed.issues,
    existingUsers: JSON.parse(existing)
  });
  assert.equal(validPlan.executable, true);
  assert.deepEqual(validPlan.operations.map(({ type, userId, employeeId, lineUserId }) => ({
    type, userId, employeeId, lineUserId
  })), [
    {
      type: 'insert',
      userId: validPlan.operations[0].userId,
      employeeId: '001234',
      lineUserId: null
    },
    {
      type: 'update',
      userId: 'user-existing-009999',
      employeeId: '009999',
      lineUserId: 'line-existing-009999'
    }
  ]);
  assert.equal(validPlan.operations[1].role, 'User');
});

test('employee master never guesses an unknown LINE mapping or matches by name', () => {
  const parsed = parseEmployeeMasterText(JSON.stringify([{
    employee_id: '001234',
    display_name: 'Same Name',
    pickup_floor: '1樓',
    role: 'User',
    active: true,
    line_user_id: 'line-unknown',
    mapping_evidence: 'reviewed'
  }]), { format: 'json' });
  const plan = planEmployeeMaster({
    records: parsed.records,
    issues: parsed.issues,
    existingUsers: [{
      user_id: 'different-user',
      employee_id: '009999',
      line_user_id: 'line-different',
      display_name: 'Same Name',
      pickup_floor: '1樓',
      role: 'User',
      active: 1
    }]
  });

  assert.equal(plan.executable, false);
  assert.equal(plan.counts.conflict, 1);
  assert.equal(plan.blockers[0].code, 'EMPLOYEE_MASTER_LINE_MAPPING_TARGET_NOT_FOUND');
});

test('numeric JSON employee IDs are rejected before precision loss', () => {
  const parsed = parseEmployeeMasterText(JSON.stringify([{
    employee_id: 1234,
    display_name: 'Numeric',
    pickup_floor: '1樓',
    role: 'User',
    active: true
  }]), { format: 'json' });
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.issues[0].code, 'EMPLOYEE_ID_NUMERIC_UNSAFE');
});

test('CSV employee IDs remain text so leading zeroes are preserved', () => {
  const parsed = parseEmployeeMasterText([
    'employee_id,display_name,pickup_floor,role,active',
    '001234,CSV Employee,1樓,User,true'
  ].join('\n'), { format: 'csv', sourceName: 'employee-master.csv' });
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.records[0].employeeId, '001234');
});

test('employee master dry-run report is machine-readable and explicitly remote-read-only', () => {
  const parsed = parseEmployeeMasterText(JSON.stringify([]), { format: 'json' });
  const plan = planEmployeeMaster({ parsed, records: parsed.records, issues: parsed.issues });
  const report = buildEmployeeMasterReport({
    parsed,
    plan,
    sourceName: 'synthetic.json',
    generatedAt: '2026-09-10T00:00:00.000Z'
  });
  assert.equal(report.kind, 'employee-master-preload-dry-run');
  assert.equal(report.remoteMutation, 'NOT_EXECUTED');
  assert.deepEqual(report.operations, []);
});

test('employee master CLI writes a create-only local report and never opens D1', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bento-employee-master-'));
  const inputPath = join(directory, 'employees.json');
  const outputPath = join(directory, 'report.json');
  await writeFile(inputPath, JSON.stringify([{
    employee_id: '001234',
    display_name: 'CLI Employee',
    pickup_floor: '1樓',
    role: 'User',
    active: true
  }]), 'utf8');
  try {
    const report = await runEmployeeMasterDryRun({ inputPath, outputPath });
    assert.equal(report.executable, true);
    assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).remoteMutation, 'NOT_EXECUTED');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
