import { readFile } from 'node:fs/promises';

import {
  ImportContractError,
  stableId
} from './import-contract.mjs';
import {
  buildImportStatements,
  groupOrders,
  menuItemFor
} from './import-writer.js';
import { buildBalanceReconciliation } from '../reconcile-balances.mjs';
import {
  prepareStatement,
  runMutationBatch,
  resolveClock
} from '../../src/db/transactions.js';

export const PRODUCTION_TARGET = Object.freeze({
  name: 'bento-formal',
  databaseId: 'e75bc185-afb5-4a5d-abc9-81bd79525cff'
});

export const APPROVED_TEST_ORDER_EXCLUSIONS = Object.freeze([
  Object.freeze({
    orderId: 'ORD-1788326205642',
    reason: 'Approved disposable test data; explicitly authorized for exclusion from production replacement.'
  }),
  Object.freeze({
    orderId: 'ORD-1788415593733',
    reason: 'Approved disposable test data; explicitly authorized for exclusion from production replacement.'
  })
]);

export const PRESERVED_TABLES = Object.freeze([
  'd1_migrations'
]);

export const REPLACED_TABLES = Object.freeze([
  'users',
  'orders',
  'order_items',
  'order_status_history',
  'balance_ledger',
  'balance_ledger_sequence',
  'opening_balance_snapshots',
  'calendar_settings',
  'menu_versions',
  'menu_items',
  'announcements',
  'likes',
  'import_batches',
  'import_quarantine'
]);

export const RESET_TABLES = Object.freeze([
  'idempotency_keys',
  'admin_audit_log'
]);

export const CLEAR_ORDER = Object.freeze([
  'order_items',
  'order_status_history',
  'balance_ledger_sequence',
  'opening_balance_snapshots',
  'likes',
  'idempotency_keys',
  'admin_audit_log',
  'import_quarantine',
  'balance_ledger',
  'orders',
  'menu_items',
  'menu_versions',
  'announcements',
  'calendar_settings',
  'users',
  'import_batches'
]);

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const countRows = async (database, table) => {
  const row = await database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
  return Number(row?.count || 0);
};

const selectRows = async (database, query, bindings = []) => {
  const result = await database.prepare(query).bind(...bindings).all();
  return rowsFrom(result);
};

const duplicateGroups = async (database, query) => selectRows(database, query);

const expectedOrderIds = (validation) => new Set(
  groupOrders(validation.accepted?.Orders || []).map((group) => group.orderId)
);

const expectedMenuVersionIds = (validation) => new Set(
  (validation.accepted?.Menu || []).map((row) => row.menuVersionId)
);

const expectedMenuItemIds = (validation) => new Set(
  (validation.accepted?.Menu || []).map((row) => row.menuItemId)
);

const expectedUserIds = (validation) => new Set(
  (validation.accepted?.Users || []).map((row) => row.lineUserId)
);

const expectedAnnouncementIds = (validation) => new Set(
  (validation.accepted?.Announcements || []).map((row) => row.announcementId)
);

const unexpectedValues = (rows, field, expected) => rows
  .map((row) => row[field])
  .filter((value) => !expected.has(value));

const expectedCounts = (validation) => ({
  users: validation.accepted?.Users?.length || 0,
  orders: expectedOrderIds(validation).size,
  order_items: validation.accepted?.Orders?.length || 0,
  menu_items: validation.accepted?.Menu?.length || 0,
  menu_versions: expectedMenuVersionIds(validation).size,
  announcements: validation.accepted?.Announcements?.length || 0,
  calendar_settings: validation.accepted?.Settings?.length || 0,
  likes: validation.accepted?.Likes?.length || 0,
  import_quarantine: validation.quarantine?.length || 0,
  opening_balance_snapshots: validation.accepted?.Users?.length || 0,
  balance_ledger: validation.accepted?.TopupHistory?.length || 0,
  import_batches: 1,
  idempotency_keys: 0,
  admin_audit_log: 0
});

export const findReplacementBlockers = (validation) => {
  const blockers = [];
  const activeOrders = new Map();
  const orderStatuses = new Map();
  for (const row of validation.accepted?.Orders || []) {
    const statusSet = orderStatuses.get(row.orderId) || new Set();
    statusSet.add(row.status);
    orderStatuses.set(row.orderId, statusSet);
    if (row.status !== 'ACTIVE') continue;
    const key = `${row.lineUserId}|${row.orderDate}`;
    const orderIds = activeOrders.get(key) || new Set();
    orderIds.add(row.orderId);
    activeOrders.set(key, orderIds);
  }
  for (const [key, orderIds] of activeOrders) {
    if (orderIds.size > 1) {
      blockers.push({
        code: 'ACTIVE_ORDER_UNIQUENESS_CONFLICT',
        key,
        orderIds: [...orderIds].sort(),
        constraint: 'idx_orders_one_active_actor_date'
      });
    }
  }
  for (const [orderId, statuses] of orderStatuses) {
    if (statuses.size > 1) {
      blockers.push({
        code: 'ORDER_STATUS_CONFLICT',
        orderId,
        statuses: [...statuses].sort()
      });
    }
  }
  return blockers;
};

const assertReplacementReady = (validation) => {
  const blockers = findReplacementBlockers(validation);
  if (blockers.length) {
    throw new ImportContractError(
      'REPLACEMENT_SCHEMA_CONFLICT',
      'The accepted workbook cannot be loaded without violating the preserved formal schema.',
      { blockers }
    );
  }
};

export const assertProductionTarget = ({
  target,
  databaseId,
  configuredDatabaseId = PRODUCTION_TARGET.databaseId
} = {}) => {
  if (String(target || '').trim() !== PRODUCTION_TARGET.name) {
    throw new ImportContractError(
      'PRODUCTION_TARGET_INVALID',
      `Production replacement requires target ${PRODUCTION_TARGET.name}.`
    );
  }
  if (String(target).trim() === 'bento-poc') {
    throw new ImportContractError(
      'PRODUCTION_TARGET_REJECTED',
      'The legacy bento-poc target is never valid for production replacement.'
    );
  }
  if (!databaseId || Array.isArray(databaseId) || String(databaseId).trim() !== PRODUCTION_TARGET.databaseId) {
    throw new ImportContractError(
      'PRODUCTION_DATABASE_ID_INVALID',
      `Production replacement requires database UUID ${PRODUCTION_TARGET.databaseId}.`
    );
  }
  if (String(configuredDatabaseId || '').trim() !== PRODUCTION_TARGET.databaseId) {
    throw new ImportContractError(
      'PRODUCTION_DATABASE_ID_MISMATCH',
      'The active Wrangler configuration does not identify the expected production D1.'
    );
  }
  return {
    target: PRODUCTION_TARGET.name,
    databaseId: PRODUCTION_TARGET.databaseId
  };
};

export const assertReplacementConfirmation = ({ confirmed, dryRun = false } = {}) => {
  if (!dryRun && confirmed !== true) {
    throw new ImportContractError(
      'PRODUCTION_CONFIRMATION_REQUIRED',
      'Destructive production replacement requires --confirm-production-replace.'
    );
  }
};

export const assertNoPreviousReplacement = async (database, validation) => {
  const rows = await selectRows(database, `
    SELECT batch_id, source_hash, status
    FROM import_batches
    WHERE batch_id = ? OR source_hash = ?
    LIMIT 2
  `, [validation.batchId, validation.sourceHash]);
  if (rows.length) {
    throw new ImportContractError(
      'REPLACEMENT_ALREADY_APPLIED',
      'This source fingerprint or batch identifier is already present in the target database.',
      { existing: rows }
    );
  }
};

export const assertReviewedInput = (validation, artifact) => {
  if (!artifact || artifact.kind !== 'bento-formal-production-replacement-dry-run') {
    throw new ImportContractError(
      'REVIEWED_ARTIFACT_INVALID',
      'A reviewed production replacement dry-run artifact is required.'
    );
  }
  if (artifact.target?.name !== PRODUCTION_TARGET.name
    || artifact.target?.databaseId !== PRODUCTION_TARGET.databaseId) {
    throw new ImportContractError(
      'REVIEWED_ARTIFACT_TARGET_MISMATCH',
      'The reviewed artifact does not identify the expected production D1.'
    );
  }
  if (artifact.readyForReplacement !== true) {
    throw new ImportContractError(
      'REVIEWED_ARTIFACT_NOT_READY',
      'The reviewed dry-run artifact is not approved for production replacement.'
    );
  }
  if (artifact.source?.hash !== validation.sourceHash
    || artifact.source?.batchId !== validation.batchId
    || artifact.source?.importerVersion !== validation.importerVersion) {
    throw new ImportContractError(
      'REVIEWED_SOURCE_MISMATCH',
      'The workbook differs from the reviewed source fingerprint or importer version.'
    );
  }
  if (JSON.stringify(artifact.acceptedCounts) !== JSON.stringify(validation.summary.acceptedCounts)
    || artifact.quarantineCount !== validation.quarantine.length
    || artifact.warningCount !== validation.warnings.length) {
    throw new ImportContractError(
      'REVIEWED_SUMMARY_MISMATCH',
      'The current validation summary differs from the reviewed dry-run artifact.'
    );
  }
  if (JSON.stringify(artifact.exclusions || []) !== JSON.stringify(validation.exclusions || [])) {
    throw new ImportContractError(
      'REVIEWED_EXCLUSIONS_MISMATCH',
      'The current explicit order exclusions differ from the reviewed dry-run artifact.'
    );
  }
  return true;
};

export const readReviewedArtifact = async (path) => {
  if (!path) {
    throw new ImportContractError('REVIEWED_ARTIFACT_REQUIRED', 'A reviewed dry-run artifact path is required.');
  }
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new ImportContractError('REVIEWED_ARTIFACT_UNAVAILABLE', 'The reviewed dry-run artifact is unavailable.', {
      cause: error?.code || error?.message || 'invalid-json'
    });
  }
};

const sqlLiteral = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll("'", "''")}'`;
};

const operationSql = (query, bindings) => {
  let index = 0;
  return query.replaceAll('?', () => sqlLiteral(bindings[index++]));
};

const importSqlStatements = (validation, occurredAt) => {
  const statements = [];
  const push = (query, bindings) => statements.push(operationSql(query, bindings));
  push(`
    INSERT INTO import_batches (
      batch_id, source_hash, importer_version, status, created_at
    ) VALUES (?, ?, ?, 'VALIDATING', ?)
  `, [validation.batchId, validation.sourceHash, validation.importerVersion, occurredAt]);

  for (const row of validation.accepted.Users || []) {
    push(`
      INSERT INTO users (
        line_user_id, display_name, pickup_floor, balance, role, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [row.lineUserId, row.displayName, row.pickupFloor, row.balance, row.role, occurredAt, occurredAt]);
    push(`
      INSERT INTO opening_balance_snapshots (
        line_user_id, snapshot_balance, source_batch_id, policy_status, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      row.lineUserId,
      row.balance,
      validation.batchId,
      row.balance === 0 ? 'NOT_REQUIRED' : 'REQUIRED',
      occurredAt
    ]);
  }
  for (const row of validation.accepted.Settings || []) {
    push(`
      INSERT INTO calendar_settings (
        order_date, vendor, mode, vendor_source, updated_by_line_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'CONFIGURED', NULL, ?, ?)
    `, [row.orderDate, row.vendor, row.mode, occurredAt, occurredAt]);
  }
  for (const row of validation.accepted.Menu || []) {
    push(`
      INSERT OR IGNORE INTO menu_versions (
        menu_version_id, vendor, effective_date, source_batch_id, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [row.menuVersionId, row.vendor, row.orderDate, validation.batchId, occurredAt]);
    push(`
      INSERT INTO menu_items (
        menu_item_id, menu_version_id, legacy_item_id, item_name, price,
        enabled, note, image_url, source_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      row.menuItemId,
      row.menuVersionId,
      row.legacyItemId,
      row.itemName,
      row.price,
      row.enabled ? 1 : 0,
      row.note || '',
      row.imageUrl || '',
      row.source.row,
      occurredAt,
      occurredAt
    ]);
  }
  for (const row of validation.accepted.Announcements || []) {
    push(`
      INSERT INTO announcements (
        announcement_id, title, content, start_date, end_date, enabled,
        source_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      row.announcementId,
      row.title,
      row.content,
      row.startDate,
      row.endDate,
      row.enabled ? 1 : 0,
      row.source.row,
      occurredAt,
      occurredAt
    ]);
  }
  for (const row of validation.accepted.Likes || []) {
    push(`
      INSERT INTO likes (order_date, line_user_id, created_at)
      VALUES (?, ?, ?)
    `, [row.orderDate, row.lineUserId, row.createdAt || occurredAt]);
  }

  for (const group of groupOrders(validation.accepted.Orders || [])) {
    const totalAmount = group.rows.reduce((sum, row) => sum + row.subtotal, 0);
    const createdAt = group.rows.map((row) => row.createdAt).filter(Boolean).sort()[0] || occurredAt;
    const updatedAt = group.rows.map((row) => row.updatedAt).filter(Boolean).sort().at(-1) || createdAt;
    push(`
      INSERT INTO orders (
        order_id, line_user_id, order_date, vendor, pickup_floor, note,
        total_amount, status, source_batch_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      group.orderId,
      group.lineUserId,
      group.orderDate,
      group.vendor,
      group.pickupFloor,
      group.note,
      totalAmount,
      group.status,
      validation.batchId,
      createdAt,
      updatedAt
    ]);
    push(`
      INSERT INTO order_status_history (
        transition_id, order_id, from_status, to_status, actor_line_user_id,
        reason, metadata_json, occurred_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
    `, [
      stableId('transition', validation.batchId, group.orderId, group.status),
      group.orderId,
      group.status,
      group.lineUserId,
      'IMPORT_' + group.status,
      JSON.stringify({ sourceBatchId: validation.batchId }),
      updatedAt
    ]);
    group.rows.forEach((row, index) => {
      const menuItem = menuItemFor(validation.accepted.Menu || [], row);
      push(`
        INSERT INTO order_items (
          order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
          quantity, unit_price, subtotal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        group.orderId,
        index + 1,
        menuItem?.menuItemId || null,
        row.legacyItemId,
        row.itemName,
        row.quantity,
        row.unitPrice,
        row.subtotal
      ]);
    });
  }

  for (const item of validation.quarantine || []) {
    push(`
      INSERT INTO import_quarantine (
        quarantine_id, batch_id, entity_type, source_sheet, source_row,
        reason_code, raw_payload_json, normalized_payload_json, review_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
    `, [
      stableId('quarantine', validation.batchId, item.entityType, item.sourceSheet, item.sourceRow, item.reasonCode),
      validation.batchId,
      item.entityType,
      item.sourceSheet,
      item.sourceRow,
      item.reasonCode,
      JSON.stringify(item.rawPayload || {}),
      item.normalizedPayload === null || item.normalizedPayload === undefined
        ? null
        : JSON.stringify(item.normalizedPayload)
    ]);
  }
  push(`
    UPDATE import_batches
    SET status = ?, completed_at = ?
    WHERE batch_id = ?
  `, [validation.quarantine?.length ? 'QUARANTINED' : 'STAGED', occurredAt, validation.batchId]);
  return statements;
};

export const buildReplacementSql = (validation, { clock = new Date() } = {}) => {
  assertReplacementReady(validation);
  if (validation?.accepted?.TopupHistory?.length) {
    throw new ImportContractError(
      'HISTORICAL_LEDGER_POLICY_REQUIRED',
      'Historical ledger-like rows remain evidence until an explicit opening-balance policy is approved.'
    );
  }
  const occurredAt = resolveClock(clock).toISOString();
  return [
    'PRAGMA foreign_keys = ON',
    ...CLEAR_ORDER.map((table) => `DELETE FROM ${table}`),
    ...importSqlStatements(validation, occurredAt)
  ].join(';\n') + ';\n';
};

export const reconcileReplacement = async (database, validation) => {
  const tableNames = [
    ...REPLACED_TABLES,
    ...RESET_TABLES
  ];
  const counts = Object.fromEntries(await Promise.all(
    tableNames.map(async (table) => [table, await countRows(database, table)])
  ));
  const expected = expectedCounts(validation);
  const balanceReconciliation = await buildBalanceReconciliation(database);
  const users = await selectRows(database, 'SELECT line_user_id FROM users ORDER BY line_user_id');
  const orders = await selectRows(database, 'SELECT order_id FROM orders ORDER BY order_id');
  const menuItems = await selectRows(database, 'SELECT menu_item_id FROM menu_items ORDER BY menu_item_id');
  const menuVersions = await selectRows(database, 'SELECT menu_version_id FROM menu_versions ORDER BY menu_version_id');
  const announcements = await selectRows(database, 'SELECT announcement_id FROM announcements ORDER BY announcement_id');
  const duplicateMenuGroups = await duplicateGroups(database, `
    SELECT mv.vendor, mv.effective_date, mi.legacy_item_id, COUNT(*) AS count
    FROM menu_items mi
    JOIN menu_versions mv ON mv.menu_version_id = mi.menu_version_id
    GROUP BY mv.vendor, mv.effective_date, mi.legacy_item_id
    HAVING COUNT(*) > 1
  `);
  const reviewedMenuKeys = new Set(
    (validation.warnings || [])
      .filter((warning) => warning.code === 'DUPLICATE_MENU_WARNING')
      .map((warning) => warning.details?.key)
  );
  const duplicateBusinessKeys = {
    users: await duplicateGroups(database, 'SELECT line_user_id, COUNT(*) AS count FROM users GROUP BY line_user_id HAVING COUNT(*) > 1'),
    orders: await duplicateGroups(database, 'SELECT order_id, COUNT(*) AS count FROM orders GROUP BY order_id HAVING COUNT(*) > 1'),
    orderItems: await duplicateGroups(database, 'SELECT order_id, line_no, COUNT(*) AS count FROM order_items GROUP BY order_id, line_no HAVING COUNT(*) > 1'),
    menuVersions: await duplicateGroups(database, 'SELECT vendor, effective_date, COUNT(*) AS count FROM menu_versions GROUP BY vendor, effective_date HAVING COUNT(*) > 1'),
    announcements: await duplicateGroups(database, 'SELECT announcement_id, COUNT(*) AS count FROM announcements GROUP BY announcement_id HAVING COUNT(*) > 1'),
    calendarSettings: await duplicateGroups(database, 'SELECT order_date, COUNT(*) AS count FROM calendar_settings GROUP BY order_date HAVING COUNT(*) > 1'),
    likes: await duplicateGroups(database, 'SELECT order_date, line_user_id, COUNT(*) AS count FROM likes GROUP BY order_date, line_user_id HAVING COUNT(*) > 1')
  };
  const unexpectedDuplicateMenuGroups = duplicateMenuGroups.filter((row) => (
    !reviewedMenuKeys.has([row.effective_date, row.vendor, row.legacy_item_id].join('|'))
  ));
  const importBatch = await database.prepare(`
    SELECT batch_id, source_hash, importer_version, status
    FROM import_batches
    WHERE batch_id = ?
  `).bind(validation.batchId).first();
  const unexpectedRows = {
    users: unexpectedValues(users, 'line_user_id', expectedUserIds(validation)),
    orders: unexpectedValues(orders, 'order_id', expectedOrderIds(validation)),
    menuItems: unexpectedValues(menuItems, 'menu_item_id', expectedMenuItemIds(validation)),
    menuVersions: unexpectedValues(menuVersions, 'menu_version_id', expectedMenuVersionIds(validation)),
    announcements: unexpectedValues(announcements, 'announcement_id', expectedAnnouncementIds(validation))
  };
  const countMatches = Object.entries(expected).every(([table, value]) => counts[table] === value);
  const noUnexpectedRows = Object.values(unexpectedRows).every((rows) => rows.length === 0);
  const noUnexpectedDuplicates = Object.values(duplicateBusinessKeys).every((rows) => rows.length === 0)
    && unexpectedDuplicateMenuGroups.length === 0;
  return {
    targetCounts: counts,
    expectedCounts: expected,
    countMatches,
    unexpectedRows,
    noUnexpectedRows,
    duplicateBusinessKeys,
    reviewedDuplicateMenuGroups: duplicateMenuGroups.filter((row) => (
      reviewedMenuKeys.has([row.effective_date, row.vendor, row.legacy_item_id].join('|'))
    )),
    unexpectedDuplicateMenuGroups,
    noUnexpectedDuplicates,
    importBatch,
    sourceHash: validation.sourceHash,
    batchId: validation.batchId,
    balanceReconciliation,
    operationalBalances: balanceReconciliation.users.map((row) => ({
      lineUserId: row.lineUserId,
      balance: row.usersBalance,
      policyStatus: row.openingBalancePolicyStatus
    })),
    allConsistent: countMatches && noUnexpectedRows && noUnexpectedDuplicates
      && importBatch?.source_hash === validation.sourceHash
      && importBatch?.batch_id === validation.batchId
  };
};

export const replaceImport = async (database, validation, {
  clock = new Date(),
  target,
  databaseId,
  confirmed = false
} = {}) => {
  assertProductionTarget({ target, databaseId });
  assertReplacementConfirmation({ confirmed });
  if (!database || typeof database.batch !== 'function') {
    throw new ImportContractError('LOCAL_DATABASE_REQUIRED', 'Replacement requires a D1-compatible database.');
  }
  assertReplacementReady(validation);
  await assertNoPreviousReplacement(database, validation);
  const { statements } = buildImportStatements(database, validation, { clock });
  const clearStatements = CLEAR_ORDER.map((table) => (
    prepareStatement(database, `DELETE FROM ${table}`, [])
  ));
  await runMutationBatch(database, [...clearStatements, ...statements]);
  return reconcileReplacement(database, validation);
};

export const buildDryRunArtifact = ({
  validation,
  target = PRODUCTION_TARGET.name,
  databaseId = PRODUCTION_TARGET.databaseId,
  inputPath,
  destructiveCommand
} = {}) => {
  assertProductionTarget({ target, databaseId });
  const blockers = findReplacementBlockers(validation);
  return {
    kind: 'bento-formal-production-replacement-dry-run',
    createdAt: new Date().toISOString(),
    target: {
      name: PRODUCTION_TARGET.name,
      databaseId: PRODUCTION_TARGET.databaseId
    },
    source: {
      inputPath,
      hash: validation.sourceHash,
      batchId: validation.batchId,
      importerVersion: validation.importerVersion
    },
    preservedTables: [...PRESERVED_TABLES],
    replacedTables: [...REPLACED_TABLES],
    resetTables: [...RESET_TABLES],
    clearOrder: [...CLEAR_ORDER],
    sourceCounts: validation.summary.sourceCounts,
    acceptedCounts: validation.summary.acceptedCounts,
    quarantineCount: validation.quarantine.length,
    quarantineByReason: validation.summary.quarantineByReason,
    warningCount: validation.warnings.length,
    warningByCode: validation.summary.warningByCode,
    exclusions: validation.exclusions || [],
    exclusionCount: (validation.exclusions || []).length,
    blockers,
    readyForReplacement: blockers.length === 0,
    expectedCounts: expectedCounts(validation),
    destructiveCommand
  };
};
