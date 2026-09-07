import {
  REASON_CODES,
  asText,
  cloneJson
} from './import-contract.mjs';

const VALID_ROLES = new Set(['User', 'ProxyAdmin', 'Admin']);
const VALID_FLOORS = new Set(['1樓', '9樓']);
const VALID_ORDER_STATUSES = new Set(['ACTIVE', 'CANCELLED']);
const VALID_LEDGER_TYPES = new Set(['TOPUP', 'ORDER', 'REFUND', 'ADJUSTMENT']);
const ENTITY_NAMES = ['Settings', 'Likes', 'Users', 'Menu', 'Announcements', 'Orders', 'TopupHistory'];

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

const validateUsers = (records, accepted, quarantine, userIds) => {
  for (const record of records) {
    if (!hasText(record.lineUserId)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.INVALID_USER_ID);
      continue;
    }
    if (userIds.has(record.lineUserId)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.DUPLICATE_USER);
      continue;
    }
    if (!hasText(record.displayName)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.INVALID_USER_ID, {
        field: 'displayName'
      });
      continue;
    }
    if (!VALID_FLOORS.has(record.pickupFloor)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.INVALID_PICKUP_FLOOR);
      continue;
    }
    if (!isInteger(record.balance)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.INVALID_MONEY, {
        field: 'balance'
      });
      continue;
    }
    if (!VALID_ROLES.has(record.role)) {
      addIssue(quarantine, 'Users', record, REASON_CODES.INVALID_ROLE);
      continue;
    }
    userIds.add(record.lineUserId);
    accepted.Users.push(record);
  }
};

const validateSettings = (records, accepted, quarantine, warnings) => {
  for (const record of records) {
    if (!record.orderDate) {
      addIssue(quarantine, 'Settings', record, REASON_CODES.INVALID_DATE);
      continue;
    }
    if (record.mode && !['A', 'B'].includes(record.mode)) {
      addIssue(quarantine, 'Settings', record, REASON_CODES.INVALID_MODE, {
        field: 'mode'
      });
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
      addIssue(quarantine, 'Menu', record, REASON_CODES.INVALID_MONEY, {
        field: 'price'
      });
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

const validateLikes = (records, accepted, quarantine, userIds) => {
  for (const record of records) {
    if (!record.orderDate) {
      addIssue(quarantine, 'Likes', record, REASON_CODES.INVALID_DATE);
      continue;
    }
    if (!hasText(record.lineUserId) || !userIds.has(record.lineUserId)) {
      addIssue(quarantine, 'Likes', record, REASON_CODES.UNKNOWN_USER_REFERENCE);
      continue;
    }
    accepted.Likes.push(record);
  }
};

const validateOrders = (records, accepted, quarantine, userIds) => {
  for (const record of records) {
    if (!hasText(record.lineUserId) || !userIds.has(record.lineUserId)) {
      addIssue(quarantine, 'Orders', record, REASON_CODES.ORPHAN_ORDER_USER, {
        lineUserId: record.lineUserId
      });
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
    if (!['1樓', '9樓'].includes(record.pickupFloor)) {
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
    accepted.Orders.push(record);
  }
};

const validateTopupHistory = (
  records,
  accepted,
  quarantine,
  userIds,
  ledgerPolicyApproved
) => {
  for (const record of records) {
    if (!hasText(record.transactionId)) {
      addIssue(quarantine, 'TopupHistory', record, REASON_CODES.INVALID_TRANSACTION_ID);
      continue;
    }
    if (!hasText(record.lineUserId) || !userIds.has(record.lineUserId)) {
      addIssue(quarantine, 'TopupHistory', record, REASON_CODES.UNKNOWN_USER_REFERENCE);
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
    if (!ledgerPolicyApproved) {
      addIssue(quarantine, 'TopupHistory', record, REASON_CODES.INCOMPLETE_LEDGER_POLICY);
      continue;
    }
    accepted.TopupHistory.push(record);
  }
};

export const validateImport = (normalized, { ledgerPolicyApproved = false } = {}) => {
  const accepted = emptyAccepted();
  const warnings = [];
  const quarantine = [];
  const userIds = new Set();

  for (const issue of normalized?.shapeIssues || []) {
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

  validateUsers(normalized?.Users || [], accepted, quarantine, userIds);
  validateSettings(normalized?.Settings || [], accepted, quarantine, warnings);
  validateMenu(normalized?.Menu || [], accepted, quarantine, warnings);
  validateAnnouncements(normalized?.Announcements || [], accepted, quarantine);
  validateLikes(normalized?.Likes || [], accepted, quarantine, userIds);
  validateOrders(normalized?.Orders || [], accepted, quarantine, userIds);
  validateTopupHistory(
    normalized?.TopupHistory || [],
    accepted,
    quarantine,
    userIds,
    ledgerPolicyApproved
  );

  return {
    sourceHash: normalized?.sourceHash || 'unknown-source',
    importerVersion: normalized?.importerVersion || 'unknown-version',
    batchId: normalized?.batchId || 'unknown-batch',
    accepted,
    warnings,
    quarantine,
    summary: {
      sourceCounts: Object.fromEntries(ENTITY_NAMES.map((name) => [
        name,
        Array.isArray(normalized?.[name]) ? normalized[name].length : 0
      ])),
      acceptedCounts: Object.fromEntries(ENTITY_NAMES.map((name) => [
        name,
        accepted[name].length
      ])),
      quarantineCount: quarantine.length,
      warningCount: warnings.length,
      quarantineByReason: countBy(quarantine, 'reasonCode'),
      warningByCode: countBy(warnings, 'code')
    }
  };
};
