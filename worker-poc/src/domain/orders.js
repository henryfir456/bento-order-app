import { ACTIONS, assertCan } from '../auth/permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import {
  hashRequest,
  mutationResponseSpec,
  readExistingIdempotencyResult,
  requireIdempotencyKey,
  runIdempotentMutation
} from '../db/idempotency.js';
import { prepareStatement, randomId, resolveClock } from '../db/transactions.js';
import { deadlineAt, deadlineInfo, isDateOnly } from './deadlines.js';
import { getUserById } from '../db/users.js';
import { isProfileComplete } from './profile.js';
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

const actorForMutation = (identity) => {
  const actor = identity?.actor;
  assertCan(identity, ACTIONS.WRITE_SELF);
  if (!actor?.userId) throw forbidden('AUTH_REQUIRED');
  if (
    identity?.effectiveSubject?.userId
    && identity.effectiveSubject.userId !== actor.userId
  ) {
    throw forbidden('VIEW_AS_MUTATION_FORBIDDEN');
  }
  return actor;
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

const assertOrderRequest = async (database, actor, input, clock, { skipDeadline = false } = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw badRequest('INVALID_JSON');
  }
  const targetDate = text(getInputValue(input, 'targetDate', 'target_date', 'date'));
  if (!isDateOnly(targetDate)) throw badRequest('INVALID_DATE');
  const pickupFloor = text(getInputValue(input, 'pickupFloor', 'pickup_floor'));
  if (!VALID_FLOORS.has(pickupFloor)) throw badRequest('INVALID_PICKUP_FLOOR');
  const note = text(input.note);
  if (note.length > 2000) throw badRequest('ORDER_NOTE_TOO_LONG');

  const currentUser = await getUserById(database, actor.userId);
  if (!currentUser || !isProfileComplete(currentUser)) {
    throw forbidden('PROFILE_COMPLETION_REQUIRED');
  }

  const setting = await currentSetting(database, targetDate);
  if (!setting || !text(setting.vendor)) throw notFound('ORDER_PAGE_SETTING_NOT_FOUND');
  const now = resolveClock(clock);
  const deadline = deadlineInfo(targetDate, setting.mode, now);
  if (!skipDeadline && (!deadline || deadline.isExpired)) throw badRequest('DEADLINE_CLOSED');

  const menu = await currentMenuRows(database, setting.vendor, targetDate);
  const items = normalizeItems(getInputValue(input, 'items', 'orderItems'), menu.rows);
  const replaceExisting = input.replaceExisting !== false && input.replace_existing !== false;
  const activeOrder = await database.prepare(`
    SELECT order_id, total_amount
    FROM orders
    WHERE user_id = ? AND order_date = ? AND status = 'ACTIVE'
    LIMIT 1
  `).bind(actor.userId, targetDate).first();
  return {
    targetDate,
    pickupFloor,
    note,
    setting,
    items,
    replaceExisting,
    activeOrder,
    now,
    deadline
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

const eventUserValues = (actor) => [
  actor.userId,
  actor.employeeId,
  actor.lineUserId,
  actor.displayName,
  actor.authMode,
  actor.authMode
];

const buildOrderStatements = (database, context, actor, details) => {
  const { targetDate, pickupFloor, note, items, replaceExisting, now } = context;
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
  const metadata = JSON.stringify({ replacementOrderId: orderId });
  const validityPredicate = `
    EXISTS (
      SELECT 1 FROM users WHERE user_id = ? AND active = 1
    )
    AND EXISTS (
      SELECT 1
      FROM calendar_settings cs
      WHERE cs.order_date = ?
        AND length(trim(cs.vendor)) > 0
        AND (
          (cs.mode = 'A' AND ? <= ?)
          OR (cs.mode = 'B' AND ? <= ?)
        )
    )
    AND (SELECT COUNT(*) FROM priced) = ?
    AND (? = 1 OR NOT EXISTS (
      SELECT 1 FROM orders
      WHERE user_id = ? AND order_date = ? AND status = 'ACTIVE'
    ))
  `;
  const deadlineA = deadlineAt(targetDate, 'A').toISOString();
  const deadlineB = deadlineAt(targetDate, 'B').toISOString();
  const validityParams = [
    actor.userId,
    targetDate,
    occurredAt,
    deadlineA,
    occurredAt,
    deadlineB,
    items.length,
    replaceExisting ? 1 : 0,
    actor.userId,
    targetDate
  ];

  const assertRequest = prepareStatement(database, `${menuCte(items)}
    UPDATE idempotency_keys
    SET status = CASE WHEN (${validityPredicate}) THEN status ELSE 'FAILED' END
    WHERE ${guardSql}
  `, [...menuParams(items), ...validityParams, ...guardParams]);

  const refundBalance = prepareStatement(database, `
    UPDATE users
    SET balance = balance + COALESCE((
      SELECT o.total_amount
      FROM orders o
      WHERE o.user_id = ? AND o.order_date = ? AND o.status = 'ACTIVE'
      LIMIT 1
    ), 0),
        updated_at = ?
    WHERE user_id = ? AND ${guardSql}
  `, [actor.userId, targetDate, occurredAt, actor.userId, ...guardParams]);

  const refundLedger = prepareStatement(database, `
    INSERT INTO balance_ledger (
      transaction_id, user_id, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, amount, balance_after, type, reference_id,
      operator_user_id, operator_employee_id_snapshot,
      operator_line_user_id_snapshot, operator_display_name_snapshot,
      operator_auth_mode, auth_mode, note, occurred_at
    )
    SELECT ?, o.user_id, u.employee_id, u.line_user_id, u.display_name,
           o.total_amount, u.balance, 'REFUND', o.order_id,
           ?, ?, ?, ?, ?, ?, 'ORDER_REPLACED', ?
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    WHERE o.user_id = ? AND o.order_date = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    refundTransactionId,
    ...eventUserValues(actor),
    occurredAt,
    actor.userId,
    targetDate,
    ...guardParams
  ]);

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
    actor.userId,
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
  `, [actor.userId, actor.authMode, occurredAt, actor.userId, targetDate, ...guardParams]);

  const debitBalance = prepareStatement(database, `${menuCte(items)}
    UPDATE users
    SET balance = balance - (SELECT SUM(quantity * price) FROM priced),
        updated_at = ?
    WHERE user_id = ?
      AND (SELECT COUNT(*) FROM priced) = ?
      AND ${guardSql}
  `, [
    ...menuParams(items),
    occurredAt,
    actor.userId,
    items.length,
    ...guardParams
  ]);

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
      AND (
        (cs.mode = 'A' AND ? <= ?)
        OR (cs.mode = 'B' AND ? <= ?)
      )
      AND ${guardSql}
  `, [
    ...menuParams(items),
    orderId,
    actor.userId,
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
    occurredAt,
    deadlineA,
    occurredAt,
    deadlineB,
    ...guardParams
  ]);

  const assertOrderInserted = prepareStatement(database, `
    UPDATE idempotency_keys
    SET status = CASE WHEN EXISTS (
      SELECT 1 FROM orders
      WHERE order_id = ? AND user_id = ? AND status = 'ACTIVE'
    ) THEN status ELSE 'FAILED' END
    WHERE ${guardSql}
  `, [orderId, actor.userId, ...guardParams]);

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

  const orderLedger = prepareStatement(database, `
    INSERT INTO balance_ledger (
      transaction_id, user_id, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, amount, balance_after, type, reference_id,
      operator_user_id, operator_employee_id_snapshot,
      operator_line_user_id_snapshot, operator_display_name_snapshot,
      operator_auth_mode, auth_mode, note, occurred_at
    )
    SELECT ?, o.user_id, u.employee_id, u.line_user_id, u.display_name,
           -o.total_amount, u.balance, 'ORDER', o.order_id,
           ?, ?, ?, ?, ?, ?, 'ORDER_CREATED', ?
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    WHERE o.order_id = ? AND o.user_id = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    details.orderTransactionId,
    ...eventUserValues(actor),
    occurredAt,
    orderId,
    actor.userId,
    ...guardParams
  ]);

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
    actor.userId,
    ...guardParams
  ]);

  return [
    assertRequest,
    refundBalance,
    refundLedger,
    replacementHistory,
    cancelPrevious,
    debitBalance,
    insertOrder,
    assertOrderInserted,
    insertItems,
    assertItemsInserted,
    orderLedger,
    createdHistory
  ];
};

export const createOrReplaceOrder = async (database, identity, input, clock = new Date()) => {
  const actor = actorForMutation(identity);
  const idempotencyKey = requireIdempotencyKey(input?.idempotencyKey);
  const context = await assertOrderRequest(database, actor, input, clock, { skipDeadline: true });
  const requestPayload = {
    targetDate: context.targetDate,
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
  if (!context.deadline || context.deadline.isExpired) throw badRequest('DEADLINE_CLOSED');
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
    createdTransitionId: randomId('transition')
  };
  try {
    return await runIdempotentMutation(database, {
      ...details,
      responseSpec: mutationResponseSpec({
        message: 'ORDER_SAVED',
        orderId,
        balanceUserId: actor.userId
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
  clock = new Date()
) => {
  const actor = actorForMutation(identity);
  const orderId = text(orderIdInput);
  if (!orderId) throw badRequest('ORDER_ID_REQUIRED');
  const idempotencyKey = requireIdempotencyKey(idempotencyKeyInput);
  const requestHash = await hashRequest({ orderId });
  const existingResult = await readExistingIdempotencyResult(database, {
    actorUserId: actor.userId,
    operation: CANCEL_OPERATION,
    idempotencyKey,
    requestHash
  });
  if (existingResult) return existingResult;
  const order = await activeOrderForCancellation(database, orderId);
  if (!order) throw notFound('ORDER_NOT_FOUND');
  if (order.user_id !== actor.userId) throw forbidden('ORDER_FORBIDDEN');
  if (order.status !== 'ACTIVE') throw conflict('ORDER_ALREADY_CANCELLED');
  if (!order.mode) throw notFound('ORDER_PAGE_SETTING_NOT_FOUND');
  const now = resolveClock(clock);
  const deadline = deadlineInfo(order.order_date, order.mode, now);
  if (!deadline || deadline.isExpired) throw badRequest('DEADLINE_CLOSED');

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
    transitionId
  };
  try {
    return await runIdempotentMutation(database, {
      ...details,
      responseSpec: mutationResponseSpec({
        message: 'ORDER_CANCELLED',
        orderId,
        balanceUserId: actor.userId
      }),
      buildStatements: ({ guard }) => {
        const guardSql = guard.sql;
        const guardParams = guard.params;
        const deadlineA = deadlineAt(order.order_date, 'A').toISOString();
        const deadlineB = deadlineAt(order.order_date, 'B').toISOString();
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
              AND (
                (cs.mode = 'A' AND ? <= ?)
                OR (cs.mode = 'B' AND ? <= ?)
              )
          )
        `;
        const assertRequest = prepareStatement(database, `
          UPDATE idempotency_keys
          SET status = CASE WHEN (${validOrder}) THEN status ELSE 'FAILED' END
          WHERE ${guardSql}
        `, [
          orderId,
          actor.userId,
          occurredAt,
          deadlineA,
          occurredAt,
          deadlineB,
          ...guardParams
        ]);
        const refundBalance = prepareStatement(database, `
          UPDATE users
          SET balance = balance + (
            SELECT total_amount FROM orders
            WHERE order_id = ? AND user_id = ? AND status = 'ACTIVE'
          ), updated_at = ?
          WHERE user_id = ? AND ${guardSql}
        `, [orderId, actor.userId, occurredAt, actor.userId, ...guardParams]);
        const refundLedger = prepareStatement(database, `
          INSERT INTO balance_ledger (
            transaction_id, user_id, employee_id_snapshot, line_user_id_snapshot,
            display_name_snapshot, amount, balance_after, type, reference_id,
            operator_user_id, operator_employee_id_snapshot,
            operator_line_user_id_snapshot, operator_display_name_snapshot,
            operator_auth_mode, auth_mode, note, occurred_at
          )
          SELECT ?, o.user_id, u.employee_id, u.line_user_id, u.display_name,
                 o.total_amount, u.balance, 'REFUND', o.order_id,
                 ?, ?, ?, ?, ?, ?, 'ORDER_CANCELLED', ?
          FROM orders o
          JOIN users u ON u.user_id = o.user_id
          WHERE o.order_id = ? AND o.user_id = ? AND o.status = 'ACTIVE'
            AND ${guardSql}
        `, [
          refundTransactionId,
          ...eventUserValues(actor),
          occurredAt,
          orderId,
          actor.userId,
          ...guardParams
        ]);
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
          actor.userId,
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
        `, [actor.userId, actor.authMode, occurredAt, orderId, actor.userId, ...guardParams]);
        const assertCancelled = prepareStatement(database, `
          UPDATE idempotency_keys
          SET status = CASE WHEN EXISTS (
            SELECT 1 FROM orders
            WHERE order_id = ? AND user_id = ? AND status = 'CANCELLED'
          ) THEN status ELSE 'FAILED' END
          WHERE ${guardSql}
        `, [orderId, actor.userId, ...guardParams]);
        return [
          assertRequest,
          refundBalance,
          refundLedger,
          statusHistory,
          cancel,
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
