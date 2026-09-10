import { createHash } from 'node:crypto';

export const IMPORTER_VERSION = 'formal-wave1';

export const SHEET_DEFINITIONS = Object.freeze({
  Settings: Object.freeze({
    columns: ['order_date', 'vendor', 'mode'],
    requiredColumns: ['order_date', 'vendor']
  }),
  Likes: Object.freeze({
    columns: ['order_date', 'employee_id', 'line_user_id', 'created_at'],
    requiredColumns: ['order_date']
  }),
  TopupHistory: Object.freeze({
    columns: [
      'timestamp',
      'employee_id',
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
      'operator_employee_id',
      'operator_name'
    ],
    requiredColumns: ['timestamp', 'amount', 'balance_after', 'transaction_id', 'type']
  }),
  Users: Object.freeze({
    columns: [
      'employee_id', 'line_user_id', 'display_name', 'pickup_floor',
      'balance', 'role', 'active'
    ],
    requiredColumns: ['display_name', 'pickup_floor', 'balance', 'role']
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
    ],
    requiredColumns: ['order_date', 'vendor', 'legacy_item_id', 'item_name', 'price', 'enabled']
  }),
  Announcements: Object.freeze({
    columns: ['announcement_id', 'title', 'content', 'start_date', 'end_date', 'enabled'],
    requiredColumns: ['announcement_id', 'title', 'content', 'start_date', 'end_date', 'enabled']
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
      'employee_id',
      'line_user_id',
      'balance_after',
      'note'
    ],
    requiredColumns: [
      'order_id', 'order_date', 'vendor', 'pickup_floor', 'legacy_item_id',
      'item_name', 'quantity', 'unit_price', 'subtotal'
    ]
  })
});

export const SHEET_NAMES = Object.freeze(Object.keys(SHEET_DEFINITIONS));

export const REASON_CODES = Object.freeze({
  MISSING_SHEET: 'MISSING_SHEET',
  MISSING_COLUMNS: 'MISSING_COLUMNS',
  INVALID_USER_ID: 'INVALID_USER_ID',
  EMPLOYEE_ID_FIELD_MISSING: 'EMPLOYEE_ID_FIELD_MISSING',
  EMPLOYEE_ID_REQUIRED: 'EMPLOYEE_ID_REQUIRED',
  EMPLOYEE_ID_INVALID: 'EMPLOYEE_ID_INVALID',
  EMPLOYEE_ID_NUMERIC_UNSAFE: 'EMPLOYEE_ID_NUMERIC_UNSAFE',
  EMPLOYEE_ID_DUPLICATE: 'EMPLOYEE_ID_DUPLICATE',
  IDENTITY_MAPPING_CONFLICT: 'IDENTITY_MAPPING_CONFLICT',
  EXPLICIT_MAPPING_REQUIRED: 'EXPLICIT_MAPPING_REQUIRED',
  AMBIGUOUS_IDENTITY: 'AMBIGUOUS_IDENTITY',
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
  INCOMPLETE_LEDGER_POLICY: 'INCOMPLETE_LEDGER_POLICY',
  HISTORICAL_LEDGER_POLICY_REQUIRED: 'HISTORICAL_LEDGER_POLICY_REQUIRED',
  OPENING_BALANCE_POLICY_REQUIRED: 'OPENING_BALANCE_POLICY_REQUIRED',
  BALANCE_MISMATCH: 'BALANCE_MISMATCH'
});

export const normalizeHeader = (value) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[\s_()（）\-]+/g, '');

export const HEADER_ALIASES = Object.freeze({
  employee_id: Object.freeze([
    'employee_id', 'employeeid', 'employee', '員工編號', '工號', '員工代號'
  ]),
  line_user_id: Object.freeze([
    'line_user_id', 'lineuserid', 'lineuserid', 'user_id', 'userid',
    'userid(lineid)', 'line_userid', 'lineuserid'
  ]),
  display_name: Object.freeze(['display_name', 'displayname', 'name', '姓名']),
  pickup_floor: Object.freeze(['pickup_floor', 'pickupfloor', 'floor', '樓層']),
  balance: Object.freeze(['balance', '餘額', '結餘']),
  role: Object.freeze(['role', '角色']),
  active: Object.freeze(['active', 'enabled_user', '在職', '啟用']),
  order_date: Object.freeze(['order_date', 'orderdate', 'date', '日期']),
  vendor: Object.freeze(['vendor', '供應商']),
  mode: Object.freeze(['mode', '模式']),
  created_at: Object.freeze(['created_at', 'createdat', 'created', 'created_at']),
  timestamp: Object.freeze(['timestamp', '時間', '異動時間']),
  amount: Object.freeze(['amount', '異動金額']),
  balance_after: Object.freeze(['balance_after', 'balanceafter', '結餘']),
  note: Object.freeze(['note', '備註']),
  transaction_id: Object.freeze(['transaction_id', 'transactionid']),
  type: Object.freeze(['type', '類型']),
  reference_id: Object.freeze(['reference_id', 'referenceid']),
  operator_line_user_id: Object.freeze(['operator_line_user_id', 'operatoruserid', 'operatoruser id']),
  operator_employee_id: Object.freeze(['operator_employee_id', 'operatoremployeeid', '操作人工號']),
  operator_name: Object.freeze(['operator_name', 'operatorname', 'operator', '操作人']),
  announcement_id: Object.freeze(['announcement_id', 'announcementid', 'id']),
  title: Object.freeze(['title', '標題']),
  content: Object.freeze(['content', '內容']),
  start_date: Object.freeze(['start_date', 'startdate', '開始日期']),
  end_date: Object.freeze(['end_date', 'enddate', '結束日期']),
  enabled: Object.freeze(['enabled', '啟用']),
  legacy_item_id: Object.freeze(['legacy_item_id', 'legacyitemid', 'item_id', 'itemid']),
  item_name: Object.freeze(['item_name', 'itemname', '品項', '品名']),
  price: Object.freeze(['price', '價格']),
  image_url: Object.freeze(['image_url', 'imageurl', '圖片']),
  quantity: Object.freeze(['quantity', '數量']),
  unit_price: Object.freeze(['unit_price', 'unitprice', '單價']),
  subtotal: Object.freeze(['subtotal', '小計']),
  updated_at: Object.freeze(['updated_at', 'updatedat', '更新時間']),
  status: Object.freeze(['status', '狀態'])
});

const normalizedAliasSet = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([column, aliases]) => [
  column,
  new Set(aliases.map(normalizeHeader))
]));

export const canonicalColumnForHeader = (header, columns) => {
  const normalized = normalizeHeader(header);
  return columns.find((column) => (
    normalized === normalizeHeader(column)
    || normalizedAliasSet[column]?.has(normalized)
  )) || null;
};

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

export const parseEmployeeId = (value) => {
  if (value === null || value === undefined || value === '') {
    return { value: null, code: 'EMPLOYEE_ID_REQUIRED' };
  }
  if (typeof value !== 'string') {
    return { value: null, code: 'EMPLOYEE_ID_NUMERIC_UNSAFE' };
  }
  const employeeId = value.trim();
  if (!employeeId) return { value: null, code: 'EMPLOYEE_ID_REQUIRED' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(employeeId)) {
    return { value: null, code: 'EMPLOYEE_ID_INVALID' };
  }
  return { value: employeeId, code: null };
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
