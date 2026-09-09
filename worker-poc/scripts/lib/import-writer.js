import { ImportContractError, stableId } from './import-contract.mjs';
import { prepareStatement, runMutationBatch, resolveClock } from '../../src/db/transactions.js';
import { buildBalanceReconciliation } from '../reconcile-balances.mjs';

const maxTimestamp = (rows, field, fallback) => {
  const values = rows.map((row) => row[field]).filter(Boolean).sort();
  return values[values.length - 1] || fallback;
};

const minTimestamp = (rows, field, fallback) => {
  const values = rows.map((row) => row[field]).filter(Boolean).sort();
  return values[0] || fallback;
};

export const groupOrders = (rows) => {
  const groups = new Map();
  for (const row of rows) {
    const current = groups.get(row.orderId) || {
      orderId: row.orderId,
      lineUserId: row.lineUserId,
      orderDate: row.orderDate,
      vendor: row.vendor,
      pickupFloor: row.pickupFloor,
      note: row.note || '',
      status: row.status,
      rows: []
    };
    current.rows.push(row);
    groups.set(row.orderId, current);
  }
  return [...groups.values()];
};

export const menuItemFor = (menuRows, orderRow) => {
  const candidates = menuRows
    .filter((menu) => (
      menu.vendor === orderRow.vendor
      && menu.orderDate <= orderRow.orderDate
      && menu.legacyItemId === orderRow.legacyItemId
    ))
    .sort((left, right) => right.orderDate.localeCompare(left.orderDate));
  if (!candidates.length) return null;
  const latestDate = candidates[0].orderDate;
  const latest = candidates.filter((candidate) => candidate.orderDate === latestDate);
  if (latest.length === 1) return latest[0];
  const named = latest.filter((candidate) => candidate.itemName === orderRow.itemName);
  return named.length === 1 ? named[0] : null;
};

const insertQuarantineStatements = (database, validation) => (
  (validation.quarantine || []).map((item) => prepareStatement(database, `
    INSERT OR IGNORE INTO import_quarantine (
      quarantine_id, batch_id, entity_type, source_sheet, source_row,
      reason_code, raw_payload_json, normalized_payload_json, review_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
  `, [
    stableId(
      'quarantine',
      validation.batchId,
      item.entityType,
      item.sourceSheet,
      item.sourceRow,
      item.reasonCode
    ),
    validation.batchId,
    item.entityType,
    item.sourceSheet,
    item.sourceRow,
    item.reasonCode,
    JSON.stringify(item.rawPayload || {}),
    item.normalizedPayload === null || item.normalizedPayload === undefined
      ? null
      : JSON.stringify(item.normalizedPayload)
  ]))
);

export const buildImportStatements = (database, validation, { clock = new Date() } = {}) => {
  if (!database || typeof database.batch !== 'function') {
    throw new ImportContractError('LOCAL_DATABASE_REQUIRED', 'Stage mode requires a local D1-compatible database.');
  }
  if (validation?.accepted?.TopupHistory?.length) {
    throw new ImportContractError(
      'HISTORICAL_LEDGER_POLICY_REQUIRED',
      'Historical ledger-like rows remain evidence until an explicit opening-balance policy is approved.'
    );
  }
  const occurredAt = resolveClock(clock).toISOString();
  const statements = [prepareStatement(database, `
    INSERT OR IGNORE INTO import_batches (
      batch_id, source_hash, importer_version, status, created_at
    ) VALUES (?, ?, ?, 'VALIDATING', ?)
  `, [validation.batchId, validation.sourceHash, validation.importerVersion, occurredAt])];

  for (const row of validation.accepted.Users || []) {
    statements.push(prepareStatement(database, `
      INSERT OR IGNORE INTO users (
        line_user_id, display_name, pickup_floor, balance, role, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [row.lineUserId, row.displayName, row.pickupFloor, row.balance, row.role, occurredAt, occurredAt]));
    statements.push(prepareStatement(database, `
      INSERT OR IGNORE INTO opening_balance_snapshots (
        line_user_id, snapshot_balance, source_batch_id, policy_status, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      row.lineUserId,
      row.balance,
      validation.batchId,
      row.balance === 0 ? 'NOT_REQUIRED' : 'REQUIRED',
      occurredAt
    ]));
  }
  for (const row of validation.accepted.Settings || []) {
    statements.push(prepareStatement(database, `
      INSERT INTO calendar_settings (
        order_date, vendor, mode, vendor_source, updated_by_line_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, 'CONFIGURED', NULL, ?, ?)
      ON CONFLICT(order_date) DO UPDATE SET
        vendor = excluded.vendor, mode = excluded.mode,
        vendor_source = 'CONFIGURED', updated_at = excluded.updated_at
    `, [row.orderDate, row.vendor, row.mode, occurredAt, occurredAt]));
  }
  for (const row of validation.accepted.Menu || []) {
    statements.push(prepareStatement(database, `
      INSERT OR IGNORE INTO menu_versions (
        menu_version_id, vendor, effective_date, source_batch_id, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [row.menuVersionId, row.vendor, row.orderDate, validation.batchId, occurredAt]));
    statements.push(prepareStatement(database, `
      INSERT OR IGNORE INTO menu_items (
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
    ]));
  }
  for (const row of validation.accepted.Announcements || []) {
    statements.push(prepareStatement(database, `
      INSERT OR IGNORE INTO announcements (
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
    ]));
  }
  for (const row of validation.accepted.Likes || []) {
    statements.push(prepareStatement(database, `
      INSERT OR IGNORE INTO likes (order_date, line_user_id, created_at)
      VALUES (?, ?, ?)
    `, [row.orderDate, row.lineUserId, row.createdAt || occurredAt]));
  }

  const orderGroups = groupOrders(validation.accepted.Orders || []);
  for (const group of orderGroups) {
    const totalAmount = group.rows.reduce((sum, row) => sum + row.subtotal, 0);
    const createdAt = minTimestamp(group.rows, 'createdAt', occurredAt);
    const updatedAt = maxTimestamp(group.rows, 'updatedAt', createdAt);
    statements.push(prepareStatement(database, `
      INSERT OR IGNORE INTO orders (
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
    ]));
    statements.push(prepareStatement(database, `
      INSERT OR IGNORE INTO order_status_history (
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
    ]));
    group.rows.forEach((row, index) => {
      const menuItem = menuItemFor(validation.accepted.Menu || [], row);
      statements.push(prepareStatement(database, `
        INSERT OR IGNORE INTO order_items (
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
      ]));
    });
  }

  statements.push(...insertQuarantineStatements(database, validation));
  statements.push(prepareStatement(database, `
    UPDATE import_batches
    SET status = ?, completed_at = ?
    WHERE batch_id = ?
  `, [validation.quarantine?.length ? 'QUARANTINED' : 'STAGED', occurredAt, validation.batchId]));

  return { statements, occurredAt };
};

export const stageImport = async (database, validation, { clock = new Date() } = {}) => {
  const { statements } = buildImportStatements(database, validation, { clock });
  await runMutationBatch(database, statements);
  const counts = {};
  for (const name of ['Users', 'Settings', 'Menu', 'Announcements', 'Likes', 'Orders']) {
    counts[name] = validation.accepted?.[name]?.length || 0;
  }
  const balanceReconciliation = await buildBalanceReconciliation(database);
  return { batchId: validation.batchId, stagedCounts: counts, balanceReconciliation };
};
