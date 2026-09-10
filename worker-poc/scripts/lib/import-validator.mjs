import {
  REASON_CODES,
  asText,
  cloneJson
} from './import-contract.mjs';
import { resolveLegacyIdentities } from './identity-mapping.mjs';

const VALID_ROLES = new Set(['User', 'ProxyAdmin', 'Admin']);
const VALID_FLOORS = new Set(['1樓', '9樓']);
const VALID_ORDER_STATUSES = new Set(['ACTIVE', 'CANCELLED']);
const VALID_LEDGER_TYPES = new Set(['TOPUP', 'ORDER', 'REFUND', 'ADJUSTMENT']);
const ENTITY_NAMES = ['Settings', 'Likes', 'Users', 'Menu', 'Announcements', 'Orders', 'TopupHistory'];
const IDENTITY_ENTITIES = ['Users', 'Orders', 'Likes', 'TopupHistory'];

const isInteger = (value) => Number.isSafeInteger(value);
const isNonNegativeInteger = (value) => isInteger(value) && value >= 0;
const hasText = (value) => Boolean(asText(value).trim());

const sourceOf = (record) => ({
  sheet: record?.source?.sheet || 'unknown',
  row: Number(record?.source?.row || 0)
});

const quarantineRecord = (entityType, record, reasonCode, details = {}) => {
  const source = sourceOf(record);
  return {
    entityType,
    sourceSheet: source.sheet,
    sourceRow: source.row,
    reasonCode,
    details: cloneJson(details),
    rawPayload: cloneJson(record?.raw || {}),
    normalizedPayload: cloneJson(record || {})
  };
};

const warningRecord = (entityType, record, code, details = {}) => {
  const source = sourceOf(record);
  return {
    entityType,
    sourceSheet: source.sheet,
    sourceRow: source.row,
    code,
    details: cloneJson(details)
  };
};

const emptyAccepted = () => Object.fromEntries(ENTITY_NAMES.map((name) => [name, []]));

const addIssue = (quarantine, entityType, record, code, details) => {
  quarantine.push(quarantineRecord(entityType, record, code, details));
};

const countBy = (items, key) => items.reduce((counts, item) => {
  const value = item[key];
  counts[value] = (counts[value] || 0) + 1;
  return counts;
}, {});

const identityStatusFor = (record) => record?.identity?.status || 'EXPLICIT_MAPPING_REQUIRED';

const identityDetails = (record) => ({
  status: identityStatusFor(record),
  userId: record?.identity?.userId || null,
  employeeId: record?.identity?.employeeId || record?.employeeId || null,
  lineUserId: record?.lineUserId || null,
  sourceKey: record?.sourceKey || `${record?.source?.sheet || 'unknown'}:${record?.source?.row || 0}`,
  evidence: record?.identity?.evidence || {}
});

const identityIssueCode = (record, { userAccepted = false } = {}) => {
  const status = identityStatusFor(record);
  if (status === 'CONFLICT') return REASON_CODES.IDENTITY_MAPPING_CONFLICT;
  if (status === 'EMPLOYEE_ID_INVALID') return REASON_CODES.EMPLOYEE_ID_INVALID;
  if (status === 'EMPLOYEE_ID_NUMERIC_UNSAFE') return REASON_CODES.EMPLOYEE_ID_NUMERIC_UNSAFE;
  if (status === 'EMPLOYEE_ID_REQUIRED' && userAccepted) return REASON_CODES.EMPLOYEE_ID_REQUIRED;
  if (!record?.identity?.userId || !record?.identity?.employeeId) {
    return userAccepted ? REASON_CODES.EMPLOYEE_ID_REQUIRED : REASON_CODES.EXPLICIT_MAPPING_REQUIRED;
  }
  return null;
};

const resolveOwnerOrIssue = (
  record,
  validUserIds,
  missingCode = REASON_CODES.ORPHAN_ORDER_USER
) => {
  if (!record?.lineUserId && !record?.employeeId) return missingCode;
  const issue = identityIssueCode(record);
  if (issue) return issue;
  if (!validUserIds.has(record.identity.userId)) {
    return record?.lineUserId || record?.employeeId
      ? REASON_CODES.EXPLICIT_MAPPING_REQUIRED
      : REASON_CODES.ORPHAN_ORDER_USER;
  }
  return null;
};

const resolvedRecord = (record) => ({
  ...record,
  userId: record.identity.userId,
  employeeId: record.identity.employeeId,
  identityStatus: record.identity.status
});

const validateUsers = (records, accepted, quarantine, validUserIds) => {
  const employeeIds = new Set();
  const lineUserIds = new Set();
  for (const record of records) {
    const identityIssue = identityIssueCode(record, { userAccepted: true });
    if (identityIssue) {
      addIssue(quarantine, 'Users', record, identityIssue, identityDetails(record));
      continue;
    }
    if (employeeIds.has(record.identity.employeeId)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.EMPLOYEE_ID_DUPLICATE, identityDetails(record));
      continue;
    }
    if (record.lineUserId && lineUserIds.has(record.lineUserId)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.DUPLICATE_USER, identityDetails(record));
      continue;
    }
    if (!hasText(record.displayName)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.INVALID_USER_ID, { field: 'displayName' });
      continue;
    }
    if (!VALID_FLOORS.has(record.pickupFloor)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.INVALID_PICKUP_FLOOR);
      continue;
    }
    if (!isInteger(record.balance)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.INVALID_MONEY, { field: 'balance' });
      continue;
    }
    if (!VALID_ROLES.has(record.role)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.INVALID_ROLE);
      continue;
    }
    employeeIds.add(record.identity.employeeId);
    if (record.lineUserId) lineUserIds.add(record.lineUserId);
    const acceptedRow = resolvedRecord(record);
    accepted.Users.push(acceptedRow);
    validUserIds.add(acceptedRow.userId);
  }
};

const validateSettings = (records, accepted, quarantine, warnings) => {
  for (const record of records) {
    if (!record.orderDate) {
      addIssue(quarantine, 'Settings', record, REASON_CODES.INVALID_DATE);
      continue;
    }
    if (record.mode && !['A', 'B'].includes(record.mode)) {
      addIssue(quarantine, 'Settings', record, REASON_CODES.INVALID_MODE, { field: 'mode' });
      continue;
    }
    if (!record.mode) {
      warnings.push(warningRecord('Settings', record, 'INFERRED_MODE', {
        mode: 'A',
        reason: 'legacy mode is blank'
      }));
      accepted.Settings.push({ ...record, mode: 'A' });
      continue;
    }
    accepted.Settings.push(record);
  }
};

const validateMenu = (records, accepted, quarantine, warnings) => {
  const groups = new Map();
  for (const record of records) {
    if (record.orderDate && hasText(record.vendor) && hasText(record.legacyItemId)) {
      const key = [record.orderDate, record.vendor, record.legacyItemId].join('|');
      const group = groups.get(key) || [];
      group.push(record);
      groups.set(key, group);
    }
  }
  for (const [key, group] of groups) {
    if (group.length > 1) {
      warnings.push(warningRecord('Menu', group[0], REASON_CODES.DUPLICATE_MENU_WARNING, {
        key,
        rows: group.map((record) => record.source.row),
        acceptedAsDistinctInternalKeys: group.map((record) => record.menuItemId)
      }));
    }
  }

  for (const record of records) {
    if (!record.orderDate) {
      addIssue(quarantine, 'Menu', record, REASON_CODES.INVALID_DATE);
      continue;
    }
    if (!hasText(record.vendor)) {
      addIssue(quarantine, 'Menu', record, REASON_CODES.INVALID_VENDOR);
      continue;
    }
    if (!hasText(record.legacyItemId) || !hasText(record.itemName)) {
      addIssue(quarantine, 'Menu', record, REASON_CODES.INVALID_MENU_ITEM);
      continue;
    }
    if (!isNonNegativeInteger(record.price)) {
      addIssue(quarantine, 'Menu', record, REASON_CODES.INVALID_MONEY, { field: 'price' });
      continue;
    }
    if (record.enabled === null) {
      addIssue(quarantine, 'Menu', record, REASON_CODES.INVALID_ENABLED);
      continue;
    }
    accepted.Menu.push(record);
  }
};

const validateAnnouncements = (records, accepted, quarantine) => {
  const ids = new Set();
  for (const record of records) {
    if (!hasText(record.announcementId) || ids.has(record.announcementId)) {
      addIssue(quarantine, 'Announcements', record, REASON_CODES.DUPLICATE_ANNOUNCEMENT, {
        field: 'announcementId'
      });
      continue;
    }
    if (!hasText(record.title) || !hasText(record.content)
      || !record.startDate || !record.endDate || record.endDate < record.startDate) {
      addIssue(quarantine, 'Announcements', record, REASON_CODES.INVALID_DATE);
      continue;
    }
    if (record.enabled === null) {
      addIssue(quarantine, 'Announcements', record, REASON_CODES.INVALID_ENABLED);
      continue;
    }
    ids.add(record.announcementId);
    accepted.Announcements.push(record);
  }
};

const validateLikes = (records, accepted, quarantine, validUserIds) => {
  for (const record of records) {
    if (!record.orderDate) {
      addIssue(quarantine, 'Likes', record, REASON_CODES.INVALID_DATE);
      continue;
    }
    const ownerIssue = resolveOwnerOrIssue(
      record,
      validUserIds,
      REASON_CODES.UNKNOWN_USER_REFERENCE
    );
    if (ownerIssue) {
      addIssue(quarantine, 'Likes', record, ownerIssue, identityDetails(record));
      continue;
    }
    accepted.Likes.push(resolvedRecord(record));
  }
};

const validateOrders = (records, accepted, quarantine, validUserIds, exclusions, orderExclusions) => {
  for (const record of records) {
    const exclusion = orderExclusions.get(record.orderId);
    if (exclusion) {
      const source = sourceOf(record);
      exclusions.push({
        entityType: 'Orders',
        orderId: record.orderId,
        sourceSheet: source.sheet,
        sourceRow: source.row,
        reason: exclusion.reason
      });
      continue;
    }
    const ownerIssue = resolveOwnerOrIssue(record, validUserIds);
    if (ownerIssue) {
      addIssue(quarantine, 'Orders', record, ownerIssue, identityDetails(record));
      continue;
    }
    if (!hasText(record.orderId)) {
      addIssue(quarantine, 'Orders', record, REASON_CODES.INVALID_ORDER_ID);
      continue;
    }
    if (!record.orderDate) {
      addIssue(quarantine, 'Orders', record, REASON_CODES.INVALID_DATE);
      continue;
    }
    if (!VALID_FLOORS.has(record.pickupFloor)) {
      addIssue(quarantine, 'Orders', record, REASON_CODES.INVALID_PICKUP_FLOOR);
      continue;
    }
    if (!hasText(record.vendor) || !hasText(record.legacyItemId) || !hasText(record.itemName)) {
      addIssue(quarantine, 'Orders', record, REASON_CODES.INVALID_MENU_ITEM);
      continue;
    }
    if (!isInteger(record.quantity) || record.quantity <= 0) {
      addIssue(quarantine, 'Orders', record, REASON_CODES.INVALID_QUANTITY);
      continue;
    }
    if (!isNonNegativeInteger(record.unitPrice) || !isNonNegativeInteger(record.subtotal)) {
      addIssue(quarantine, 'Orders', record, REASON_CODES.INVALID_MONEY);
      continue;
    }
    if (!VALID_ORDER_STATUSES.has(record.status)) {
      addIssue(quarantine, 'Orders', record, REASON_CODES.INVALID_ORDER_STATUS);
      continue;
    }
    accepted.Orders.push(resolvedRecord(record));
  }
};

const validateTopupHistory = (
  records,
  accepted,
  quarantine,
  validUserIds,
  ledgerPolicyApproved,
  identityIndexes
) => {
  for (const record of records) {
    if (!hasText(record.transactionId)) {
      addIssue(quarantine, 'TopupHistory', record, REASON_CODES.INVALID_TRANSACTION_ID);
      continue;
    }
    const ownerIssue = resolveOwnerOrIssue(
      record,
      validUserIds,
      REASON_CODES.UNKNOWN_USER_REFERENCE
    );
    if (ownerIssue) {
      addIssue(quarantine, 'TopupHistory', record, ownerIssue, identityDetails(record));
      continue;
    }
    if (!isInteger(record.amount) || !isInteger(record.balanceAfter)) {
      addIssue(quarantine, 'TopupHistory', record, REASON_CODES.INVALID_MONEY);
      continue;
    }
    if (!VALID_LEDGER_TYPES.has(record.type)) {
      addIssue(quarantine, 'TopupHistory', record, REASON_CODES.INVALID_LEDGER_TYPE);
      continue;
    }
    if (record.operatorEmployeeIdIssue && record.operatorEmployeeIdIssue !== 'EMPLOYEE_ID_REQUIRED') {
      addIssue(quarantine, 'TopupHistory', record, record.operatorEmployeeIdIssue, {
        field: 'operatorEmployeeId'
      });
      continue;
    }
    const operatorIdentity = record.operatorIdentity;
    const operatorIssue = operatorIdentity?.userId
      && operatorIdentity?.employeeId
      && identityIndexes.byEmployeeId.has(operatorIdentity.employeeId)
      ? null
      : (record.operatorLineUserId || record.operatorEmployeeId
        ? REASON_CODES.EXPLICIT_MAPPING_REQUIRED
        : null);
    if (operatorIssue && ledgerPolicyApproved) {
      addIssue(quarantine, 'TopupHistory', record, operatorIssue, {
        field: 'operator',
        identity: operatorIdentity || null
      });
      continue;
    }
    if (!ledgerPolicyApproved) {
      addIssue(quarantine, 'TopupHistory', record, REASON_CODES.INCOMPLETE_LEDGER_POLICY);
      continue;
    }
    accepted.TopupHistory.push({
      ...resolvedRecord(record),
      operatorUserId: operatorIdentity.userId,
      operatorEmployeeId: operatorIdentity.employeeId,
      operatorIdentityStatus: operatorIdentity.status
    });
  }
};

const identitySummaryFor = (normalized) => {
  const statuses = [];
  for (const entity of IDENTITY_ENTITIES) {
    for (const record of normalized?.[entity] || []) {
      statuses.push({ entity, status: identityStatusFor(record) });
    }
  }
  const employeeIds = (normalized?.Users || [])
    .map((record) => record.employeeId)
    .filter(Boolean);
  return {
    statusCounts: statuses.reduce((counts, item) => {
      const key = `${item.entity}:${item.status}`;
      counts[key] = (counts[key] || 0) + 1;
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, {}),
    employeeId: {
      sourceCount: (normalized?.Users || []).length,
      presentCount: employeeIds.length,
      uniqueCount: new Set(employeeIds).size,
      missingCount: (normalized?.Users || []).length - employeeIds.length,
      leadingZeroCount: employeeIds.filter((value) => /^0\d/.test(value)).length,
      numericUnsafeCount: (normalized?.Users || [])
        .filter((record) => record.employeeIdIssue === REASON_CODES.EMPLOYEE_ID_NUMERIC_UNSAFE)
        .length
    },
    sourceRows: statuses.length
  };
};

const financialSummaryFor = (normalized, accepted, ledgerPolicyApproved) => {
  const sourceBalanceTotal = (normalized?.Users || [])
    .reduce((sum, row) => sum + (isInteger(row.balance) ? row.balance : 0), 0);
  const acceptedBalanceTotal = (accepted.Users || [])
    .reduce((sum, row) => sum + (isInteger(row.balance) ? row.balance : 0), 0);
  const sourceLedgerAmountTotal = (normalized?.TopupHistory || [])
    .reduce((sum, row) => sum + (isInteger(row.amount) ? row.amount : 0), 0);
  const acceptedLedgerAmountTotal = (accepted.TopupHistory || [])
    .reduce((sum, row) => sum + (isInteger(row.amount) ? row.amount : 0), 0);
  const unexplainedOffsets = [];
  if (!ledgerPolicyApproved) {
    for (const row of accepted.Users || []) {
      if (row.balance !== 0) {
        unexplainedOffsets.push({
          userId: row.userId,
          employeeId: row.employeeId,
          balance: row.balance,
          status: 'OPENING_BALANCE_POLICY_REQUIRED'
        });
      }
    }
  }
  return {
    sourceBalanceTotal,
    acceptedBalanceTotal,
    sourceLedgerAmountTotal,
    acceptedLedgerAmountTotal,
    unexplainedOffsets,
    ledgerPolicyApproved
  };
};

const addReadinessBlocker = (blockers, code, details = {}) => {
  const key = `${code}:${details.sourceSheet || ''}:${details.sourceRow || ''}:${details.userId || ''}`;
  if (!blockers.some((item) => item.key === key)) blockers.push({ key, code, ...cloneJson(details) });
};

const buildReadiness = (normalized, validation, identitySummary, financialSummary) => {
  const blockers = [];
  for (const issue of normalized?.shapeIssues || []) {
    if (issue.code === REASON_CODES.EMPLOYEE_ID_FIELD_MISSING) {
      addReadinessBlocker(blockers, issue.code, {
        sheet: issue.sheet,
        expectedColumns: issue.expectedColumns || ['employee_id'],
        actualColumns: issue.actualColumns || []
      });
    }
  }
  for (const item of validation.quarantine) {
    if (['Users', 'Orders', 'Likes', 'TopupHistory', 'WORKBOOK'].includes(item.entityType)) {
      addReadinessBlocker(blockers, item.reasonCode, {
        entityType: item.entityType,
        sourceSheet: item.sourceSheet,
        sourceRow: item.sourceRow,
        details: item.details
      });
    }
  }
  for (const item of financialSummary.unexplainedOffsets) {
    addReadinessBlocker(blockers, REASON_CODES.OPENING_BALANCE_POLICY_REQUIRED, item);
  }
  for (const record of validation.accepted.TopupHistory || []) {
    addReadinessBlocker(blockers, REASON_CODES.HISTORICAL_LEDGER_POLICY_REQUIRED, {
      entityType: 'TopupHistory',
      sourceSheet: record.source?.sheet,
      sourceRow: record.source?.row,
      details: {
        message: 'Accepted historical ledger-like rows require a separate executable policy transform.',
        transactionId: record.transactionId
      }
    });
  }
  return {
    status: blockers.length ? 'BLOCKED' : 'PASS',
    blockers,
    identitySummary,
    financialSummary
  };
};

export const validateImport = (
  normalized,
  { ledgerPolicyApproved = false, orderExclusions = new Map(), identityMap } = {}
) => {
  const model = normalized?.identityIndexes
    ? normalized
    : resolveLegacyIdentities(normalized || {}, { identityMap });
  const accepted = emptyAccepted();
  const warnings = [];
  const quarantine = [];
  const exclusions = [];
  const validUserIds = new Set();

  for (const issue of model?.shapeIssues || []) {
    quarantine.push({
      entityType: 'WORKBOOK',
      sourceSheet: issue.sheet || 'unknown',
      sourceRow: 1,
      reasonCode: issue.code || REASON_CODES.MISSING_COLUMNS,
      details: cloneJson(issue),
      rawPayload: {},
      normalizedPayload: null
    });
  }

  validateUsers(model?.Users || [], accepted, quarantine, validUserIds);
  validateSettings(model?.Settings || [], accepted, quarantine, warnings);
  validateMenu(model?.Menu || [], accepted, quarantine, warnings);
  validateAnnouncements(model?.Announcements || [], accepted, quarantine);
  validateLikes(model?.Likes || [], accepted, quarantine, validUserIds);
  validateOrders(model?.Orders || [], accepted, quarantine, validUserIds, exclusions, orderExclusions);
  validateTopupHistory(
    model?.TopupHistory || [],
    accepted,
    quarantine,
    validUserIds,
    ledgerPolicyApproved,
    model?.identityIndexes || { byEmployeeId: new Map(), byLineUserId: new Map() }
  );

  const identitySummary = identitySummaryFor(model);
  const financialSummary = financialSummaryFor(model, accepted, ledgerPolicyApproved);
  const validation = {
    sourceHash: model?.sourceHash || 'unknown-source',
    importerVersion: model?.importerVersion || 'unknown-version',
    batchId: model?.batchId || 'unknown-batch',
    accepted,
    warnings,
    quarantine,
    exclusions,
    identityMap: model?.identityMap || null,
    summary: {
      sourceCounts: Object.fromEntries(ENTITY_NAMES.map((name) => [
        name,
        Array.isArray(model?.[name]) ? model[name].length : 0
      ])),
      acceptedCounts: Object.fromEntries(ENTITY_NAMES.map((name) => [
        name,
        accepted[name].length
      ])),
      quarantineCount: quarantine.length,
      warningCount: warnings.length,
      exclusionCount: exclusions.length,
      excludedOrderIds: [...new Set(exclusions.map((item) => item.orderId))],
      quarantineByReason: countBy(quarantine, 'reasonCode'),
      warningByCode: countBy(warnings, 'code'),
      identitySummary,
      financialSummary
    }
  };
  validation.readiness = buildReadiness(model, validation, identitySummary, financialSummary);
  return validation;
};
