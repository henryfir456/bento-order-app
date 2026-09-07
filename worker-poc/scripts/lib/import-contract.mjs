import { createHash } from 'node:crypto';

export const IMPORTER_VERSION = 'formal-wave1';

export const SHEET_DEFINITIONS = Object.freeze({
  Settings: Object.freeze({
    columns: ['order_date', 'vendor', 'mode']
  }),
  Likes: Object.freeze({
    columns: ['order_date', 'line_user_id', 'created_at']
  }),
  TopupHistory: Object.freeze({
    columns: [
      'timestamp',
      'line_user_id',
      'display_name',
      'pickup_floor',
      'amount',
      'balance_after',
      'note',
      'transaction_id',
      'type',
      'reference_id',
      'operator_line_user_id',
      'operator_name'
    ]
  }),
  Users: Object.freeze({
    columns: ['line_user_id', 'display_name', 'pickup_floor', 'balance', 'role']
  }),
  Menu: Object.freeze({
    columns: [
      'order_date',
      'vendor',
      'legacy_item_id',
      'item_name',
      'price',
      'enabled',
      'note',
      'image_url'
    ]
  }),
  Announcements: Object.freeze({
    columns: ['announcement_id', 'title', 'content', 'start_date', 'end_date', 'enabled']
  }),
  Orders: Object.freeze({
    columns: [
      'order_id',
      'order_date',
      'vendor',
      'display_name',
      'pickup_floor',
      'legacy_item_id',
      'item_name',
      'quantity',
      'unit_price',
      'subtotal',
      'created_at',
      'updated_at',
      'status',
      'line_user_id',
      'balance_after',
      'note'
    ]
  })
});

export const SHEET_NAMES = Object.freeze(Object.keys(SHEET_DEFINITIONS));

export const REASON_CODES = Object.freeze({
  MISSING_SHEET: 'MISSING_SHEET',
  MISSING_COLUMNS: 'MISSING_COLUMNS',
  INVALID_USER_ID: 'INVALID_USER_ID',
  DUPLICATE_USER: 'DUPLICATE_USER',
  INVALID_ROLE: 'INVALID_ROLE',
  INVALID_PICKUP_FLOOR: 'INVALID_PICKUP_FLOOR',
  INVALID_DATE: 'INVALID_DATE',
  INVALID_MODE: 'INVALID_MODE',
  INVALID_VENDOR: 'INVALID_VENDOR',
  INVALID_MENU_ITEM: 'INVALID_MENU_ITEM',
  INVALID_MONEY: 'INVALID_MONEY',
  INVALID_ENABLED: 'INVALID_ENABLED',
  DUPLICATE_ANNOUNCEMENT: 'DUPLICATE_ANNOUNCEMENT',
  DUPLICATE_MENU_WARNING: 'DUPLICATE_MENU_WARNING',
  UNKNOWN_USER_REFERENCE: 'UNKNOWN_USER_REFERENCE',
  ORPHAN_ORDER_USER: 'ORPHAN_ORDER_USER',
  INVALID_ORDER_ID: 'INVALID_ORDER_ID',
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  INVALID_ORDER_STATUS: 'INVALID_ORDER_STATUS',
  INVALID_TRANSACTION_ID: 'INVALID_TRANSACTION_ID',
  INVALID_LEDGER_TYPE: 'INVALID_LEDGER_TYPE',
  INCOMPLETE_LEDGER_POLICY: 'INCOMPLETE_LEDGER_POLICY'
});

export class ImportContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ImportContractError';
    this.code = code;
    this.details = details;
  }
}

export const asText = (value) => (
  value === null || value === undefined ? '' : String(value)
);

export const asNullableText = (value) => {
  const text = asText(value).trim();
  return text ? text : null;
};

export const parseInteger = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const text = asText(value).trim();
  if (!/^[+-]?\d+$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const parseBoolean = (value) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (value === null || value === undefined || value === '') return null;
  const text = asText(value).trim().toLowerCase();
  if (text === 'true' || text === 'yes' || text === 'y' || text === '1') return true;
  if (text === 'false' || text === 'no' || text === 'n' || text === '0') return false;
  return null;
};

export const parseDateOnly = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = asText(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= lastDay ? text : null;
};

export const parseTimestamp = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const text = asText(value).trim();
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const sourceRef = (sheet, row) => Object.freeze({
  sheet,
  row: Number(row)
});

export const stableId = (prefix, ...parts) => {
  const digest = createHash('sha256')
    .update(parts.map((part) => asText(part)).join('|'))
    .digest('hex')
    .slice(0, 24);
  return prefix + '_' + digest;
};

export const sourceHashForBytes = (bytes) => (
  createHash('sha256').update(bytes).digest('hex')
);

export const batchIdFor = (sourceHash, importerVersion = IMPORTER_VERSION) => (
  stableId('batch', sourceHash, importerVersion)
);

export const cloneJson = (value) => JSON.parse(JSON.stringify(value));
