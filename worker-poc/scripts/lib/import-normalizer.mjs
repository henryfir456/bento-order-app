import {
  IMPORTER_VERSION,
  asNullableText,
  asText,
  batchIdFor,
  parseBoolean,
  parseDateOnly,
  parseEmployeeId,
  parseInteger,
  parseTimestamp,
  sourceRef,
  stableId
} from './import-contract.mjs';

const valueOf = (row, ...keys) => {
  for (const key of keys) {
    if (row && row[key] !== undefined) return row[key];
  }
  return null;
};

const rowsFor = (workbook, sheetName) => {
  if (workbook?.sheets?.[sheetName]?.rows) return workbook.sheets[sheetName].rows;
  if (workbook?.[sheetName]?.rows) return workbook[sheetName].rows;
  if (Array.isArray(workbook?.[sheetName])) return workbook[sheetName];
  return [];
};

const sourceFor = (sheetName, row, index) => (
  row?.source || sourceRef(sheetName, index + 2)
);

const rawFor = (row) => (
  row?.raw || { ...row }
);

const withIssues = (record, fieldIssues) => ({
  ...record,
  sourceKey: `${record.source.sheet}:${record.source.row}`,
  fieldIssues
});

const employeeIdentity = (row) => {
  const parsed = parseEmployeeId(valueOf(
    row,
    'employee_id',
    'EmployeeID',
    'employeeId',
    '員工編號',
    '工號',
    '員工代號'
  ));
  return {
    employeeId: parsed.value,
    employeeIdIssue: parsed.code
  };
};

const normalizeSettings = (workbook) => rowsFor(workbook, 'Settings').map((row, index) => (
  withIssues({
    source: sourceFor('Settings', row, index),
    raw: rawFor(row),
    orderDate: parseDateOnly(valueOf(row, 'order_date', 'date')),
    vendor: asText(valueOf(row, 'vendor')).trim(),
    mode: asNullableText(valueOf(row, 'mode'))?.toUpperCase() || null
  }, [])
));

const normalizeLikes = (workbook) => rowsFor(workbook, 'Likes').map((row, index) => (
  withIssues({
    source: sourceFor('Likes', row, index),
    raw: rawFor(row),
    ...employeeIdentity(row),
    orderDate: parseDateOnly(valueOf(row, 'order_date', 'date')),
    lineUserId: asNullableText(valueOf(row, 'line_user_id', 'LINE_UserID')),
    createdAt: parseTimestamp(valueOf(row, 'created_at', 'Created_At'))
  }, [])
));

const normalizeUsers = (workbook) => rowsFor(workbook, 'Users').map((row, index) => (
  withIssues({
    source: sourceFor('Users', row, index),
    raw: rawFor(row),
    ...employeeIdentity(row),
    lineUserId: asNullableText(valueOf(row, 'line_user_id', 'UserID')),
    displayName: asText(valueOf(row, 'display_name', 'DisplayName')).trim(),
    pickupFloor: asNullableText(valueOf(row, 'pickup_floor', 'floor', '樓層')),
    balance: parseInteger(valueOf(row, 'balance', 'Balance')),
    role: asNullableText(valueOf(row, 'role', 'Role'))
  }, [])
));

const normalizeMenu = (workbook, sourceHash) => rowsFor(workbook, 'Menu').map((row, index) => {
  const source = sourceFor('Menu', row, index);
  const orderDate = parseDateOnly(valueOf(row, 'order_date', 'date'));
  const vendor = asText(valueOf(row, 'vendor')).trim();
  return withIssues({
    source,
    raw: rawFor(row),
    menuItemId: stableId('menu', sourceHash, source.sheet, source.row),
    menuVersionId: stableId('version', sourceHash, vendor, orderDate),
    orderDate,
    vendor,
    legacyItemId: asNullableText(valueOf(row, 'legacy_item_id', 'item_id')),
    itemName: asText(valueOf(row, 'item_name')).trim(),
    price: parseInteger(valueOf(row, 'price')),
    enabled: parseBoolean(valueOf(row, 'enabled')),
    note: asNullableText(valueOf(row, 'note')),
    imageUrl: asNullableText(valueOf(row, 'image_url'))
  }, []);
});

const normalizeAnnouncements = (workbook) => rowsFor(workbook, 'Announcements').map((row, index) => (
  withIssues({
    source: sourceFor('Announcements', row, index),
    raw: rawFor(row),
    announcementId: asNullableText(valueOf(row, 'announcement_id', 'id')),
    title: asText(valueOf(row, 'title')).trim(),
    content: asText(valueOf(row, 'content')),
    startDate: parseDateOnly(valueOf(row, 'start_date')),
    endDate: parseDateOnly(valueOf(row, 'end_date')),
    enabled: parseBoolean(valueOf(row, 'enabled'))
  }, [])
));

const normalizeOrders = (workbook) => rowsFor(workbook, 'Orders').map((row, index) => (
  withIssues({
    source: sourceFor('Orders', row, index),
    raw: rawFor(row),
    ...employeeIdentity(row),
    orderId: asNullableText(valueOf(row, 'order_id')),
    orderDate: parseDateOnly(valueOf(row, 'order_date')),
    vendor: asText(valueOf(row, 'vendor')).trim(),
    displayName: asText(valueOf(row, 'display_name', 'name')).trim(),
    pickupFloor: asNullableText(valueOf(row, 'pickup_floor')),
    legacyItemId: asNullableText(valueOf(row, 'legacy_item_id', 'item_id')),
    itemName: asText(valueOf(row, 'item_name')).trim(),
    quantity: parseInteger(valueOf(row, 'quantity')),
    unitPrice: parseInteger(valueOf(row, 'unit_price')),
    subtotal: parseInteger(valueOf(row, 'subtotal')),
    createdAt: parseTimestamp(valueOf(row, 'created_at')),
    updatedAt: parseTimestamp(valueOf(row, 'updated_at')),
    status: (asNullableText(valueOf(row, 'status')) || 'ACTIVE').toUpperCase(),
    lineUserId: asNullableText(valueOf(row, 'line_user_id', 'LINE_UserID')),
    balanceAfter: parseInteger(valueOf(row, 'balance_after', 'BalanceAfter')),
    note: asNullableText(valueOf(row, 'note'))
  }, [])
));

const normalizeTopupHistory = (workbook) => rowsFor(workbook, 'TopupHistory').map((row, index) => (
  withIssues({
    source: sourceFor('TopupHistory', row, index),
    raw: rawFor(row),
    ...employeeIdentity(row),
    timestamp: parseTimestamp(valueOf(row, 'timestamp', 'Timestamp')),
    lineUserId: asNullableText(valueOf(row, 'line_user_id', 'LINE_UserID')),
    displayName: asText(valueOf(row, 'display_name', '姓名')).trim(),
    pickupFloor: asNullableText(valueOf(row, 'pickup_floor', '樓層')),
    amount: parseInteger(valueOf(row, 'amount', '異動金額')),
    balanceAfter: parseInteger(valueOf(row, 'balance_after', '結餘')),
    note: asNullableText(valueOf(row, 'note', '備註')),
    transactionId: asNullableText(valueOf(row, 'transaction_id', 'TransactionID')),
    type: asNullableText(valueOf(row, 'type', 'Type'))?.toUpperCase(),
    referenceId: asNullableText(valueOf(row, 'reference_id', 'ReferenceID')),
    operatorLineUserId: asNullableText(valueOf(row, 'operator_line_user_id', 'OperatorUserID')),
    operatorEmployeeId: parseEmployeeId(valueOf(
      row,
      'operator_employee_id',
      'OperatorEmployeeID',
      'operatorEmployeeId',
      '操作人工號'
    )).value,
    operatorEmployeeIdIssue: parseEmployeeId(valueOf(
      row,
      'operator_employee_id',
      'OperatorEmployeeID',
      'operatorEmployeeId',
      '操作人工號'
    )).code,
    operatorName: asText(valueOf(row, 'operator_name', 'OperatorName')).trim()
  }, [])
));

export const normalizeLegacyWorkbook = (
  workbook,
  { sourceHash = 'unknown-source', importerVersion = IMPORTER_VERSION } = {}
) => ({
  sourceHash,
  importerVersion,
  batchId: batchIdFor(sourceHash, importerVersion),
  shapeIssues: Array.isArray(workbook?.shapeIssues) ? workbook.shapeIssues.slice() : [],
  Settings: normalizeSettings(workbook),
  Likes: normalizeLikes(workbook),
  Users: normalizeUsers(workbook),
  Menu: normalizeMenu(workbook, sourceHash),
  Announcements: normalizeAnnouncements(workbook),
  Orders: normalizeOrders(workbook),
  TopupHistory: normalizeTopupHistory(workbook)
});
