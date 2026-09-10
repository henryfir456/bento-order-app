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
      userId: row.userId,
      employeeId: row.employeeId,
      lineUserId: row.lineUserId,
      displayName: row.displayName || '',
      orderDate: row.orderDate,
      vendor: row.vendor,
      pickupFloor: row.pickupFloor,
      note: row.note || '',
      status: row.status,
      rows: []
    };
    if (current.userId !== row.userId || current.status !== row.status) {
      throw new ImportContractError(
        'ORDER_GROUP_IDENTITY_CONFLICT',
        `Order ${row.orderId} contains conflicting owner or status values.`
      );
    }
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

const quarantineOperations = (validation) => (
  (validation.quarantine || []).map((item) => ({
    query: `
      INSERT OR IGNORE INTO import_quarantine (
        quarantine_id, batch_id, entity_type, source_sheet, source_row,
        reason_code, raw_payload_json, normalized_payload_json, review_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
    `,
    bindings: [
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
    ]
  }))
);

const assertCanonicalValidation = (validation) => {
  for (const row of validation?.accepted?.Users || []) {
    if (!row.userId || !row.employeeId) {
      throw new ImportContractError(
        'CANONICAL_IDENTITY_REQUIRED',
        'Every accepted user must have both a relational user_id and a canonical employee_id.'
      );
    }
  }
  for (const entity of ['Orders', 'Likes', 'TopupHistory']) {
    for (const row of validation?.accepted?.[entity] || []) {
      if (!row.userId || !row.employeeId) {
        throw new ImportContractError(
          'CANONICAL_OWNER_REQUIRED',
          `Every accepted ${entity} row must have a resolved canonical owner.`
        );
      }
    }
  }
};

export const buildImportOperations = (validation, { clock = new Date() } = {}) => {
  assertCanonicalValidation(validation);
  if (validation?.accepted?.TopupHistory?.length) {
    throw new ImportContractError(
      'HISTORICAL_LEDGER_POLICY_REQUIRED',
      'Historical ledger-like rows remain evidence until an explicit opening-balance/event policy is approved.'
    );
  }
  const occurredAt = resolveClock(clock).toISOString();
  const operations = [{
    query: `
      INSERT OR IGNORE INTO import_batches (
        batch_id, source_hash, importer_version, status, created_at
      ) VALUES (?, ?, ?, 'VALIDATING', ?)
    `,
    bindings: [validation.batchId, validation.sourceHash, validation.importerVersion, occurredAt]
  }];

  for (const row of validation.accepted.Users || []) {
    operations.push({
      query: `
        INSERT OR IGNORE INTO users (
          user_id, employee_id, line_user_id, display_name, pickup_floor,
          balance, role, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      bindings: [
        row.userId,
        row.employeeId,
        row.lineUserId,
        row.displayName,
        row.pickupFloor,
        row.balance,
        row.role,
        row.active === false ? 0 : 1,
        occurredAt,
        occurredAt
      ]
    });
    operations.push({
      query: `
        INSERT OR IGNORE INTO opening_balance_snapshots (
          user_id, snapshot_balance, source_batch_id, policy_status, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
      bindings: [
        row.userId,
        row.balance,
        validation.batchId,
        row.balance === 0 ? 'NOT_REQUIRED' : 'REQUIRED',
        occurredAt
      ]
    });
  }

  for (const row of validation.accepted.Settings || []) {
    operations.push({
      query: `
        INSERT INTO calendar_settings (
          order_date, vendor, mode, vendor_source, updated_by_user_id,
          updated_by_auth_mode, created_at, updated_at
        ) VALUES (?, ?, ?, 'CONFIGURED', NULL, 'legacy_import', ?, ?)
        ON CONFLICT(order_date) DO UPDATE SET
          vendor = excluded.vendor, mode = excluded.mode,
          vendor_source = 'CONFIGURED', updated_by_user_id = NULL,
          updated_by_auth_mode = 'legacy_import', updated_at = excluded.updated_at
      `,
      bindings: [row.orderDate, row.vendor, row.mode, occurredAt, occurredAt]
    });
  }

  for (const row of validation.accepted.Menu || []) {
    operations.push({
      query: `
        INSERT OR IGNORE INTO menu_versions (
          menu_version_id, vendor, effective_date, source_batch_id, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
      bindings: [row.menuVersionId, row.vendor, row.orderDate, validation.batchId, occurredAt]
    });
    operations.push({
      query: `
        INSERT OR IGNORE INTO menu_items (
          menu_item_id, menu_version_id, legacy_item_id, item_name, price,
          enabled, note, image_url, source_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      bindings: [
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
      ]
    });
  }

  for (const row of validation.accepted.Announcements || []) {
    operations.push({
      query: `
        INSERT OR IGNORE INTO announcements (
          announcement_id, title, content, start_date, end_date, enabled,
          source_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      bindings: [
        row.announcementId,
        row.title,
        row.content,
        row.startDate,
        row.endDate,
        row.enabled ? 1 : 0,
        row.source.row,
        occurredAt,
        occurredAt
      ]
    });
  }

  for (const row of validation.accepted.Likes || []) {
    operations.push({
      query: `
        INSERT OR IGNORE INTO likes (order_date, user_id, created_at)
        VALUES (?, ?, ?)
      `,
      bindings: [row.orderDate, row.userId, row.createdAt || occurredAt]
    });
  }

  for (const group of groupOrders(validation.accepted.Orders || [])) {
    const totalAmount = group.rows.reduce((sum, row) => sum + row.subtotal, 0);
    const createdAt = minTimestamp(group.rows, 'createdAt', occurredAt);
    const updatedAt = maxTimestamp(group.rows, 'updatedAt', createdAt);
    operations.push({
      query: `
        INSERT OR IGNORE INTO orders (
          order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
          display_name_snapshot, order_date, vendor, pickup_floor, note,
          total_amount, status, created_by_user_id, created_auth_mode,
          source_batch_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy_import', ?, ?, ?)
      `,
      bindings: [
        group.orderId,
        group.userId,
        group.employeeId,
        group.lineUserId,
        group.displayName,
        group.orderDate,
        group.vendor,
        group.pickupFloor,
        group.note,
        totalAmount,
        group.status,
        group.userId,
        validation.batchId,
        createdAt,
        updatedAt
      ]
    });
    operations.push({
      query: `
        INSERT OR IGNORE INTO order_status_history (
          transition_id, order_id, from_status, to_status, actor_user_id,
          actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
          display_name_snapshot, reason, metadata_json, occurred_at
        ) VALUES (?, ?, NULL, ?, ?, 'legacy_import', ?, ?, ?, ?, ?, ?)
      `,
      bindings: [
        stableId('transition', validation.batchId, group.orderId, group.status),
        group.orderId,
        group.status,
        group.userId,
        group.employeeId,
        group.lineUserId,
        group.displayName,
        'IMPORT_' + group.status,
        JSON.stringify({ sourceBatchId: validation.batchId }),
        updatedAt
      ]
    });
    group.rows.forEach((row, index) => {
      const menuItem = menuItemFor(validation.accepted.Menu || [], row);
      operations.push({
        query: `
          INSERT OR IGNORE INTO order_items (
            order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
            quantity, unit_price, subtotal
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        bindings: [
          group.orderId,
          index + 1,
          menuItem?.menuItemId || null,
          row.legacyItemId,
          row.itemName,
          row.quantity,
          row.unitPrice,
          row.subtotal
        ]
      });
    });
  }

  operations.push(...quarantineOperations(validation));
  operations.push({
    query: `
      UPDATE import_batches
      SET status = ?, completed_at = ?
      WHERE batch_id = ?
    `,
    bindings: [validation.quarantine?.length ? 'QUARANTINED' : 'STAGED', occurredAt, validation.batchId]
  });
  return { operations, occurredAt };
};

export const buildImportStatements = (database, validation, options = {}) => {
  if (!database || typeof database.batch !== 'function') {
    throw new ImportContractError('LOCAL_DATABASE_REQUIRED', 'Stage mode requires a local D1-compatible database.');
  }
  const { operations, occurredAt } = buildImportOperations(validation, options);
  return {
    statements: operations.map(({ query, bindings }) => prepareStatement(database, query, bindings)),
    occurredAt
  };
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
