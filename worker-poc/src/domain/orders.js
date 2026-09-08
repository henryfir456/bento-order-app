import { ACTIONS, assertCan } from '../auth/permissions.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import {
  hashRequest,
  mutationResponseSpec,
  readExistingIdempotencyResult,
  requireIdempotencyKey,
  runIdempotentMutation
} from '../db/idempotency.js';
import {
  prepareStatement,
  randomId,
  resolveClock
} from '../db/transactions.js';
import { deadlineAt, deadlineInfo, isDateOnly } from './deadlines.js';

const VALID_FLOORS = new Set(['1樓', '9樓']);
const ORDER_OPERATION = 'CREATE_OR_REPLACE_ORDER';
const CANCEL_OPERATION = 'CANCEL_ORDER';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

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
  if (!actor?.lineUserId) throw forbidden('AUTH_REQUIRED');
  if (
    identity?.effectiveSubject?.lineUserId
    && identity.effectiveSubject.lineUserId !== actor.lineUserId
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
  const result = await database.prepare(`
    SELECT mi.menu_item_id, mi.legacy_item_id, mi.item_name, mi.price,
           mi.enabled, mv.menu_version_id, mv.effective_date
    FROM menu_items mi
    JOIN menu_versions mv ON mv.menu_version_id = mi.menu_version_id
    WHERE mv.vendor = ?
      AND mv.effective_date = (
        SELECT MAX(mv2.effective_date)
        FROM menu_versions mv2
        WHERE mv2.vendor = ? AND mv2.effective_date <= ?
      )
    ORDER BY mi.source_order ASC, mi.menu_item_id ASC
  `).bind(vendor, vendor, targetDate).all();
  return rowsFrom(result);
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
      normalized.push({ menuItemId: key, quantity });
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

  const setting = await currentSetting(database, targetDate);
  if (!setting || !text(setting.vendor)) throw notFound('ORDER_PAGE_SETTING_NOT_FOUND');
  const now = resolveClock(clock);
  const deadline = deadlineInfo(targetDate, setting.mode, now);
  if (!skipDeadline && (!deadline || deadline.isExpired)) throw badRequest('DEADLINE_CLOSED');

  const menuRows = await currentMenuRows(database, setting.vendor, targetDate);
  const items = normalizeItems(getInputValue(input, 'items', 'orderItems'), menuRows);
  const replaceExisting = input.replaceExisting !== false && input.replace_existing !== false;
  const activeOrder = await database.prepare(`
    SELECT order_id, total_amount
    FROM orders
    WHERE line_user_id = ? AND order_date = ? AND status = 'ACTIVE'
    LIMIT 1
  `).bind(actor.lineUserId, targetDate).first();
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

const requestedValues = (items) => items.map(() => '(?, ?, ?)').join(', ');

const menuCte = (items) => `
  WITH requested(line_no, menu_item_id, quantity) AS (
    VALUES ${requestedValues(items)}
  ),
  latest AS (
    SELECT mv.menu_version_id
    FROM menu_versions mv
    WHERE mv.vendor = (
      SELECT vendor FROM calendar_settings WHERE order_date = ? LIMIT 1
    )
      AND mv.effective_date <= ?
    ORDER BY mv.effective_date DESC, mv.menu_version_id DESC
    LIMIT 1
  ),
  priced AS (
    SELECT r.line_no, r.menu_item_id, r.quantity,
           mi.legacy_item_id, mi.item_name, mi.price
    FROM requested r
    JOIN menu_items mi ON mi.menu_item_id = r.menu_item_id
    JOIN latest l ON l.menu_version_id = mi.menu_version_id
    WHERE mi.enabled = 1
  )
`;

const menuParams = (items, targetDate) => [
  ...items.flatMap((item, index) => [index + 1, item.menuItemId, item.quantity]),
  targetDate,
  targetDate
];

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
    targetDate, pickupFloor, note, items, replaceExisting, now
  } = context;
  const { orderId, refundTransactionId, replacementTransitionId, createdTransitionId, guard } = details;
  const occurredAt = now.toISOString();
  const guardSql = guard.sql;
  const guardParams = guard.params;
  const metadata = JSON.stringify({ replacementOrderId: orderId });
  const validityPredicate = `
    EXISTS (
      SELECT 1 FROM users WHERE line_user_id = ?
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
      WHERE line_user_id = ? AND order_date = ? AND status = 'ACTIVE'
    ))
  `;
  const deadlineA = deadlineAt(targetDate, 'A').toISOString();
  const deadlineB = deadlineAt(targetDate, 'B').toISOString();
  const validityParams = [
    actor.lineUserId,
    targetDate,
    occurredAt,
    deadlineA,
    occurredAt,
    deadlineB,
    items.length,
    replaceExisting ? 1 : 0,
    actor.lineUserId,
    targetDate
  ];

  const assertRequest = prepareStatement(database, `${menuCte(items)}
    UPDATE idempotency_keys
    SET status = CASE WHEN (${validityPredicate}) THEN status ELSE 'INVALID' END
    WHERE ${guardSql}
  `, [...menuParams(items, targetDate), ...validityParams, ...guardParams]);

  const refundBalance = prepareStatement(database, `
    UPDATE users
    SET balance = balance + COALESCE((
      SELECT o.total_amount
      FROM orders o
      WHERE o.line_user_id = ? AND o.order_date = ? AND o.status = 'ACTIVE'
      LIMIT 1
    ), 0),
        updated_at = ?
    WHERE line_user_id = ? AND ${guardSql}
  `, [actor.lineUserId, targetDate, occurredAt, actor.lineUserId, ...guardParams]);

  const refundLedger = prepareStatement(database, `
    INSERT INTO balance_ledger (
      transaction_id, line_user_id, amount, balance_after, type,
      reference_id, operator_line_user_id, note, occurred_at
    )
    SELECT ?, o.line_user_id, o.total_amount, u.balance, 'REFUND',
           o.order_id, ?, ?, ?
    FROM orders o
    JOIN users u ON u.line_user_id = o.line_user_id
    WHERE o.line_user_id = ? AND o.order_date = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    refundTransactionId,
    actor.lineUserId,
    'ORDER_REPLACED',
    occurredAt,
    actor.lineUserId,
    targetDate,
    ...guardParams
  ]);

  const replacementHistory = prepareStatement(database, `
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_line_user_id,
      reason, metadata_json, occurred_at
    )
    SELECT ?, o.order_id, 'ACTIVE', 'CANCELLED', ?, 'ORDER_REPLACED', ?, ?
    FROM orders o
    WHERE o.line_user_id = ? AND o.order_date = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    replacementTransitionId,
    actor.lineUserId,
    metadata,
    occurredAt,
    actor.lineUserId,
    targetDate,
    ...guardParams
  ]);

  const cancelPrevious = prepareStatement(database, `
    UPDATE orders
    SET status = 'CANCELLED', updated_at = ?
    WHERE line_user_id = ? AND order_date = ? AND status = 'ACTIVE'
      AND ${guardSql}
  `, [occurredAt, actor.lineUserId, targetDate, ...guardParams]);

  const debitBalance = prepareStatement(database, `${menuCte(items)}
    UPDATE users
    SET balance = balance - (SELECT SUM(quantity * price) FROM priced),
        updated_at = ?
    WHERE line_user_id = ?
      AND (SELECT COUNT(*) FROM priced) = ?
      AND ${guardSql}
  `, [
    ...menuParams(items, targetDate),
    occurredAt,
    actor.lineUserId,
    items.length,
    ...guardParams
  ]);

  const insertOrder = prepareStatement(database, `${menuCte(items)}
    INSERT INTO orders (
      order_id, line_user_id, order_date, vendor, pickup_floor, note,
      total_amount, status, created_at, updated_at
    )
    SELECT ?, ?, ?, cs.vendor, ?, ?,
           CASE WHEN (SELECT COUNT(*) FROM priced) = ?
                THEN (SELECT SUM(quantity * price) FROM priced)
                ELSE NULL END,
           'ACTIVE', ?, ?
    FROM calendar_settings cs
    WHERE cs.order_date = ?
      AND length(trim(cs.vendor)) > 0
      AND (
        (cs.mode = 'A' AND ? <= ?)
        OR (cs.mode = 'B' AND ? <= ?)
      )
      AND ${guardSql}
  `, [
    ...menuParams(items, targetDate),
    orderId,
    actor.lineUserId,
    targetDate,
    pickupFloor,
    note,
    items.length,
    occurredAt,
    occurredAt,
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
      WHERE order_id = ? AND line_user_id = ? AND status = 'ACTIVE'
    ) THEN status ELSE 'INVALID' END
    WHERE ${guardSql}
  `, [orderId, actor.lineUserId, ...guardParams]);

  const insertItems = prepareStatement(database, `${menuCte(items)}
    INSERT INTO order_items (
      order_id, line_no, menu_item_id, legacy_item_id, item_name_snapshot,
      quantity, unit_price, subtotal
    )
    SELECT ?, p.line_no, p.menu_item_id, p.legacy_item_id, p.item_name,
           p.quantity, p.price, p.quantity * p.price
    FROM priced p
    WHERE ${guardSql}
  `, [...menuParams(items, targetDate), orderId, ...guardParams]);

  const assertItemsInserted = prepareStatement(database, `
    UPDATE idempotency_keys
    SET status = CASE WHEN (
      SELECT COUNT(*) FROM order_items WHERE order_id = ?
    ) = ? THEN status ELSE 'INVALID' END
    WHERE ${guardSql}
  `, [orderId, items.length, ...guardParams]);

  const orderLedger = prepareStatement(database, `
    INSERT INTO balance_ledger (
      transaction_id, line_user_id, amount, balance_after, type,
      reference_id, operator_line_user_id, note, occurred_at
    )
    SELECT ?, o.line_user_id, -o.total_amount, u.balance, 'ORDER',
           o.order_id, ?, 'ORDER_CREATED', ?
    FROM orders o
    JOIN users u ON u.line_user_id = o.line_user_id
    WHERE o.order_id = ? AND o.line_user_id = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    details.orderTransactionId,
    actor.lineUserId,
    occurredAt,
    orderId,
    actor.lineUserId,
    ...guardParams
  ]);

  const createdHistory = prepareStatement(database, `
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_line_user_id,
      reason, metadata_json, occurred_at
    )
    SELECT ?, o.order_id, NULL, 'ACTIVE', ?, 'ORDER_CREATED', ?, ?
    FROM orders o
    WHERE o.order_id = ? AND o.line_user_id = ? AND o.status = 'ACTIVE'
      AND ${guardSql}
  `, [
    createdTransitionId,
    actor.lineUserId,
    JSON.stringify({ replaced: Boolean(context.activeOrder) }),
    occurredAt,
    orderId,
    actor.lineUserId,
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
    items: context.items
  };
  const requestHash = await hashRequest(requestPayload);
  const existingResult = await readExistingIdempotencyResult(database, {
    actorLineUserId: actor.lineUserId,
    operation: ORDER_OPERATION,
    idempotencyKey,
    requestHash
  });
  if (existingResult) return existingResult;
  if (!context.deadline || context.deadline.isExpired) throw badRequest('DEADLINE_CLOSED');
  if (!context.replaceExisting && context.activeOrder) throw conflict('ORDER_ALREADY_ACTIVE');
  const orderId = 'ORD-' + randomId('');
  const details = {
    actorLineUserId: actor.lineUserId,
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
        balanceUserId: actor.lineUserId
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
  SELECT o.order_id, o.line_user_id, o.order_date, o.total_amount, o.status,
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
    actorLineUserId: actor.lineUserId,
    operation: CANCEL_OPERATION,
    idempotencyKey,
    requestHash
  });
  if (existingResult) return existingResult;
  const order = await activeOrderForCancellation(database, orderId);
  if (!order) throw notFound('ORDER_NOT_FOUND');
  if (order.line_user_id !== actor.lineUserId) throw forbidden('ORDER_FORBIDDEN');
  if (order.status !== 'ACTIVE') throw conflict('ORDER_ALREADY_CANCELLED');
  if (!order.mode) throw notFound('ORDER_PAGE_SETTING_NOT_FOUND');
  const now = resolveClock(clock);
  const deadline = deadlineInfo(order.order_date, order.mode, now);
  if (!deadline || deadline.isExpired) throw badRequest('DEADLINE_CLOSED');

  const occurredAt = now.toISOString();
  const refundTransactionId = randomId('txn');
  const transitionId = randomId('transition');
  const details = {
    actorLineUserId: actor.lineUserId,
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
        balanceUserId: actor.lineUserId
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
              AND o.line_user_id = ?
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
          SET status = CASE WHEN (${validOrder}) THEN status ELSE 'INVALID' END
          WHERE ${guardSql}
        `, [
          orderId,
          actor.lineUserId,
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
            WHERE order_id = ? AND line_user_id = ? AND status = 'ACTIVE'
          ), updated_at = ?
          WHERE line_user_id = ? AND ${guardSql}
        `, [orderId, actor.lineUserId, occurredAt, actor.lineUserId, ...guardParams]);
        const refundLedger = prepareStatement(database, `
          INSERT INTO balance_ledger (
            transaction_id, line_user_id, amount, balance_after, type,
            reference_id, operator_line_user_id, note, occurred_at
          )
          SELECT ?, o.line_user_id, o.total_amount, u.balance, 'REFUND',
                 o.order_id, ?, 'ORDER_CANCELLED', ?
          FROM orders o
          JOIN users u ON u.line_user_id = o.line_user_id
          WHERE o.order_id = ? AND o.line_user_id = ? AND o.status = 'ACTIVE'
            AND ${guardSql}
        `, [
          refundTransactionId,
          actor.lineUserId,
          occurredAt,
          orderId,
          actor.lineUserId,
          ...guardParams
        ]);
        const statusHistory = prepareStatement(database, `
          INSERT INTO order_status_history (
            transition_id, order_id, from_status, to_status,
            actor_line_user_id, reason, metadata_json, occurred_at
          )
          SELECT ?, o.order_id, 'ACTIVE', 'CANCELLED', ?,
                 'ORDER_CANCELLED', '{}', ?
          FROM orders o
          WHERE o.order_id = ? AND o.line_user_id = ? AND o.status = 'ACTIVE'
            AND ${guardSql}
        `, [
          transitionId,
          actor.lineUserId,
          occurredAt,
          orderId,
          actor.lineUserId,
          ...guardParams
        ]);
        const cancel = prepareStatement(database, `
          UPDATE orders
          SET status = 'CANCELLED', updated_at = ?
          WHERE order_id = ? AND line_user_id = ? AND status = 'ACTIVE'
            AND ${guardSql}
        `, [occurredAt, orderId, actor.lineUserId, ...guardParams]);
        const assertCancelled = prepareStatement(database, `
          UPDATE idempotency_keys
          SET status = CASE WHEN EXISTS (
            SELECT 1 FROM orders
            WHERE order_id = ? AND line_user_id = ? AND status = 'CANCELLED'
          ) THEN status ELSE 'INVALID' END
          WHERE ${guardSql}
        `, [orderId, actor.lineUserId, ...guardParams]);
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
