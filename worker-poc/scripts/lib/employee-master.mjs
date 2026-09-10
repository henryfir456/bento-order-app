import {
  asText,
  parseBoolean,
  parseEmployeeId,
  sourceHashForBytes,
  stableId
} from './import-contract.mjs';

export const EMPLOYEE_MASTER_VERSION = 'identity-foundation-v1';

export const EMPLOYEE_MASTER_FIELDS = Object.freeze([
  'employee_id',
  'display_name',
  'pickup_floor',
  'role',
  'active',
  'line_user_id',
  'mapping_evidence'
]);

export const EMPLOYEE_MASTER_ISSUES = Object.freeze({
  INVALID_INPUT: 'EMPLOYEE_MASTER_INVALID_INPUT',
  INVALID_ROW: 'EMPLOYEE_MASTER_INVALID_ROW',
  UNKNOWN_FIELD: 'EMPLOYEE_MASTER_UNKNOWN_FIELD',
  REQUIRED: 'EMPLOYEE_MASTER_REQUIRED',
  INVALID_FLOOR: 'INVALID_PICKUP_FLOOR',
  INVALID_ROLE: 'INVALID_ROLE',
  INVALID_ACTIVE: 'EMPLOYEE_MASTER_INVALID_ACTIVE',
  DUPLICATE_EMPLOYEE: 'EMPLOYEE_ID_DUPLICATE',
  DUPLICATE_LINE: 'EMPLOYEE_MASTER_LINE_ID_DUPLICATE',
  MAPPING_EVIDENCE_REQUIRED: 'EXPLICIT_MAPPING_REQUIRED',
  MAPPING_TARGET_NOT_FOUND: 'EMPLOYEE_MASTER_LINE_MAPPING_TARGET_NOT_FOUND',
  EMPLOYEE_LINE_CONFLICT: 'EMPLOYEE_MASTER_EMPLOYEE_LINE_CONFLICT',
  EXISTING_SNAPSHOT_CONFLICT: 'EMPLOYEE_MASTER_EXISTING_SNAPSHOT_CONFLICT'
});

const VALID_FLOORS = new Set(['1樓', '9樓']);
const VALID_ROLES = new Set(['User', 'ProxyAdmin', 'Admin']);
const ALLOWED_FIELDS = new Set(EMPLOYEE_MASTER_FIELDS);

const issue = (sourceRow, code, field = null, details = {}) => ({
  sourceRow,
  code,
  ...(field ? { field } : {}),
  ...details
});

const isRecord = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell === '') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('Unclosed CSV quote.');
  if (cell !== '' || row.length > 0) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
};

export const parseEmployeeMasterCsv = (text) => {
  if (typeof text !== 'string') throw new TypeError('Employee master CSV must be text.');
  const rows = parseCsvRows(text).filter((row) => row.some((value) => String(value).trim() !== ''));
  if (!rows.length) return [];

  const headers = rows[0].map((header) => String(header).trim());
  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? ''])
  ));
};

const normalizedRawRow = (row) => Object.fromEntries(
  Object.entries(row).map(([key, value]) => [String(key).trim(), value])
);

export const normalizeEmployeeMasterRows = (rows, { sourceName = 'employee-master' } = {}) => {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const issues = [];
  const records = [];
  const employeeIds = new Set();
  const lineUserIds = new Set();

  if (!Array.isArray(rows)) {
    issues.push(issue(0, EMPLOYEE_MASTER_ISSUES.INVALID_INPUT, null, {
      message: 'Employee master must be an array of rows.'
    }));
  }

  sourceRows.forEach((rawRow, index) => {
    const sourceRow = index + 2;
    if (!isRecord(rawRow)) {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.INVALID_ROW, null, {
        message: 'Each employee master row must be an object.'
      }));
      return;
    }

    const row = normalizedRawRow(rawRow);
    const unknownFields = Object.keys(row).filter((field) => !ALLOWED_FIELDS.has(field));
    let invalid = false;
    if (unknownFields.length) {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.UNKNOWN_FIELD, null, {
        fields: unknownFields
      }));
      invalid = true;
    }

    const parsedEmployeeId = parseEmployeeId(row.employee_id);
    if (parsedEmployeeId.code) {
      issues.push(issue(sourceRow, parsedEmployeeId.code, 'employee_id'));
      invalid = true;
    }

    const displayName = asText(row.display_name).trim();
    if (!displayName) {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.REQUIRED, 'display_name'));
      invalid = true;
    }

    const pickupFloor = asText(row.pickup_floor).trim();
    if (!VALID_FLOORS.has(pickupFloor)) {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.INVALID_FLOOR, 'pickup_floor'));
      invalid = true;
    }

    const role = asText(row.role).trim();
    if (!VALID_ROLES.has(role)) {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.INVALID_ROLE, 'role'));
      invalid = true;
    }

    const active = parseBoolean(row.active);
    if (active === null) {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.INVALID_ACTIVE, 'active'));
      invalid = true;
    }

    const lineUserId = asText(row.line_user_id).trim() || null;
    const mappingEvidence = asText(row.mapping_evidence).trim().toLowerCase() || null;
    if (lineUserId && mappingEvidence !== 'reviewed') {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.MAPPING_EVIDENCE_REQUIRED, 'mapping_evidence', {
        employeeId: parsedEmployeeId.value,
        lineUserId
      }));
      invalid = true;
    }
    if (mappingEvidence && mappingEvidence !== 'reviewed') {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.MAPPING_EVIDENCE_REQUIRED, 'mapping_evidence'));
      invalid = true;
    }

    const employeeId = parsedEmployeeId.value;
    if (employeeId && employeeIds.has(employeeId)) {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.DUPLICATE_EMPLOYEE, 'employee_id', {
        employeeId
      }));
      invalid = true;
    }
    if (lineUserId && lineUserIds.has(lineUserId)) {
      issues.push(issue(sourceRow, EMPLOYEE_MASTER_ISSUES.DUPLICATE_LINE, 'line_user_id', {
        lineUserId
      }));
      invalid = true;
    }

    if (invalid) return;

    employeeIds.add(employeeId);
    if (lineUserId) lineUserIds.add(lineUserId);
    records.push({
      source: { file: sourceName, row: sourceRow },
      employeeId,
      displayName,
      pickupFloor,
      role,
      active,
      lineUserId,
      mappingEvidence
    });
  });

  return {
    records,
    issues,
    summary: {
      rows: sourceRows.length,
      valid: records.length,
      invalid: issues.length
    }
  };
};

export const parseEmployeeMasterText = (
  text,
  { format = 'auto', sourceName = 'employee-master' } = {}
) => {
  if (typeof text !== 'string') throw new TypeError('Employee master input must be text.');
  const normalizedFormat = format === 'auto'
    ? (/\.csv$/i.test(sourceName) ? 'csv' : 'json')
    : String(format).trim().toLowerCase();
  let rows;
  if (normalizedFormat === 'csv') {
    rows = parseEmployeeMasterCsv(text);
  } else if (normalizedFormat === 'json') {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        format: normalizedFormat,
        sourceHash: sourceHashForBytes(Buffer.from(text, 'utf8')),
        records: [],
        issues: [issue(0, EMPLOYEE_MASTER_ISSUES.INVALID_INPUT, null, {
          message: 'Employee master JSON is invalid.'
        })],
        summary: { rows: 0, valid: 0, invalid: 1 }
      };
    }
    rows = Array.isArray(parsed) ? parsed : parsed?.employees;
  } else {
    throw new Error(`Unsupported employee master format: ${normalizedFormat}`);
  }

  return {
    format: normalizedFormat,
    sourceHash: sourceHashForBytes(Buffer.from(text, 'utf8')),
    ...normalizeEmployeeMasterRows(rows, { sourceName })
  };
};

const existingUserShape = (user) => ({
  userId: asText(user?.userId ?? user?.user_id).trim(),
  employeeId: asText(user?.employeeId ?? user?.employee_id).trim() || null,
  lineUserId: asText(user?.lineUserId ?? user?.line_user_id).trim() || null,
  displayName: asText(user?.displayName ?? user?.display_name).trim(),
  pickupFloor: asText(user?.pickupFloor ?? user?.pickup_floor).trim(),
  role: asText(user?.role).trim(),
  active: Boolean(user?.active)
});

const countTemplate = () => ({
  insert: 0,
  update: 0,
  skip: 0,
  conflict: 0,
  invalid: 0
});

const sameManagedFields = (existing, record, lineUserId) => (
  existing.employeeId === record.employeeId
  && existing.lineUserId === lineUserId
  && existing.displayName === record.displayName
  && existing.pickupFloor === record.pickupFloor
  && existing.role === record.role
  && existing.active === record.active
);

export const planEmployeeMaster = ({
  records = [],
  issues = [],
  existingUsers = []
} = {}) => {
  const counts = countTemplate();
  counts.invalid = new Set(issues.map((item) => item.sourceRow ?? 0)).size;
  const blockers = issues.map((item) => ({ ...item, kind: 'invalid' }));
  const byEmployee = new Map();
  const byLine = new Map();

  for (const rawUser of Array.isArray(existingUsers) ? existingUsers : []) {
    const user = existingUserShape(rawUser);
    if (!user.userId) continue;
    if (user.employeeId) {
      if (byEmployee.has(user.employeeId)) {
        blockers.push({
          code: EMPLOYEE_MASTER_ISSUES.EXISTING_SNAPSHOT_CONFLICT,
          kind: 'conflict',
          employeeId: user.employeeId,
          message: 'Existing snapshot contains duplicate employee IDs.'
        });
      } else {
        byEmployee.set(user.employeeId, user);
      }
    }
    if (user.lineUserId) {
      if (byLine.has(user.lineUserId)) {
        blockers.push({
          code: EMPLOYEE_MASTER_ISSUES.EXISTING_SNAPSHOT_CONFLICT,
          kind: 'conflict',
          lineUserId: user.lineUserId,
          message: 'Existing snapshot contains duplicate LINE IDs.'
        });
      } else {
        byLine.set(user.lineUserId, user);
      }
    }
  }

  const operations = [];
  const plannedEmployeeIds = new Set();
  const plannedLineIds = new Set();

  for (const record of records) {
    const existingByEmployee = byEmployee.get(record.employeeId) || null;
    const existingByLine = record.lineUserId ? byLine.get(record.lineUserId) || null : null;

    if (plannedEmployeeIds.has(record.employeeId)) {
      counts.conflict += 1;
      blockers.push({
        code: EMPLOYEE_MASTER_ISSUES.DUPLICATE_EMPLOYEE,
        kind: 'conflict',
        sourceRow: record.source.row,
        employeeId: record.employeeId
      });
      continue;
    }
    if (record.lineUserId && plannedLineIds.has(record.lineUserId)) {
      counts.conflict += 1;
      blockers.push({
        code: EMPLOYEE_MASTER_ISSUES.DUPLICATE_LINE,
        kind: 'conflict',
        sourceRow: record.source.row,
        lineUserId: record.lineUserId
      });
      continue;
    }

    if (existingByEmployee && existingByLine && existingByEmployee.userId !== existingByLine.userId) {
      counts.conflict += 1;
      blockers.push({
        code: EMPLOYEE_MASTER_ISSUES.EMPLOYEE_LINE_CONFLICT,
        kind: 'conflict',
        sourceRow: record.source.row,
        employeeId: record.employeeId,
        lineUserId: record.lineUserId,
        employeeUserId: existingByEmployee.userId,
        lineUserIdOwner: existingByLine.userId
      });
      continue;
    }

    if (record.lineUserId && !existingByLine) {
      counts.conflict += 1;
      blockers.push({
        code: EMPLOYEE_MASTER_ISSUES.MAPPING_TARGET_NOT_FOUND,
        kind: 'conflict',
        sourceRow: record.source.row,
        employeeId: record.employeeId,
        lineUserId: record.lineUserId
      });
      continue;
    }

    const existing = existingByEmployee || existingByLine;
    if (!existing) {
      const operation = {
        type: 'insert',
        userId: stableId('employee', record.employeeId),
        employeeId: record.employeeId,
        lineUserId: null,
        displayName: record.displayName,
        pickupFloor: record.pickupFloor,
        role: record.role,
        active: record.active,
        sourceRow: record.source.row
      };
      counts.insert += 1;
      operations.push(operation);
      plannedEmployeeIds.add(record.employeeId);
      continue;
    }

    const nextLineUserId = record.lineUserId || existing.lineUserId || null;
    if (sameManagedFields(existing, record, nextLineUserId)) {
      counts.skip += 1;
      plannedEmployeeIds.add(record.employeeId);
      if (nextLineUserId) plannedLineIds.add(nextLineUserId);
      continue;
    }

    const operation = {
      type: 'update',
      userId: existing.userId,
      employeeId: record.employeeId,
      lineUserId: nextLineUserId,
      displayName: record.displayName,
      pickupFloor: record.pickupFloor,
      role: record.role,
      active: record.active,
      sourceRow: record.source.row
    };
    counts.update += 1;
    operations.push(operation);
    plannedEmployeeIds.add(record.employeeId);
    if (nextLineUserId) plannedLineIds.add(nextLineUserId);
  }

  const conflictCount = blockers.filter((item) => item.kind === 'conflict').length;
  counts.conflict = Math.max(counts.conflict, conflictCount);
  const executable = blockers.length === 0;
  return {
    executable,
    counts,
    blockers,
    operations: executable ? operations : []
  };
};

export const buildEmployeeMasterReport = ({
  parsed,
  plan,
  sourceName = 'employee-master',
  generatedAt = new Date().toISOString()
} = {}) => ({
  kind: 'employee-master-preload-dry-run',
  version: EMPLOYEE_MASTER_VERSION,
  generatedAt,
  source: {
    name: sourceName,
    format: parsed?.format || null,
    sha256: parsed?.sourceHash || null
  },
  counts: plan?.counts || countTemplate(),
  executable: Boolean(plan?.executable),
  blockers: plan?.blockers || [],
  operations: plan?.operations || [],
  remoteMutation: 'NOT_EXECUTED'
});
