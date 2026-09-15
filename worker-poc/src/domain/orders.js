import { auditStatement } from '../db/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import {
  hashRequest,
  mutationResponseSpec,
  readExistingIdempotencyResult,
  requireIdempotencyKey,
  runIdempotentMutation
} from '../db/idempotency.js';
import { ledgerMutationStatements } from '../db/ledgerQueries.js';
import { prepareStatement, randomId, resolveClock } from '../db/transactions.js';
import { deadlineAt, isDateOnly } from './deadlines.js';
import {
  normalizeTargetUserId,
  getAuthenticatedOrderActor,
  resolveOrderActorTarget,
  resolveOrderMutationTiming,
  resolveOrderPermission
} from './orderAuthorization.js';
import {
  projectionItemId,
  resolveEffectiveMenuState
} from './menuItemChanges.js';

const VALID_FLOORS = new Set(['1樓', '9樓']);
const ORDER_OPERATION = 'CREATE_OR_REPLACE_ORDER';
const CANCEL_OPERATION = 'CANCEL_ORDER';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const getInputValue = (input, ...keys) => {
  for (const key of keys) {
    if (input?.[key] !== undefined) return input[key];
  }
  return undefined;
};

const parseQuantity = (value) => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const quantity = Number(value.trim());
    return Number.isSafeInteger(quantity) ? quantity : null;
  }
  return null;
};

const currentSetting = async (database, orderDate) => database.prepare(`
  SELECT order_date, vendor, mode
  FROM calendar_settings
  WHERE order_date = ?
  LIMIT 1
`).bind(orderDate).first();

const currentMenuRows = async (database, vendor, targetDate) => {
  const resolution = await resolveEffectiveMenuState(database, { vendor, targetDate });
  const versionId = resolution.baselineVersion?.menu_version_id || null;
  return {
    versionId,
    rows: resolution.rows.map((change) => {
      const persistedMenuItemId = change.persisted_menu_item_id || null;
      return {
        menu_item_id: persistedMenuItemId
          || change.menu_item_id
          || projectionItemId(vendor, change.effective_date, change.item_code, change.variant_key),
        persisted_menu_item_id: persistedMenuItemId,
        legacy_item_id: change.item_code,
        variant_key: change.variant_key,
        item_name: change.item_name,
        price: change.price,
        enabled: change.enabled ? 1 : 0,
        note: change.note,
        image_url: change.image_url,
        menu_version_id: versionId,
        effective_date: change.effective_date
      };
    })
  };
};

const normalizeItems = (rawItems, menuRows) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw badRequest('ORDER_ITEMS_REQUIRED');
  }
  const byInternalId = new Map(menuRows.map((row) => [String(row.menu_item_id), row]));
  const byLegacyId = new Map();
  for (const row of menuRows) {
    const key = String(row.legacy_item_id);
    const rows = byLegacyId.get(key) || [];
    rows.push(row);
    byLegacyId.set(key, rows);
  }

  const normalized = [];
  const indexByInternalId = new Map();
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      throw badRequest('ORDER_ITEM_INVALID');
    }
    const internalId = text(getInputValue(rawItem, 'menu_item_id', 'menuItemId'));
    const legacyId = text(rawItem.item_id);
    const requestedId = internalId || legacyId;
    const quantity = parseQuantity(rawItem.quantity);
    if (!requestedId || quantity === null) throw badRequest('ORDER_ITEM_INVALID');
    if (quantity === 0) continue;

    let menuItem = internalId ? byInternalId.get(internalId) : null;
    if (!internalId) {
      const legacyRows = byLegacyId.get(legacyId) || [];
      if (legacyRows.length > 1) throw badRequest('MENU_ITEM_AMBIGUOUS');
      menuItem = legacyRows[0];
    }
    if (!menuItem) {
      const disabled = menuRows.some((row) => (
        String(row.menu_item_id) === requestedId || String(row.legacy_item_id) === requestedId
      ));
      throw badRequest(disabled ? 'MENU_ITEM_DISABLED' : 'MENU_ITEM_INVALID');
    }
    if (Number(menuItem.enabled) !== 1) throw badRequest('MENU_ITEM_DISABLED');

    const key = String(menuItem.menu_item_id);
    const existingIndex = indexByInternalId.get(key);
    if (existingIndex === undefined) {
      normalized.push({
        menuItemId: key,
        persistedMenuItemId: Object.hasOwn(menuItem, 'persisted_menu_item_id')
          ? menuItem.persisted_menu_item_id
          : menuItem.menu_item_id,
        legacyItemId: String(menuItem.legacy_item_id),
        itemName: menuItem.item_name,
        price: Number(menuItem.price),
        quantity
      });
      indexByInternalId.set(key, normalized.length - 1);
    } else {
      const mergedQuantity = normalized[existingIndex].quantity + quantity;
      if (!Number.isSafeInteger(mergedQuantity)) throw badRequest('ORDER_ITEM_INVALID');
      normalized[existingIndex].quantity = mergedQuantity;
    }
  }

  if (normalized.length === 0) throw badRequest('ORDER_ITEMS_EMPTY');
  return normalized;
};

const assertOrderRequest = async (database, identity, input, clock) => {
  const actor = getAuthenticatedOrderActor(identity);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('INVALID_JSON');
  }
  const targetDate = text(getInputValue(input, 'targetDate', 'target_date', 'date'));
  if (!isDateOnly(targetDate)) throw badRequest('INVALID_DATE');
  const pickupFloor = text(getInputValue(input, 'pickupFloor', 'pickup_floor'));
  if (!VALID_FLOORS.has(pickupFloor)) throw badRequest('INVALID_PICKUP_FLOOR');
  const note = text(input.note);
  if (note.length > 2000) throw badRequest('ORDER_NOTE_TOO_LONG');

  const setting = await currentSetting(database, targetDate);
  if (!setting || !text(setting.vendor)) throw notFound('ORDER_PAGE_SETTING_NOT_FOUND');
  const now = resolveClock(clock);
  const requestedTargetUserId = normalizeTargetUserId(
    getInputValue(input, 'targetUserId', 'target_user_id')
  );
  const permission = await resolveOrderPermission(database, identity, {
    targetUserId: requestedTargetUserId,
    targetDate,
    mode: setting.mode,
    now
  });
  if (!permission.target || !permission.target.displayName) {
    throw forbidden('PROFILE_COMPLETION_REQUIRED');
  }
  if (!permission.timing.allowed) throw badRequest('DEADLINE_CLOSED');

  const menu = await currentMenuRows(database, setting.vendor, targetDate);
  const items = normalizeItems(getInputValue(input, 'items', 'orderItems'), menu.rows);
  const replaceExisting = input.replaceExisting !== false && input.replace_existing !== false;
  const activeOrder = await database.prepare(`
    SELECT order_id, total_amount
    FROM orders
    WHERE user_id = ? AND order_date = ? AND status = 'ACTIVE'
    LIMIT 1
  `).bind(permission.targetUserId, targetDate).first();
  return {
    actor,
    target: permission.target,
    targetUserId: permission.targetUserId,
    isDelegated: permission.isDelegated,
    requestedTargetUserId,
    permission,
    targetDate,
    pickupFloor,
    note,
    setting,
    items,
    replaceExisting,
    activeOrder,
    now,
    deadline: permission.timing.deadline
  };
};

const menuCte = (items) => `
  WITH requested(line_no, menu_item_id, legacy_item_id, item_name, price, quantity, enabled) AS (
    VALUES ${items.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}
  ),
  priced AS (
    SELECT line_no, menu_item_id, legacy_item_id, item_name, price, quantity
    FROM requested
    WHERE enabled = 1
  )
`;

const menuParams = (items) => items.flatMap((item, index) => [
  index + 1,
  item.persistedMenuItemId ?? null,
  item.legacyItemId,
  item.itemName,
  item.price,
  item.quantity,
  1
]);

const mapTransactionFailure = (error) => {
  if (error?.code !== 'TRANSACTION_FAILED') throw error;
  const source = error.cause || error;
  const message = String(source?.message || '').toLowerCase();
  if (message.includes('idx_orders_one_active_actor_date')) {
    throw conflict('ORDER_ALREADY_ACTIVE');
  }
  if (message.includes('busy') || message.includes('locked')) {
    throw conflict('TRANSACTION_RETRY_REQUIRED');
  }
  throw conflict('MUTATION_CONFLICT');
};

const buildOrderStatements = (database, context, actor, details) => {
  const {
    targetDate,
    pickupFloor,
    note,
    items,
    replaceExisting,
    now,
    target,
    targetUserId,
    isDelegated,
    permission
  } = context;
  const {
    orderId,
    refundTransactionId,
    replacementTransitionId,
    createdTransitionId,
    guard
  } = details;
  const occurredAt = now.toISOString();
  const guardSql = guard.sql;
  const guardParams = guard.params;
  const metadata = JSON.stringify({
    replacementOrderId: context.activeOrder?.order_id || null,
    actorUserId: actor.userId,
    targetUserId
  });
  const deadlineA = deadlineAt(targetDate, 'A').toISOString();
  const deadlineB = deadlineAt(targetDate, 'B').toISOString();
  const calendarTimingPredicate = permission.timing.cutoffApplies
    ? `AND (
        (cs.mode = 'A' AND ? <= ?)
        OR (cs.mode = 'B' AND ? <= ?)
      )`
    : '';
  const calendarTimingParams = permission.timing.cutoffApplies
    ? [occurredAt, deadlineA, occurredAt, deadlineB]
    : [];
  const validityPredicate = `
    EXISTS (
      SELECT 1 FROM users WHERE user_id = ? AND active = 1
    )
    AND EXISTS (
      SELECT 1
      FROM calendar_settings cs
      WHERE cs.order_date = ?
        AND length(trim(cs.vendor)) > 0
        ${calendarTimingPredicate}
    )
    AND (SELECT COUNT(*) FROM priced) = ?
    AND (? = 1 OR NOT EXISTS (
      SELECT 1 FROM orders
      WHERE user_id = ? AND order_date = ? AND status = 'ACTIVE'
    ))
  `;
  const validityParams = [
    targetUserId,
    targetDate,
    ...calendarTimingParams,
    items.length,
    replaceExisting ? 1 : 0,
    targetUserId,
    targetDate
  ];

  const assertRequest = prepareStatement(database, `${menuCte(items)}
    UPDATE idempotency_keys
    SET status = CASE WHEN (${validityPredicate}) THEN status ELSE 'FAILED' END
    WHERE ${guardSql}
  `, [...menuParams(items), ...validityParams, ...guardParams]);

  const replacementRefund = ledgerMutationStatements(database, {
    transactionId: refundTransactionId,
    userId: targetUserId,
    employeeIdSnapshot: target.employeeId,
    lineUserIdSnapshot: target.lineUserId,
    displayNameSnapshot: target.displayName,
    // The amount is selected from the active order inside the batch.  Zero
    // only makes the entry shape valid when there is no order to replace.
    amount: context.activeOrder ? Number(context.activeOrder.total_amount) : 0,
    type: 'REFUND',
    referenceId: context.activeOrder?.order_id || 'ORDER_REPLACEMENT',
    operatorUserId: actor.userId,
    operatorEmployeeIdSnapshot: actor.employeeId,
    operatorLineUserIdSnapshot: actor.lineUserId,
    operatorDisplayNameSnapshot: actor.displayName,
    operatorAuthMode: actor.authMode,
    authMode: actor.authMode,
    note: 'ORDER_REPLACED',
    occurredAt
  }, {
    guard,
    dynamicBalanceAfter: true,
    dynamicOrder: { orderDate: targetDate }
  }).statements;

  const replacementHistory = prepareStatement(database, `
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_user_id,
      actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, reason, metadata_json, occurred_at
    )
    SELECT ?, o.order_id, 'ACTIVE', 'CANCELLED', ?, ?, u.employee_id,
           u.line_user_id, u.display_name, 'ORDER_REPLACED', ?, ?
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    WHERE o.user_id = ? AND o.order_date = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    replacementTransitionId,
    actor.userId,
    actor.authMode,
    metadata,
    occurredAt,
    targetUserId,
    targetDate,
    ...guardParams
  ]);

  const cancelPrevious = prepareStatement(database, `
    UPDATE orders
    SET status = 'CANCELLED',
        cancelled_by_user_id = ?,
        cancelled_auth_mode = ?,
        updated_at = ?
    WHERE user_id = ? AND order_date = ? AND status = 'ACTIVE'
      AND ${guardSql}
  `, [actor.userId, actor.authMode, occurredAt, targetUserId, targetDate, ...guardParams]);

  const totalAmount = items.reduce(
    (sum, item) => sum + (item.quantity * item.price),
    0
  );
  if (!Number.isSafeInteger(totalAmount) || totalAmount < 0) {
    throw badRequest('ORDER_AMOUNT_INVALID');
  }

  const insertOrder = prepareStatement(database, `${menuCte(items)}
    INSERT INTO orders (
      order_id, user_id, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, order_date, vendor, pickup_floor, note,
      total_amount, status, created_by_user_id, created_auth_mode,
      created_at, updated_at
    )
    SELECT ?, ?, u.employee_id, u.line_user_id, u.display_name, ?, cs.vendor,
           ?, ?,
           CASE WHEN (SELECT COUNT(*) FROM priced) = ?
                THEN (SELECT SUM(quantity * price) FROM priced)
                ELSE NULL END,
           'ACTIVE', ?, ?, ?, ?
    FROM calendar_settings cs
    JOIN users u ON u.user_id = ?
      WHERE cs.order_date = ?
      AND length(trim(cs.vendor)) > 0
      ${calendarTimingPredicate}
      AND ${guardSql}
  `, [
    ...menuParams(items),
    orderId,
    targetUserId,
    targetDate,
    pickupFloor,
    note,
    items.length,
    actor.userId,
    actor.authMode,
    occurredAt,
    occurredAt,
    actor.userId,
    targetDate,
    ...calendarTimingParams,
    ...guardParams
  ]);

  const assertOrderInserted = prepareStatement(database, `
    UPDATE idempotency_keys
    SET status = CASE WHEN EXISTS (
      SELECT 1 FROM orders
      WHERE order_id = ? AND user_id = ? AND status = 'ACTIVE'
    ) THEN status ELSE 'FAILED' END
    WHERE ${guardSql}
  `, [orderId, targetUserId, ...guardParams]);

  const insertItems = prepareStatement(database, `${menuCte(items)}
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    )
    SELECT ?, p.line_no, p.menu_item_id, p.legacy_item_id, p.item_name,
           p.quantity, p.price, p.quantity * p.price
    FROM priced p
    WHERE ${guardSql}
  `, [...menuParams(items), orderId, ...guardParams]);

  const assertItemsInserted = prepareStatement(database, `
    UPDATE idempotency_keys
    SET status = CASE WHEN (
      SELECT COUNT(*) FROM order_items WHERE order_id = ?
    ) = ? THEN status ELSE 'FAILED' END
    WHERE ${guardSql}
  `, [orderId, items.length, ...guardParams]);

  const orderDebit = ledgerMutationStatements(database, {
    transactionId: details.orderTransactionId,
    userId: targetUserId,
    employeeIdSnapshot: target.employeeId,
    lineUserIdSnapshot: target.lineUserId,
    displayNameSnapshot: target.displayName,
    amount: -totalAmount,
    type: 'ORDER',
    referenceId: orderId,
    operatorUserId: actor.userId,
    operatorEmployeeIdSnapshot: actor.employeeId,
    operatorLineUserIdSnapshot: actor.lineUserId,
    operatorDisplayNameSnapshot: actor.displayName,
    operatorAuthMode: actor.authMode,
    authMode: actor.authMode,
    note: 'ORDER_CREATED',
    occurredAt
  }, { guard, dynamicBalanceAfter: true }).statements;

  const createdHistory = prepareStatement(database, `
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_user_id,
      actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, reason, metadata_json, occurred_at
    )
    SELECT ?, o.order_id, NULL, 'ACTIVE', ?, ?, u.employee_id,
           u.line_user_id, u.display_name, 'ORDER_CREATED', ?, ?
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    WHERE o.order_id = ? AND o.user_id = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    createdTransitionId,
    actor.userId,
    actor.authMode,
    JSON.stringify({ replaced: Boolean(context.activeOrder) }),
    occurredAt,
    orderId,
    targetUserId,
    ...guardParams
  ]);

  const orderAudit = isDelegated
    ? auditStatement(database, {
      auditId: details.orderAuditId,
      actorUserId: actor.userId,
      actorAuthMode: actor.authMode,
      actorEmployeeIdSnapshot: actor.employeeId,
      actorLineUserIdSnapshot: actor.lineUserId,
      targetUserId: target.userId,
      targetEmployeeIdSnapshot: target.employeeId,
      targetLineUserIdSnapshot: target.lineUserId,
      action: context.activeOrder ? 'ORDER_UPDATE' : 'ORDER_CREATE',
      metadata: { orderId, replacedOrderId: context.activeOrder?.order_id || null },
      occurredAt,
      onlyIfPriorMutation: true
    })
    : null;

  return [
    assertRequest,
    ...replacementRefund,
    replacementHistory,
    cancelPrevious,
    insertOrder,
    assertOrderInserted,
    ...orderDebit,
    insertItems,
    assertItemsInserted,
    createdHistory,
    ...(orderAudit ? [orderAudit] : [])
  ];
};

export const createOrReplaceOrder = async (database, identity, input, clock = new Date()) => {
  const idempotencyKey = requireIdempotencyKey(input?.idempotencyKey);
  const context = await assertOrderRequest(database, identity, input, clock);
  const { actor } = context;
  const requestPayload = {
    targetDate: context.targetDate,
    targetUserId: context.targetUserId,
    pickupFloor: context.pickupFloor,
    note: context.note,
    replaceExisting: context.replaceExisting,
    items: context.items.map(({ menuItemId, quantity }) => ({ menuItemId, quantity }))
  };
  const requestHash = await hashRequest(requestPayload);
  const existingResult = await readExistingIdempotencyResult(database, {
    actorUserId: actor.userId,
    operation: ORDER_OPERATION,
    idempotencyKey,
    requestHash
  });
  if (existingResult) return existingResult;
  if (!context.replaceExisting && context.activeOrder) throw conflict('ORDER_ALREADY_ACTIVE');
  const orderId = 'ORD-' + randomId('');
  const details = {
    actorUserId: actor.userId,
    operation: ORDER_OPERATION,
    idempotencyKey,
    requestHash,
    occurredAt: context.now.toISOString(),
    orderId,
    refundTransactionId: randomId('txn'),
    orderTransactionId: randomId('txn'),
    replacementTransitionId: randomId('transition'),
    createdTransitionId: randomId('transition'),
    orderAuditId: randomId('audit')
  };
  try {
    return await runIdempotentMutation(database, {
      ...details,
      responseSpec: mutationResponseSpec({
        message: 'ORDER_SAVED',
        orderId,
        balanceUserId: context.targetUserId
      }),
      buildStatements: (claim) => buildOrderStatements(
        database,
        context,
        actor,
        { ...details, ...claim }
      )
    });
  } catch (error) {
    mapTransactionFailure(error);
  }
};

const activeOrderForCancellation = async (database, orderId) => database.prepare(`
  SELECT o.order_id, o.user_id, o.order_date, o.total_amount, o.status,
         cs.mode
  FROM orders o
  LEFT JOIN calendar_settings cs ON cs.order_date = o.order_date
  WHERE o.order_id = ?
  LIMIT 1
`).bind(orderId).first();

export const cancelOrder = async (
  database,
  identity,
  orderIdInput,
  idempotencyKeyInput,
  clock = new Date(),
  requestedTargetUserId = null
) => {
  const actor = getAuthenticatedOrderActor(identity);
  const orderId = text(orderIdInput);
  if (!orderId) throw badRequest('ORDER_ID_REQUIRED');
  const idempotencyKey = requireIdempotencyKey(idempotencyKeyInput);
  const normalizedTargetUserId = normalizeTargetUserId(requestedTargetUserId);
  const requestHash = await hashRequest({
    orderId,
    targetUserId: normalizedTargetUserId
  });
  const existingResult = await readExistingIdempotencyResult(database, {
    actorUserId: actor.userId,
    operation: CANCEL_OPERATION,
    idempotencyKey,
    requestHash
  });
  if (existingResult) return existingResult;

  const order = await activeOrderForCancellation(database, orderId);
  if (!order) throw notFound('ORDER_NOT_FOUND');
  if (!order.mode) throw notFound('ORDER_PAGE_SETTING_NOT_FOUND');
  const now = resolveClock(clock);
  const actorTarget = await resolveOrderActorTarget(
    database,
    identity,
    normalizedTargetUserId
  );
  if (order.user_id !== actorTarget.targetUserId) throw forbidden('ORDER_FORBIDDEN');
  if (order.status !== 'ACTIVE') throw conflict('ORDER_ALREADY_CANCELLED');
  const permission = {
    ...actorTarget,
    timing: resolveOrderMutationTiming({
      actor: actorTarget.actor,
      isDelegated: actorTarget.isDelegated,
      targetDate: order.order_date,
      mode: order.mode,
      now
    })
  };
  if (!permission.timing.allowed) throw badRequest('DEADLINE_CLOSED');

  const occurredAt = now.toISOString();
  const refundTransactionId = randomId('txn');
  const transitionId = randomId('transition');
  const details = {
    actorUserId: actor.userId,
    operation: CANCEL_OPERATION,
    idempotencyKey,
    requestHash,
    occurredAt,
    orderId,
    refundTransactionId,
    transitionId,
    cancelAuditId: randomId('audit')
  };
  try {
    return await runIdempotentMutation(database, {
      ...details,
      responseSpec: mutationResponseSpec({
        message: 'ORDER_CANCELLED',
        orderId,
        balanceUserId: permission.targetUserId
      }),
      buildStatements: ({ guard }) => {
        const guardSql = guard.sql;
        const guardParams = guard.params;
        const deadlineA = deadlineAt(order.order_date, 'A').toISOString();
        const deadlineB = deadlineAt(order.order_date, 'B').toISOString();
        const calendarTimingPredicate = permission.timing.cutoffApplies
          ? `AND (
              (cs.mode = 'A' AND ? <= ?)
              OR (cs.mode = 'B' AND ? <= ?)
            )`
          : '';
        const calendarTimingParams = permission.timing.cutoffApplies
          ? [occurredAt, deadlineA, occurredAt, deadlineB]
          : [];
        const validOrder = `
          EXISTS (
            SELECT 1
            FROM orders o
            JOIN calendar_settings cs ON cs.order_date = o.order_date
            WHERE o.order_id = ?
              AND o.user_id = ?
              AND o.status = 'ACTIVE'
              AND NOT EXISTS (
                SELECT 1 FROM balance_ledger bl
                WHERE bl.type = 'REFUND' AND bl.reference_id = o.order_id
              )
              ${calendarTimingPredicate}
          )
        `;
        const assertRequest = prepareStatement(database, `
          UPDATE idempotency_keys
          SET status = CASE WHEN (${validOrder}) THEN status ELSE 'FAILED' END
          WHERE ${guardSql}
        `, [
          orderId,
          permission.targetUserId,
          ...calendarTimingParams,
          ...guardParams
        ]);
        const refundLedger = ledgerMutationStatements(database, {
          transactionId: refundTransactionId,
          userId: permission.targetUserId,
          employeeIdSnapshot: permission.target.employeeId,
          lineUserIdSnapshot: permission.target.lineUserId,
          displayNameSnapshot: permission.target.displayName,
          amount: Number(order.total_amount),
          type: 'REFUND',
          referenceId: orderId,
          operatorUserId: actor.userId,
          operatorEmployeeIdSnapshot: actor.employeeId,
          operatorLineUserIdSnapshot: actor.lineUserId,
          operatorDisplayNameSnapshot: actor.displayName,
          operatorAuthMode: actor.authMode,
          authMode: actor.authMode,
          note: 'ORDER_CANCELLED',
          occurredAt
        }, { guard, dynamicBalanceAfter: true }).statements;
        const statusHistory = prepareStatement(database, `
          INSERT INTO order_status_history (
            transition_id, order_id, from_status, to_status, actor_user_id,
            actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
            display_name_snapshot, reason, metadata_json, occurred_at
          )
          SELECT ?, o.order_id, 'ACTIVE', 'CANCELLED', ?, ?, u.employee_id,
                 u.line_user_id, u.display_name, 'ORDER_CANCELLED', '{}', ?
          FROM orders o
          JOIN users u ON u.user_id = o.user_id
          WHERE o.order_id = ? AND o.user_id = ? AND o.status = 'ACTIVE'
            AND ${guardSql}
        `, [
          transitionId,
          actor.userId,
          actor.authMode,
          occurredAt,
          orderId,
          permission.targetUserId,
          ...guardParams
        ]);
        const cancel = prepareStatement(database, `
          UPDATE orders
          SET status = 'CANCELLED',
              cancelled_by_user_id = ?,
              cancelled_auth_mode = ?,
              updated_at = ?
          WHERE order_id = ? AND user_id = ? AND status = 'ACTIVE'
            AND ${guardSql}
        `, [
          actor.userId,
          actor.authMode,
          occurredAt,
          orderId,
          permission.targetUserId,
          ...guardParams
        ]);
        const orderAudit = permission.isDelegated
          ? auditStatement(database, {
            auditId: details.cancelAuditId,
            actorUserId: actor.userId,
            actorAuthMode: actor.authMode,
            actorEmployeeIdSnapshot: actor.employeeId,
            actorLineUserIdSnapshot: actor.lineUserId,
            targetUserId: permission.target.userId,
            targetEmployeeIdSnapshot: permission.target.employeeId,
            targetLineUserIdSnapshot: permission.target.lineUserId,
            action: 'ORDER_CANCEL',
            metadata: { orderId },
            occurredAt,
            onlyIfPriorMutation: true
          })
          : null;
        const assertCancelled = prepareStatement(database, `
          UPDATE idempotency_keys
          SET status = CASE WHEN EXISTS (
            SELECT 1 FROM orders
            WHERE order_id = ? AND user_id = ? AND status = 'CANCELLED'
          ) THEN status ELSE 'FAILED' END
          WHERE ${guardSql}
        `, [orderId, permission.targetUserId, ...guardParams]);
        return [
          assertRequest,
          ...refundLedger,
          statusHistory,
          cancel,
          ...(orderAudit ? [orderAudit] : []),
          assertCancelled
        ];
      }
    });
  } catch (error) {
    mapTransactionFailure(error);
  }
};

export const ORDER_OPERATIONS = Object.freeze({
  CREATE_OR_REPLACE_ORDER: ORDER_OPERATION,
  CANCEL_ORDER: CANCEL_OPERATION
});
