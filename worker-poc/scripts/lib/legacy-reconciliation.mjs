import { createHash } from 'node:crypto';

import {
  SHEET_NAMES,
  asNullableText,
  asText,
  cloneJson,
  parseEmployeeId,
  parseInteger,
  stableId
} from './import-contract.mjs';
import { sqlHistoricalProvisionalUser } from './provisional-profile-policy.mjs';

export const ACTIONS = Object.freeze({
  CREATE_CANONICAL: 'CREATE_CANONICAL',
  MERGE_EXISTING_NONLINE: 'MERGE_EXISTING_NONLINE',
  MERGE_EXISTING_LINE: 'MERGE_EXISTING_LINE',
  NO_CHANGE: 'NO_CHANGE',
  REVIEW_BALANCE: 'REVIEW_BALANCE',
  AMBIGUOUS: 'AMBIGUOUS',
  ERROR: 'ERROR'
});

const ACTION_VALUES = Object.values(ACTIONS);
const HISTORICAL_SHEETS = ['Orders', 'Likes', 'TopupHistory'];
const VALID_ROLES = new Set(['User', 'ProxyAdmin', 'Admin']);
const VALID_FLOORS = new Set(['1樓', '9樓']);
const VALID_ORDER_STATUSES = new Set(['ACTIVE', 'CANCELLED', 'COMPLETED']);
const ROLE_RANK = Object.freeze({ User: 1, ProxyAdmin: 2, Admin: 3 });

const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const sourceOf = (record) => ({
  sheet: asText(record?.source?.sheet).trim() || 'unknown',
  row: Number(record?.source?.row || 0)
});

const sourceReference = (record) => {
  const source = sourceOf(record);
  return `${source.sheet}:${source.row}`;
};

const normalizeEmployeeId = (value) => {
  const parsed = parseEmployeeId(value);
  if (!parsed.value) return parsed;
  return { value: parsed.value.trim().toUpperCase(), code: null };
};

const directEmployeeIdentity = (record) => {
  if (record?.employeeId) {
    const parsed = normalizeEmployeeId(record.employeeId);
    return { ...parsed, source: 'workbook' };
  }
  return {
    value: null,
    code: record?.employeeIdIssue || 'EMPLOYEE_ID_REQUIRED',
    source: null
  };
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
};

const stableStringify = (value) => JSON.stringify(stableValue(value));

const hashPlan = (value) => createHash('sha256')
  .update(stableStringify(value))
  .digest('hex');

const parseSnapshotActive = (value) => {
  if (value === false || value === 0 || String(value).trim().toLowerCase() === 'false') return false;
  return true;
};

const makeKeySet = (value) => new Set((Array.isArray(value) ? value : []).map((item) => {
  if (typeof item === 'string') return item;
  if (!isPlainObject(item)) return null;
  return item.key || item.id || item.order_id || item.transaction_id || null;
}).filter(Boolean));

const publicSnapshotUser = (user) => ({
  user_id: user.user_id,
  employee_id: user.employee_id,
  line_user_id: user.line_user_id,
  display_name: user.display_name,
  pickup_floor: user.pickup_floor,
  balance: user.balance,
  role: user.role,
  active: user.active,
  verification_status: user.verification_status
});

export const normalizeD1Snapshot = (snapshot) => {
  if (snapshot === undefined || snapshot === null) {
    return {
      provided: false,
      users: [],
      ownersByEmployeeId: new Map(),
      ownersByLineUserId: new Map(),
      existingKeys: {
        orders: new Set(),
        likes: new Set(),
        balanceLedger: new Set(),
        openingBalanceSnapshots: new Set()
      },
      errors: [],
      conflicts: [],
      public: null
    };
  }

  const errors = [];
  const conflicts = [];
  if (!isPlainObject(snapshot)) {
    return {
      provided: true,
      users: [],
      ownersByEmployeeId: new Map(),
      ownersByLineUserId: new Map(),
      existingKeys: { orders: new Set(), likes: new Set(), balanceLedger: new Set(), openingBalanceSnapshots: new Set() },
      errors: [{ code: 'D1_SNAPSHOT_INVALID', reason: 'snapshot must be an object' }],
      conflicts,
      public: null
    };
  }

  const rawUsers = snapshot.users;
  if (!Array.isArray(rawUsers)) {
    errors.push({ code: 'D1_USERS_REQUIRED', reason: 'snapshot.users must be an array' });
  }

  const users = [];
  const ownersByEmployeeId = new Map();
  const ownersByLineUserId = new Map();
  for (const [index, rawUser] of (Array.isArray(rawUsers) ? rawUsers : []).entries()) {
    const userId = asNullableText(rawUser?.user_id ?? rawUser?.userId);
    const rawEmployeeId = rawUser?.employee_id ?? rawUser?.employeeId;
    const employee = asNullableText(rawEmployeeId)
      ? normalizeEmployeeId(rawEmployeeId)
      : { value: null, code: null };
    const role = asNullableText(rawUser?.role);
    const balance = parseInteger(rawUser?.balance);
    const user = {
      user_id: userId,
      employee_id: employee.value,
      line_user_id: asNullableText(rawUser?.line_user_id ?? rawUser?.lineUserId),
      display_name: asNullableText(rawUser?.display_name ?? rawUser?.displayName),
      pickup_floor: asNullableText(rawUser?.pickup_floor ?? rawUser?.pickupFloor),
      balance,
      role,
      active: parseSnapshotActive(rawUser?.active),
      verification_status: asNullableText(rawUser?.verification_status ?? rawUser?.verificationStatus),
      sourceIndex: index
    };
    const invalid = [];
    if (!user.user_id) invalid.push('user_id');
    if (employee.code && !employee.value) invalid.push(employee.code);
    if (!user.role || !VALID_ROLES.has(user.role)) invalid.push('role');
    if (!Number.isSafeInteger(user.balance)) invalid.push('balance');
    if (invalid.length) {
      errors.push({ code: 'D1_USER_INVALID', sourceIndex: index, fields: invalid });
      continue;
    }
    users.push(user);
    const employeeOwners = ownersByEmployeeId.get(user.employee_id) || [];
    employeeOwners.push(user);
    ownersByEmployeeId.set(user.employee_id, employeeOwners);
    if (user.line_user_id) {
      const lineOwners = ownersByLineUserId.get(user.line_user_id) || [];
      lineOwners.push(user);
      ownersByLineUserId.set(user.line_user_id, lineOwners);
    }
  }

  for (const [employeeId, owners] of ownersByEmployeeId) {
    if (owners.length > 1) {
      conflicts.push({
        flag: 'MULTIPLE_CANONICAL_OWNERS',
        employeeId,
        userIds: owners.map((owner) => owner.user_id).sort()
      });
    }
  }
  for (const [lineUserId, owners] of ownersByLineUserId) {
    if (owners.length > 1) {
      conflicts.push({
        flag: 'LINE_OWNERSHIP_CONFLICT',
        lineUserId,
        userIds: owners.map((owner) => owner.user_id).sort()
      });
    }
  }

  const existingKeys = {
    orders: makeKeySet(snapshot.existingKeys?.orders),
    likes: makeKeySet(snapshot.existingKeys?.likes),
    balanceLedger: makeKeySet(snapshot.existingKeys?.balanceLedger),
    openingBalanceSnapshots: makeKeySet(snapshot.existingKeys?.openingBalanceSnapshots)
  };
  return {
    provided: true,
    users,
    ownersByEmployeeId,
    ownersByLineUserId,
    existingKeys,
    errors,
    conflicts,
    public: {
      snapshotVersion: snapshot.snapshotVersion ?? 1,
      users: users.map(publicSnapshotUser),
      existingKeys: {
        orders: [...existingKeys.orders].sort(),
        likes: [...existingKeys.likes].sort(),
        balanceLedger: [...existingKeys.balanceLedger].sort(),
        openingBalanceSnapshots: [...existingKeys.openingBalanceSnapshots].sort()
      }
    }
  };
};

const sourceInventory = (workbook, normalized) => {
  const sources = workbook?.sheets || workbook || {};
  return SHEET_NAMES.map((sheetName) => {
    const source = sources[sheetName];
    const headers = Array.isArray(source?.headers)
      ? source.headers.slice()
      : (Array.isArray(source) && Array.isArray(source[0]) ? source[0].slice() : []);
    const rows = Array.isArray(source?.rows)
      ? source.rows
      : (Array.isArray(source) ? source.slice(1) : (normalized?.[sheetName] || []));
    const nonEmptyRows = rows.filter((row) => {
      if (Array.isArray(row)) return row.some((value) => value !== null && value !== undefined && String(value).trim() !== '');
      return isPlainObject(row) && Object.entries(row).some(([key, value]) => (
        !['source', 'raw'].includes(key)
        && value !== null && value !== undefined && String(value).trim() !== ''
      ));
    }).length;
    return {
      sheet: sheetName,
      headers,
      rowCount: rows.length,
      nonEmptyRowCount: nonEmptyRows
    };
  });
};

const recordsFor = (normalized, sheetName) => (
  Array.isArray(normalized?.[sheetName]) ? normalized[sheetName] : []
);

const userFieldsValid = (record) => (
  Boolean(asNullableText(record?.displayName))
  && VALID_FLOORS.has(record?.pickupFloor)
  && Number.isSafeInteger(record?.balance)
  && VALID_ROLES.has(record?.role)
);

const actionForOwner = (owner) => owner?.line_user_id
  ? ACTIONS.MERGE_EXISTING_LINE
  : ACTIONS.MERGE_EXISTING_NONLINE;

const lineStateFor = (owner, { ambiguous = false, snapshotAvailable = true } = {}) => {
  if (ambiguous) return 'AMBIGUOUS';
  if (!snapshotAvailable) return 'UNKNOWN';
  if (!owner) return 'NO_OWNER';
  return owner.line_user_id ? 'LINE_BOUND' : 'NONLINE';
};

const sourceShapeIssueFor = (normalized, sheetName, code) => (
  (normalized?.shapeIssues || []).find((issue) => issue.sheet === sheetName && issue.code === code)
);

const commonRow = ({ record, employee, owner, existingRole, legacyRole, existingBalance, legacyBalance, action, reason, flags = [], preview = null, lineState }) => {
  const source = sourceOf(record);
  const legacyName = asNullableText(record?.displayName ?? record?.name);
  return {
    legacySourceRow: source,
    legacySourceReference: `${source.sheet}:${source.row}`,
    normalizedEmployeeId: employee?.value || null,
    legacyName,
    targetCanonicalUserId: owner?.user_id || null,
    currentLineBindingState: lineState,
    existingRole: existingRole || null,
    legacyRole: legacyRole || null,
    existingBalance: existingBalance ?? null,
    legacyBalance: legacyBalance ?? null,
    plannedAction: action,
    reason,
    mutationPreview: preview,
    conflictFlags: [...new Set(flags)].sort(),
    ambiguityConflictFlags: [...new Set(flags)].sort()
  };
};

const createPreviewFor = (record, employee) => ({
  execute: false,
  kind: 'CREATE_CANONICAL_USER_PREVIEW',
  user: {
    user_id: stableId('user', employee.value),
    employee_id: employee.value,
    line_user_id: null,
    display_name: asNullableText(record.displayName),
    pickup_floor: asNullableText(record.pickupFloor),
    balance: record.balance,
    role: record.role,
    active: record.active === false ? false : true
  },
  balancePolicy: 'OPENING_SNAPSHOT_ONLY',
  ledgerMutation: false,
  sideEffect: false
});

const deterministicCandidateFor = (employee, snapshot) => {
  const target = stableId('user', employee.value);
  if (snapshot.users.some((user) => user.user_id === target)) {
    return {
      target: null,
      flags: ['DETERMINISTIC_USER_ID_COLLISION']
    };
  }
  return { target, flags: [], plannedCreate: true };
};

const provisionalCandidateFor = (employee) => (
  sqlHistoricalProvisionalUser(employee.value)
);

const reviewPreview = (reason, extra = {}) => ({
  execute: false,
  kind: 'REVIEW_ONLY',
  reason,
  ledgerMutation: false,
  sideEffect: false,
  ...extra
});

const relationshipPreview = (table, record, targetUserId, fields = {}) => ({
  execute: false,
  kind: 'HISTORICAL_RELATIONSHIP_PREVIEW',
  relationship: {
    targetTable: table,
    targetUserId,
    sourceReference: sourceReference(record)
  },
  fields,
  ledgerMutation: false,
  sideEffect: false
});

const countActions = (rows) => {
  const counts = Object.fromEntries(ACTION_VALUES.map((action) => [action, 0]));
  for (const row of rows) counts[row.plannedAction] += 1;
  return counts;
};

const buildEmployeeGroups = (records) => {
  const groups = new Map();
  for (const record of records) {
    const employee = directEmployeeIdentity(record);
    if (!employee.value) continue;
    const group = groups.get(employee.value) || [];
    group.push({ record, employee });
    groups.set(employee.value, group);
  }
  return groups;
};

const buildOrderConflictIds = (records) => {
  const groups = new Map();
  for (const record of records) {
    const orderId = asNullableText(record?.orderId);
    if (!orderId) continue;
    const group = groups.get(orderId) || [];
    group.push(record);
    groups.set(orderId, group);
  }
  const conflicts = new Set();
  for (const [orderId, group] of groups) {
    const owners = new Set(group.map((record) => directEmployeeIdentity(record).value).filter(Boolean));
    const statuses = new Set(group.map((record) => record.status).filter(Boolean));
    if (owners.size > 1 || statuses.size > 1) conflicts.add(orderId);
  }
  return conflicts;
};

const targetResolution = ({ record, employee, snapshot, sourceUserTargets, sourceUserGroups }) => {
  if (!employee.value) return { owner: null, target: null, flags: [employee.code || 'EMPLOYEE_ID_REQUIRED'] };
  if (!snapshot.provided) return { owner: null, target: null, flags: ['D1_SNAPSHOT_REQUIRED'], error: true };
  if (snapshot.errors.length) return { owner: null, target: null, flags: ['D1_SNAPSHOT_INVALID'], error: true };
  if (snapshot.conflicts.some((conflict) => conflict.employeeId === employee.value)) {
    return { owner: null, target: null, flags: ['MULTIPLE_CANONICAL_OWNERS'] };
  }

  const owners = snapshot.ownersByEmployeeId.get(employee.value) || [];
  if (owners.length > 1) return { owner: null, target: null, flags: ['MULTIPLE_CANONICAL_OWNERS'] };
  const owner = owners[0] || null;
  const lineUserId = asNullableText(record?.lineUserId);
  const lineOwners = lineUserId ? (snapshot.ownersByLineUserId.get(lineUserId) || []) : [];
  if (lineOwners.some((lineOwner) => !owner || lineOwner.user_id !== owner.user_id)) {
    return { owner: null, target: null, flags: ['LINE_OWNERSHIP_CONFLICT'] };
  }
  if (owner?.line_user_id && lineUserId && owner.line_user_id !== lineUserId) {
    return { owner: null, target: null, flags: ['LINE_BINDING_CONFLICT'] };
  }
  if (owner && !owner.active) {
    return { owner: null, target: null, flags: ['INACTIVE_CANONICAL_OWNER'] };
  }
  if (owner) return { owner, target: owner.user_id, flags: [] };

  const sourceGroup = sourceUserGroups.get(employee.value) || [];
  const planned = sourceUserTargets.get(employee.value);
  if (sourceGroup.length === 0) {
    return deterministicCandidateFor(employee, snapshot);
  }
  if (sourceGroup.length !== 1) {
    return { owner: null, target: null, flags: ['NO_CANONICAL_OWNER'] };
  }
  if (!planned?.target && sourceOf(record).sheet === 'Users') {
    return {
      owner: null,
      target: stableId('user', employee.value),
      flags: [],
      plannedCreate: true
    };
  }
  if (!planned?.target) return { owner: null, target: null, flags: ['NO_CANONICAL_OWNER'] };
  return { owner: null, target: planned.target, flags: [], plannedCreate: true };
};

const historicalReasonFor = (sheetName) => {
  if (sheetName === 'Orders') return 'DETERMINISTIC_ORDER_USER_LINK_PREVIEW';
  if (sheetName === 'Likes') return 'DETERMINISTIC_LIKE_USER_LINK_PREVIEW';
  return 'HISTORICAL_LEDGER_POLICY_REQUIRED';
};

const historicalFieldsFor = (sheetName, record, employee, target) => {
  if (sheetName === 'Orders') return {
    user_id: target,
    employee_id_snapshot: employee.value,
    line_user_id_snapshot: asNullableText(record.lineUserId),
    display_name_snapshot: asNullableText(record.displayName),
    created_auth_mode: 'legacy_import'
  };
  if (sheetName === 'Likes') return {
    user_id: target,
    employee_id: employee.value
  };
  return {
    user_id: target,
    employee_id_snapshot: employee.value,
    policy: 'NO_SYNTHETIC_LEDGER_OR_ADJUSTMENT'
  };
};

const buildLegacyReconciliationPlanFromWorkbook = ({
  normalized = {},
  validation = null,
  workbook = null,
  d1Snapshot,
  sourceHash = normalized.sourceHash || 'unknown-source',
  importerVersion = normalized.importerVersion || 'unknown-version'
} = {}) => {
  const snapshot = normalizeD1Snapshot(d1Snapshot);
  const users = recordsFor(normalized, 'Users');
  const historical = HISTORICAL_SHEETS.flatMap((sheetName) => recordsFor(normalized, sheetName));
  const userGroups = buildEmployeeGroups(users);
  const historicalGroups = buildEmployeeGroups(historical);
  const normalizationCollisions = [...userGroups.values()].filter((group) => group.length > 1).length;
  const historicalOrderConflicts = buildOrderConflictIds(recordsFor(normalized, 'Orders'));
  const historyByEmployee = new Set([...historicalGroups.keys()]);
  const userRows = [];
  const sourceUserTargets = new Map();

  for (const record of users) {
    const employee = directEmployeeIdentity(record);
    const group = employee.value ? userGroups.get(employee.value) || [] : [];
    const flags = [];
    let action = ACTIONS.AMBIGUOUS;
    let reason = 'EMPLOYEE_ID_REQUIRED';
    let owner = null;
    let preview = null;
    let target = null;
    let error = false;

    if (!employee.value) {
      flags.push(employee.code || 'EMPLOYEE_ID_REQUIRED');
      error = employee.code && employee.code !== 'EMPLOYEE_ID_REQUIRED';
      action = error ? ACTIONS.ERROR : ACTIONS.AMBIGUOUS;
      reason = error ? 'INVALID_WORKBOOK_USERNAME' : 'DIRECT_WORKBOOK_USERNAME_REQUIRED';
    } else if (group.length > 1) {
      flags.push('NORMALIZED_EMPLOYEE_COLLISION');
      action = ACTIONS.AMBIGUOUS;
      reason = 'MULTIPLE_LEGACY_ROWS_SHARE_NORMALIZED_EMPLOYEE_ID';
    } else if (!snapshot.provided) {
      flags.push('D1_SNAPSHOT_REQUIRED');
      action = ACTIONS.ERROR;
      reason = 'OFFLINE_D1_SNAPSHOT_REQUIRED_FOR_OWNER_CLASSIFICATION';
      error = true;
    } else if (snapshot.errors.length) {
      flags.push('D1_SNAPSHOT_INVALID');
      action = ACTIONS.ERROR;
      reason = 'D1_SNAPSHOT_HAS_INVALID_ROWS';
      error = true;
    } else {
      const resolution = targetResolution({
        record,
        employee,
        snapshot,
        sourceUserTargets,
        sourceUserGroups: userGroups
      });
      flags.push(...resolution.flags);
      owner = resolution.owner;
      target = resolution.target;
      if (resolution.flags.includes('MULTIPLE_CANONICAL_OWNERS')
        || resolution.flags.includes('LINE_OWNERSHIP_CONFLICT')
        || resolution.flags.includes('LINE_BINDING_CONFLICT')
        || resolution.flags.includes('DETERMINISTIC_USER_ID_COLLISION')) {
        action = ACTIONS.AMBIGUOUS;
        reason = 'CANONICAL_OWNERSHIP_OR_LINE_BINDING_CONFLICT';
      } else if (!owner && resolution.plannedCreate) {
        if (!userFieldsValid(record)) {
          flags.push('INVALID_CREATE_PAYLOAD');
          action = ACTIONS.ERROR;
          reason = 'LEGACY_USER_FIELDS_ARE_NOT_SAFE_TO_CARRY_FORWARD';
          error = true;
        } else if (!VALID_ROLES.has(record.role)) {
          flags.push('INVALID_ROLE');
          action = ACTIONS.ERROR;
          reason = 'LEGACY_ROLE_INVALID';
          error = true;
        } else if (ROLE_RANK[record.role] > ROLE_RANK.User) {
          flags.push('ROLE_ESCALATION_REVIEW');
          action = ACTIONS.AMBIGUOUS;
          reason = 'NEW_CANONICAL_PRIVILEGED_ROLE_REQUIRES_REVIEW';
        } else {
          action = ACTIONS.CREATE_CANONICAL;
          reason = 'NO_CANONICAL_OWNER_FOR_NORMALIZED_EMPLOYEE_ID';
          target = stableId('user', employee.value);
          preview = createPreviewFor(record, employee);
        }
      } else if (!owner && !target) {
        flags.push('NO_CANONICAL_OWNER');
        action = ACTIONS.AMBIGUOUS;
        reason = 'NO_CANONICAL_OWNER_SOURCE_FOR_RECONCILIATION';
      } else if (owner) {
        if (ROLE_RANK[record.role] > ROLE_RANK[owner.role]) {
          flags.push('ROLE_ESCALATION_REVIEW');
          action = ACTIONS.AMBIGUOUS;
          reason = 'LEGACY_ROLE_EXCEEDS_EXISTING_AUTHORITATIVE_ROLE';
        } else if (record.balance !== owner.balance) {
          flags.push('BALANCE_MISMATCH');
          action = ACTIONS.REVIEW_BALANCE;
          reason = 'LEGACY_BALANCE_DIFFERS_FROM_CANONICAL_BALANCE';
          preview = reviewPreview(reason, {
            legacyBalance: record.balance,
            existingBalance: owner.balance
          });
        } else {
          const sameSafeFields = record.displayName === owner.display_name
            && record.pickupFloor === owner.pickup_floor
            && record.role === owner.role
            && (record.active === null || Boolean(record.active) === Boolean(owner.active));
          const lineEvidenceMatches = !record.lineUserId || record.lineUserId === owner.line_user_id;
          if (sameSafeFields && lineEvidenceMatches && !historyByEmployee.has(employee.value)) {
            action = ACTIONS.NO_CHANGE;
            reason = 'CANONICAL_USER_STATE_ALREADY_MATCHES_AND_NO_HISTORY_LINK_REQUIRED';
          } else {
            action = actionForOwner(owner);
            reason = owner.line_user_id
              ? 'EXISTING_LINE_BOUND_CANONICAL_OWNER_IS_TARGET'
              : 'EXISTING_NONLINE_CANONICAL_OWNER_IS_TARGET';
            if (record.displayName !== owner.display_name) flags.push('DISPLAY_NAME_EVIDENCE_DIFFERS');
            if (record.pickupFloor !== owner.pickup_floor) flags.push('PICKUP_FLOOR_EVIDENCE_DIFFERS');
            if (record.lineUserId && !owner.line_user_id) flags.push('LINE_EVIDENCE_UNBOUND');
          }
        }
      }
    }

    if (employee.value && target) sourceUserTargets.set(employee.value, { target, action, owner });
    const existingOwner = owner || null;
    const row = commonRow({
      record,
      employee,
      owner: existingOwner,
      existingRole: owner?.role,
      legacyRole: record.role,
      existingBalance: owner?.balance,
      legacyBalance: record.balance,
      action,
      reason,
      flags,
      preview,
      lineState: lineStateFor(owner, {
        ambiguous: action === ACTIONS.AMBIGUOUS || error,
        snapshotAvailable: snapshot.provided
      })
    });
    if (target) row.targetCanonicalUserId = target;
    if (!target && action === ACTIONS.CREATE_CANONICAL) row.targetCanonicalUserId = stableId('user', employee.value);
    userRows.push(row);
  }

  const historicalRows = [];
  for (const sheetName of HISTORICAL_SHEETS) {
    for (const record of recordsFor(normalized, sheetName)) {
      const employee = directEmployeeIdentity(record);
      const group = employee.value ? userGroups.get(employee.value) || [] : [];
      const flags = [];
      let action = ACTIONS.AMBIGUOUS;
      let reason = 'DIRECT_WORKBOOK_USERNAME_REQUIRED';
      let owner = null;
      let target = null;
      let preview = null;
      if (!employee.value) {
        flags.push(employee.code || 'EMPLOYEE_ID_REQUIRED');
      } else if (group.length > 1) {
        flags.push('NORMALIZED_EMPLOYEE_COLLISION');
        reason = 'HISTORICAL_ROW_HAS_COLLIDING_NORMALIZED_EMPLOYEE_ID';
      } else {
        const resolution = targetResolution({
          record,
          employee,
          snapshot,
          sourceUserTargets,
          sourceUserGroups: userGroups
        });
        flags.push(...resolution.flags);
        owner = resolution.owner;
        target = resolution.target;
        if (resolution.error) {
          action = ACTIONS.ERROR;
          reason = 'HISTORICAL_ROW_CANNOT_BE_CLASSIFIED_WITHOUT_VALID_D1_SNAPSHOT';
        } else if (flags.length) {
          action = ACTIONS.AMBIGUOUS;
          reason = 'HISTORICAL_ROW_IDENTITY_OR_OWNERSHIP_IS_NOT_PROVABLE';
        } else if (sheetName === 'Orders' && !VALID_ORDER_STATUSES.has(record.status)) {
          const shapeIssue = sourceShapeIssueFor(normalized, 'Orders', 'ORDERS_STATUS_HEADER_AMBIGUOUS');
          flags.push(shapeIssue ? 'ORDERS_STATUS_HEADER_AMBIGUOUS' : 'INVALID_ORDER_STATUS');
          action = ACTIONS.ERROR;
          reason = 'ORDER_STATUS_NOT_PROVABLY_PARSED';
        } else if (sheetName === 'Orders' && historicalOrderConflicts.has(record.orderId)) {
          flags.push('HISTORICAL_ORDER_CONFLICT');
          action = ACTIONS.AMBIGUOUS;
          reason = 'DUPLICATE_ORDER_ID_HAS_CONFLICTING_OWNER_OR_STATUS';
        } else if (sheetName === 'Orders' && snapshot.existingKeys.orders.has(record.orderId)) {
          flags.push('HISTORICAL_KEY_COLLISION');
          action = ACTIONS.AMBIGUOUS;
          reason = 'ORDER_ID_ALREADY_EXISTS_IN_D1_SNAPSHOT';
        } else if (sheetName === 'TopupHistory') {
          action = ACTIONS.REVIEW_BALANCE;
          reason = historicalReasonFor(sheetName);
          preview = reviewPreview(reason, {
            relationship: {
              targetTable: 'balance_ledger',
              targetUserId: target,
              sourceReference: sourceReference(record)
            },
            ledgerMutation: false,
            policyGate: 'EXPLICIT_BALANCE_MIGRATION_POLICY_REQUIRED'
          });
        } else {
          action = owner ? actionForOwner(owner) : ACTIONS.CREATE_CANONICAL;
          reason = historicalReasonFor(sheetName);
          preview = relationshipPreview(
            sheetName === 'Orders' ? 'orders' : 'likes',
            record,
            target,
            historicalFieldsFor(sheetName, record, employee, target)
          );
        }
      }
      const row = commonRow({
        record,
        employee,
        owner,
        existingRole: owner?.role,
        legacyRole: null,
        existingBalance: owner?.balance,
        legacyBalance: sheetName === 'TopupHistory' ? record.balanceAfter : null,
        action,
        reason,
        flags,
        preview,
        lineState: lineStateFor(owner, {
          ambiguous: action === ACTIONS.AMBIGUOUS || action === ACTIONS.ERROR,
          snapshotAvailable: snapshot.provided
        })
      });
      if (!target) row.targetCanonicalUserId = null;
      historicalRows.push(row);
    }
  }

  const reconciliationRows = [...userRows, ...historicalRows].sort((left, right) => (
    `${left.legacySourceRow.sheet}:${String(left.legacySourceRow.row).padStart(10, '0')}`
      .localeCompare(`${right.legacySourceRow.sheet}:${String(right.legacySourceRow.row).padStart(10, '0')}`)
  ));
  const unresolvedHistoricalRows = historicalRows.filter((row) => (
    !row.targetCanonicalUserId || [ACTIONS.AMBIGUOUS, ACTIONS.ERROR].includes(row.plannedAction)
  )).length;
  const conflictingHistoricalRows = historicalRows.filter((row) => row.conflictFlags.length > 0).length;
  const counts = countActions(reconciliationRows);
  const summary = {
    totalLegacyUsers: users.length,
    uniqueNormalizedEmployeeIds: userGroups.size,
    counts,
    normalizationCollisions,
    unresolvedHistoricalRows,
    conflictingHistoricalRows,
    sourceShapeIssueCount: (normalized.shapeIssues || []).length,
    d1SnapshotUsers: snapshot.users.length
  };
  const dryRunSafety = {
    rowsWritten: 0,
    changedDb: false,
    remoteMutation: false,
    productionWriteSqlExecuted: false,
    migrationApplied: false,
    deployed: false,
    mutationPreviewExecutable: false
  };
  const reportBase = {
    reportVersion: 1,
    sourceHash,
    importerVersion,
    sourceInventory: sourceInventory(workbook, normalized),
    sourceShapeIssues: cloneJson(normalized.shapeIssues || []),
    d1Snapshot: snapshot.public,
    d1SnapshotConflicts: cloneJson(snapshot.conflicts),
    d1SnapshotErrors: cloneJson(snapshot.errors),
    summary,
    reconciliationRows,
    plannedMutations: reconciliationRows
      .filter((row) => row.mutationPreview)
      .map((row) => ({ sourceReference: row.legacySourceReference, preview: row.mutationPreview })),
    dryRunSafety,
    rowsWritten: 0,
    changedDb: false,
    deterministic: true,
    validationSummary: validation?.summary
      ? {
          sourceCounts: cloneJson(validation.summary.sourceCounts || {}),
          acceptedCounts: cloneJson(validation.summary.acceptedCounts || {}),
          quarantineCount: validation.summary.quarantineCount || 0
        }
      : null
  };
  const planHash = hashPlan(reportBase);
  return { ...reportBase, planHash };
};

const currentNormalizedFor = (currentSnapshot) => (
  currentSnapshot?.normalized || currentSnapshot || {}
);

const historicalFactArrays = (historicalFacts = {}) => ({
  orders: Array.isArray(historicalFacts?.historicalOrderFacts)
    ? historicalFacts.historicalOrderFacts : [],
  likes: Array.isArray(historicalFacts?.historicalLikeFacts)
    ? historicalFacts.historicalLikeFacts : [],
  wallets: Array.isArray(historicalFacts?.historicalWalletFacts)
    ? historicalFacts.historicalWalletFacts : [],
  menus: Array.isArray(historicalFacts?.historicalMenuFacts)
    ? historicalFacts.historicalMenuFacts : [],
  types: Array.isArray(historicalFacts?.historicalTypeFacts)
    ? historicalFacts.historicalTypeFacts : []
});

const historicalFactSource = (fact) => ({
  sheet: asText(fact?.sourceTable).trim() || 'SQL',
  row: Number(fact?.sourceRow || 0)
});

const historicalFactReference = (fact) => {
  const source = historicalFactSource(fact);
  const id = asNullableText(fact?.sourceId);
  return id ? `${source.sheet}:${id}` : `${source.sheet}:row-${source.row}`;
};

const factEmployee = (fact) => {
  if (fact?.identityIssue) {
    return { value: null, code: fact.identityIssue };
  }
  return normalizeEmployeeId(fact?.normalizedEmployeeId);
};

const factName = (fact) => asNullableText(
  fact?.legacyName
  ?? fact?.rawEvidence?.display_name
  ?? fact?.rawEvidence?.name
);

const factPreview = (fact, target, canonicalUserCandidate = null) => {
  const sourceReferenceValue = historicalFactReference(fact);
  const base = {
    execute: false,
    sourceReference: sourceReferenceValue,
    sourceTable: fact.sourceTable,
    sourceId: fact.sourceId,
    sideEffect: false,
    ledgerMutation: false
  };
  if (fact.kind === 'HISTORICAL_ORDER_FACT') {
    return {
      ...base,
      kind: 'HISTORICAL_ORDER_FACT_PREVIEW',
      relationship: {
        targetTable: 'historical_order_facts',
        targetUserId: target,
        sourceReference: sourceReferenceValue
      },
      modernOrderMaterialization: false,
      syntheticOrderId: false,
      ...(canonicalUserCandidate ? { canonicalUserCandidate } : {})
    };
  }
  if (fact.kind === 'HISTORICAL_LIKE_EVENT') {
    return {
      ...base,
      kind: 'HISTORICAL_LIKE_EVENT_PREVIEW',
      relationship: {
        targetTable: 'historical_like_events',
        targetUserId: target,
        sourceReference: sourceReferenceValue
      },
      eventType: fact.originalEventType,
      eventPolicy: 'CHRONOLOGICAL_RECONCILIATION_REQUIRED',
      currentLikeMaterialization: false,
      ...(canonicalUserCandidate ? { canonicalUserCandidate } : {})
    };
  }
  if (fact.kind === 'HISTORICAL_WALLET_EVENT') {
    return {
      ...base,
      kind: 'REVIEW_ONLY',
      reason: 'HISTORICAL_WALLET_POLICY_REQUIRED',
      relationship: {
        targetTable: 'historical_wallet_evidence',
        targetUserId: target,
        sourceReference: sourceReferenceValue
      },
      eventType: fact.originalEventType,
      balanceAdjustment: false,
      policyGate: 'EXPLICIT_BALANCE_MIGRATION_POLICY_REQUIRED',
      ...(canonicalUserCandidate ? { canonicalUserCandidate } : {})
    };
  }
  return null;
};

const factKindAction = (fact, target, owner) => {
  if (!target) return ACTIONS.AMBIGUOUS;
  if (fact.kind === 'HISTORICAL_WALLET_EVENT') return ACTIONS.REVIEW_BALANCE;
  return owner ? actionForOwner(owner) : ACTIONS.CREATE_CANONICAL;
};

const buildHistoricalFactRows = ({
  facts,
  currentPlan,
  snapshot,
  normalizationCollisionIds = new Set(),
  duplicateFactReferences = new Set()
}) => {
  const currentTargets = new Map(
    currentPlan.reconciliationRows
      .filter((row) => row.legacySourceRow.sheet === 'Users' && row.normalizedEmployeeId)
      .map((row) => [row.normalizedEmployeeId, {
        target: row.targetCanonicalUserId,
        action: row.plannedAction
      }])
  );
  const rows = [];
  const allFacts = [
    ...facts.orders,
    ...facts.likes,
    ...facts.wallets
  ];
  for (const fact of allFacts) {
    const employee = factEmployee(fact);
    const flags = [];
    let owner = null;
    let target = null;
    let action = ACTIONS.AMBIGUOUS;
    let reason = 'HISTORICAL_ROW_IDENTITY_OR_OWNERSHIP_IS_NOT_PROVABLE';
    let preview = null;
    let canonicalUserCandidate = null;
    if (!employee.value) {
      flags.push(employee.code || 'EMPLOYEE_ID_REQUIRED');
      action = employee.code === 'EMPLOYEE_ID_INVALID' ? ACTIONS.ERROR : ACTIONS.AMBIGUOUS;
      reason = action === ACTIONS.ERROR
        ? 'SQL_USERNAME_IS_NOT_A_VALID_EMPLOYEE_ID'
        : 'SQL_USERNAME_REQUIRED_FOR_HISTORICAL_IDENTITY';
    } else if (duplicateFactReferences.has(historicalFactReference(fact))) {
      flags.push('DUPLICATE_HISTORICAL_SOURCE_ROW');
      reason = 'DUPLICATE_HISTORICAL_SOURCE_REFERENCE';
    } else if (!snapshot.provided) {
      flags.push('D1_SNAPSHOT_REQUIRED');
      action = ACTIONS.ERROR;
      reason = 'OFFLINE_D1_SNAPSHOT_REQUIRED_FOR_HISTORICAL_RESOLUTION';
    } else if (snapshot.errors.length) {
      flags.push('D1_SNAPSHOT_INVALID');
      action = ACTIONS.ERROR;
      reason = 'D1_SNAPSHOT_HAS_INVALID_ROWS';
    } else if (normalizationCollisionIds.has(employee.value)) {
      flags.push('NORMALIZED_EMPLOYEE_COLLISION');
      reason = 'MULTIPLE_SQL_RAW_IDENTITIES_SHARE_NORMALIZED_EMPLOYEE_ID';
    } else if (snapshot.conflicts.some((conflict) => conflict.employeeId === employee.value)) {
      flags.push('MULTIPLE_CANONICAL_OWNERS');
      reason = 'MULTIPLE_CANONICAL_OWNERS_FOR_HISTORICAL_EMPLOYEE_ID';
    } else {
      const owners = snapshot.ownersByEmployeeId.get(employee.value) || [];
      if (owners.length > 1) {
        flags.push('MULTIPLE_CANONICAL_OWNERS');
        reason = 'MULTIPLE_CANONICAL_OWNERS_FOR_HISTORICAL_EMPLOYEE_ID';
      } else {
        owner = owners[0] || null;
        const planned = currentTargets.get(employee.value);
        if (owner) {
          if (!owner.active) {
            flags.push('INACTIVE_CANONICAL_OWNER');
            reason = 'INACTIVE_CANONICAL_OWNER_REQUIRES_REVIEW';
          } else {
            target = owner.user_id;
            action = factKindAction(fact, target, owner);
            reason = owner.line_user_id
              ? 'EXISTING_LINE_BOUND_CANONICAL_OWNER_IS_TARGET'
              : 'EXISTING_NONLINE_CANONICAL_OWNER_IS_TARGET';
          }
        } else if (planned?.target && ![ACTIONS.AMBIGUOUS, ACTIONS.ERROR].includes(planned.action)) {
          target = planned.target;
          action = factKindAction(fact, target, null);
          reason = 'HISTORICAL_FACT_LINKS_TO_PLANNED_CANONICAL_TARGET';
        } else {
          const candidate = deterministicCandidateFor(employee, snapshot);
          flags.push(...candidate.flags);
          if (candidate.target) {
            target = candidate.target;
            action = factKindAction(fact, target, null);
            reason = 'SQL_ONLY_HISTORICAL_ID_PLANS_DETERMINISTIC_CANONICAL_TARGET';
            canonicalUserCandidate = provisionalCandidateFor(employee);
            if (canonicalUserCandidate.blockedByRequiredProfileFields.length > 0) {
              flags.push('CREATE_CANONICAL_BLOCKED_BY_REQUIRED_PROFILE_FIELDS');
            }
          } else {
            reason = 'SQL_ONLY_HISTORICAL_ID_CANNOT_USE_DETERMINISTIC_CANONICAL_TARGET';
          }
        }
        if (target) preview = factPreview(fact, target, canonicalUserCandidate);
      }
    }
    const source = historicalFactSource(fact);
    const row = {
      legacySourceRow: source,
      legacySourceReference: historicalFactReference(fact),
      sourceTable: fact.sourceTable,
      sourceId: fact.sourceId ?? null,
      normalizedEmployeeId: employee.value || null,
      legacyName: factName(fact),
      targetCanonicalUserId: target,
      currentLineBindingState: lineStateFor(owner, {
        ambiguous: action === ACTIONS.AMBIGUOUS || action === ACTIONS.ERROR,
        snapshotAvailable: snapshot.provided
      }),
      existingRole: owner?.role || null,
      legacyRole: null,
      existingBalance: owner?.balance ?? null,
      legacyBalance: fact.kind === 'HISTORICAL_WALLET_EVENT' ? fact.wallet ?? null : null,
      plannedAction: action,
      reason,
      mutationPreview: preview,
      conflictFlags: [...new Set(flags)].sort(),
      ambiguityConflictFlags: [...new Set(flags)].sort(),
      originalEventType: fact.originalEventType || null,
      rawEvidence: cloneJson(fact.rawEvidence || {}),
      sourceFactKind: fact.kind
    };
    rows.push(row);
  }
  return rows;
};

const classifySqlIdentityCoverage = ({ sqlIds, snapshot, normalizationCollisionIds }) => {
  const coverage = {
    existingLineBound: 0,
    existingNonLine: 0,
    missingCanonical: 0,
    inactiveRetired: 0,
    multipleOwner: 0,
    normalizationCollision: 0,
    otherAmbiguous: 0
  };
  for (const employeeId of sqlIds) {
    if (normalizationCollisionIds.has(employeeId)) {
      coverage.normalizationCollision += 1;
      continue;
    }
    const owners = snapshot.ownersByEmployeeId.get(employeeId) || [];
    const hasOwnerConflict = snapshot.conflicts.some((conflict) => (
      conflict.flag === 'MULTIPLE_CANONICAL_OWNERS'
      && conflict.employeeId === employeeId
    ));
    if (owners.length > 1 || hasOwnerConflict) {
      coverage.multipleOwner += 1;
      continue;
    }
    const owner = owners[0];
    if (!owner) {
      coverage.missingCanonical += 1;
    } else if (!owner.active) {
      coverage.inactiveRetired += 1;
    } else if (owner.line_user_id) {
      coverage.existingLineBound += 1;
    } else {
      coverage.existingNonLine += 1;
    }
  }
  return coverage;
};

export const buildLegacyReconciliationPlan = (options = {}) => {
  if (!options.currentSnapshot && !options.historicalFacts) {
    return buildLegacyReconciliationPlanFromWorkbook(options);
  }

  const currentSnapshot = options.currentSnapshot || {};
  const normalized = currentNormalizedFor(currentSnapshot);
  const currentPlan = buildLegacyReconciliationPlanFromWorkbook({
    normalized,
    validation: options.validation || null,
    workbook: currentSnapshot.workbook || null,
    d1Snapshot: options.d1Snapshot,
    sourceHash: options.sourceHashes?.excel || currentSnapshot.sourceHash || normalized.sourceHash || 'unknown-excel-source',
    importerVersion: options.importerVersion || normalized.importerVersion || 'unknown-version'
  });
  const snapshot = normalizeD1Snapshot(options.d1Snapshot);
  const facts = historicalFactArrays(options.historicalFacts);
  const normalizationCollisionIds = new Set(
    (options.historicalFacts?.normalizationCollisions || [])
      .map((collision) => normalizeEmployeeId(collision.normalizedEmployeeId).value)
      .filter(Boolean)
  );
  const allHistoricalFacts = [...facts.orders, ...facts.likes, ...facts.wallets];
  const factReferenceCounts = new Map();
  for (const fact of allHistoricalFacts) {
    const reference = historicalFactReference(fact);
    factReferenceCounts.set(reference, (factReferenceCounts.get(reference) || 0) + 1);
  }
  const duplicateFactReferences = new Set(
    [...factReferenceCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([reference]) => reference)
  );
  const historicalRows = buildHistoricalFactRows({
    facts,
    currentPlan,
    snapshot,
    normalizationCollisionIds,
    duplicateFactReferences
  });
  const sqlIds = new Set([
    ...facts.orders,
    ...facts.likes,
    ...facts.wallets
  ].map((fact) => factEmployee(fact).value).filter(Boolean));
  const currentRows = currentPlan.reconciliationRows.map((row) => {
    if (row.legacySourceRow.sheet !== 'Users'
      || row.plannedAction !== ACTIONS.NO_CHANGE
      || !sqlIds.has(row.normalizedEmployeeId)) return row;
    const owner = snapshot.ownersByEmployeeId.get(row.normalizedEmployeeId)?.[0] || null;
    return {
      ...row,
      plannedAction: owner ? actionForOwner(owner) : row.plannedAction,
      reason: owner ? 'HISTORICAL_FACT_REQUIRES_RELATIONSHIP_PREVIEW' : row.reason
    };
  });
  const reconciliationRows = [...currentRows, ...historicalRows].sort((left, right) => (
    `${left.legacySourceRow.sheet}:${String(left.legacySourceRow.row).padStart(10, '0')}:${left.sourceId || ''}`
      .localeCompare(`${right.legacySourceRow.sheet}:${String(right.legacySourceRow.row).padStart(10, '0')}:${right.sourceId || ''}`)
  ));
  const allIds = new Set([
    ...reconciliationRows.map((row) => row.normalizedEmployeeId).filter(Boolean),
    ...sqlIds
  ]);
  const factRowsUnresolved = historicalRows.filter((row) => (
    !row.targetCanonicalUserId || [ACTIONS.AMBIGUOUS, ACTIONS.ERROR].includes(row.plannedAction)
  )).length;
  const factRowsConflicting = historicalRows.filter((row) => row.conflictFlags.length > 0).length;
  const counts = countActions(reconciliationRows);
  const sqlIdentityCoverage = classifySqlIdentityCoverage({
    sqlIds,
    snapshot,
    normalizationCollisionIds
  });
  const blockedCreateIdentities = new Set(reconciliationRows
    .filter((row) => row.conflictFlags.includes('CREATE_CANONICAL_BLOCKED_BY_REQUIRED_PROFILE_FIELDS'))
    .map((row) => row.normalizedEmployeeId)
    .filter(Boolean));
  const createCanonicalIdentityIds = new Set(reconciliationRows
    .filter((row) => row.plannedAction === ACTIONS.CREATE_CANONICAL)
    .map((row) => row.targetCanonicalUserId)
    .filter(Boolean));
  const createCanonicalReadyIds = new Set(reconciliationRows
    .filter((row) => row.plannedAction === ACTIONS.CREATE_CANONICAL
      && row.targetCanonicalUserId
      && row.mutationPreview?.canonicalUserCandidate?.canonicalIdentityReady === true
      && row.mutationPreview.canonicalUserCandidate.blockedByRequiredProfileFields.length === 0)
    .map((row) => row.targetCanonicalUserId));
  const sourceHashes = {
    excel: options.sourceHashes?.excel || currentSnapshot.sourceHash || normalized.sourceHash || 'unknown-excel-source',
    sql: options.sourceHashes?.sql || options.historicalFacts?.sourceHash || 'unknown-sql-source'
  };
  const summary = {
    totalLegacyUsers: currentPlan.summary.totalLegacyUsers,
    totalSqlHistoricalIdentities: sqlIds.size,
    uniqueNormalizedEmployeeIds: allIds.size,
    ...sqlIdentityCoverage,
    ambiguousIdentities: sqlIdentityCoverage.multipleOwner
      + sqlIdentityCoverage.normalizationCollision
      + sqlIdentityCoverage.otherAmbiguous,
    counts,
    normalizationCollisions: currentPlan.summary.normalizationCollisions
      + (options.historicalFacts?.normalizationCollisions?.length || 0),
    historicalOrderFactCount: facts.orders.length,
    historicalLikeFactCount: facts.likes.length,
    historicalWalletFactCount: facts.wallets.length,
    resolvedHistoricalRows: historicalRows.filter((row) => (
      Boolean(row.targetCanonicalUserId)
      && ![ACTIONS.AMBIGUOUS, ACTIONS.ERROR].includes(row.plannedAction)
    )).length,
    unresolvedHistoricalRows: currentPlan.summary.unresolvedHistoricalRows + factRowsUnresolved,
    unresolvedHistoricalReferences: historicalRows
      .filter((row) => !row.targetCanonicalUserId)
      .map((row) => row.legacySourceReference),
    conflictingHistoricalRows: currentPlan.summary.conflictingHistoricalRows + factRowsConflicting,
    sourceShapeIssueCount: currentPlan.summary.sourceShapeIssueCount
      + (options.historicalFacts?.sourceShapeIssues?.length || 0),
    d1SnapshotUsers: snapshot.users.length,
    createCanonicalIdentityCount: createCanonicalIdentityIds.size,
    createCanonicalReadyCount: createCanonicalReadyIds.size,
    createCanonicalBlockedByRequiredProfileFields: blockedCreateIdentities.size
  };
  const dryRunSafety = {
    rowsWritten: 0,
    changedDb: false,
    sqlExecuted: false,
    remoteD1Accessed: false,
    remoteMutation: false,
    productionWriteSqlExecuted: false,
    migrationApplied: false,
    deployed: false,
    mutationPreviewExecutable: false
  };
  const reportBase = {
    reportVersion: 2,
    sourceHashes,
    importerVersion: options.importerVersion || normalized.importerVersion || 'unknown-version',
    sourceInventory: {
      current: currentPlan.sourceInventory,
      historical: {
        adapterVersion: options.historicalFacts?.adapterVersion || null,
        tableRowCounts: cloneJson(options.historicalFacts?.tableRowCounts || {}),
        sourceShapeIssues: cloneJson(options.historicalFacts?.sourceShapeIssues || [])
      }
    },
    sourceShapeIssues: cloneJson([
      ...(normalized.shapeIssues || []),
      ...(options.historicalFacts?.sourceShapeIssues || [])
    ]),
    d1Snapshot: snapshot.public,
    d1SnapshotConflicts: cloneJson(snapshot.conflicts),
    d1SnapshotErrors: cloneJson(snapshot.errors),
    summary,
    reconciliationRows,
    plannedMutations: reconciliationRows
      .filter((row) => row.mutationPreview)
      .map((row) => ({ sourceReference: row.legacySourceReference, preview: row.mutationPreview })),
    dryRunSafety,
    rowsWritten: 0,
    changedDb: false,
    deterministic: true,
    validationSummary: currentPlan.validationSummary
  };
  return { ...reportBase, planHash: hashPlan(reportBase) };
};

export { normalizeEmployeeId, stableStringify };
