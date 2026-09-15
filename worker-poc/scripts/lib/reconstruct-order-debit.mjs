import { conflict, notFound } from '../../src/http/errors.js';
import { getCurrentBalance } from '../../src/db/users.js';
import { ledgerMutationStatements } from '../../src/db/ledgerQueries.js';
import { runMutationBatch, resolveClock } from '../../src/db/transactions.js';
import { stableId } from './import-contract.mjs';

const RECONSTRUCTION_REASON = 'POST_CUTOFF_ORDER_RECONSTRUCTION';
const RECONSTRUCTION_AUTH_MODE = 'legacy_import';
const LEGACY_ORDER_CUTOFF = '2026-09-10';

const orderForReconstruction = async (database, orderId) => database.prepare(`
  SELECT o.order_id, o.user_id, o.total_amount, o.order_date, o.created_at,
         o.source_batch_id,
         u.employee_id, u.line_user_id, u.display_name
  FROM orders o
  JOIN users u ON u.user_id = o.user_id
  WHERE o.order_id = ?
  LIMIT 1
`).bind(orderId).first();

const financialReferences = async (database, orderId, transactionId) => {
  const result = await database.prepare(`
    SELECT bl.transaction_id, bl.user_id, bl.amount, bl.balance_after,
           bl.type, bl.reference_id, bl.note, bl.occurred_at,
           bl.source_batch_id, bls.sequence_number
    FROM balance_ledger bl
    LEFT JOIN balance_ledger_sequence bls
      ON bls.transaction_id = bl.transaction_id
    WHERE bl.reference_id = ? OR bl.transaction_id = ?
    ORDER BY bls.sequence_number DESC
  `).bind(orderId, transactionId).all();
  return Array.isArray(result) ? result : (result?.results || []);
};

const reconstructionConflict = (orderId) => (
  conflict('RECONSTRUCTION_REFERENCE_CONFLICT',
    `A financial record already uses reconstructed order ${orderId}.`)
);

const matchingOrderDebit = (rows, order) => {
  const matching = rows.filter((row) => row.reference_id === order.order_id);
  if (matching.length !== 1) return null;
  const row = matching[0];
  if (
    row.type !== 'ORDER'
    || row.user_id !== order.user_id
    || Number(row.amount) !== -Number(order.total_amount)
    || row.sequence_number === null
    || row.sequence_number === undefined
  ) {
    throw reconstructionConflict(order.order_id);
  }
  return row;
};

const resultFor = async (database, order, row, status) => {
  const newBalance = await getCurrentBalance(database, order.user_id);
  return {
    status,
    orderId: order.order_id,
    userId: order.user_id,
    transactionId: row.transaction_id,
    sequenceNumber: Number(row.sequence_number),
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_after) - Number(row.amount),
    balanceAfter: Number(row.balance_after),
    newBalance
  };
};

/**
 * Replays one real post-cutoff order into the canonical financial stream.
 * The order reference is the idempotency identity; this function deliberately
 * accepts one order per call and fails closed on any reference conflict.
 */
export const reconstructOrderDebit = async (
  database,
  orderIdInput,
  {
    sourceBatchId = null,
    reason = RECONSTRUCTION_REASON,
    occurredAt = new Date(),
    transactionId = null,
    operator = null
  } = {}
) => {
  const orderId = String(orderIdInput || '').trim();
  if (!orderId) throw notFound('RECONSTRUCTION_ORDER_NOT_FOUND');
  const order = await orderForReconstruction(database, orderId);
  if (!order) throw notFound('RECONSTRUCTION_ORDER_NOT_FOUND');
  if (String(order.order_date) <= LEGACY_ORDER_CUTOFF) {
    throw conflict('RECONSTRUCTION_ORDER_BEFORE_CUTOFF');
  }
  if (!Number.isSafeInteger(Number(order.total_amount)) || Number(order.total_amount) < 0) {
    throw conflict('RECONSTRUCTION_ORDER_TOTAL_INVALID');
  }

  const stableTransactionId = transactionId || stableId('reconstruction-order', order.order_id);
  const existingRows = await financialReferences(database, order.order_id, stableTransactionId);
  const transactionCollision = existingRows.some((row) => (
    row.transaction_id === stableTransactionId && row.reference_id !== order.order_id
  ));
  if (transactionCollision) throw reconstructionConflict(order.order_id);
  const existing = matchingOrderDebit(existingRows, order);
  if (existing) return resultFor(database, order, existing, 'NO_OP');

  const at = resolveClock(occurredAt).toISOString();
  const resolvedSourceBatchId = sourceBatchId || order.source_batch_id || null;
  const actorUserId = operator?.userId || null;
  const mutation = ledgerMutationStatements(database, {
    transactionId: stableTransactionId,
    userId: order.user_id,
    employeeIdSnapshot: order.employee_id,
    lineUserIdSnapshot: order.line_user_id,
    displayNameSnapshot: order.display_name,
    amount: -Number(order.total_amount),
    type: 'ORDER',
    referenceId: order.order_id,
    operatorUserId: actorUserId,
    operatorEmployeeIdSnapshot: operator?.employeeId || null,
    operatorLineUserIdSnapshot: operator?.lineUserId || null,
    operatorDisplayNameSnapshot: operator?.displayName || null,
    operatorAuthMode: operator?.authMode || RECONSTRUCTION_AUTH_MODE,
    authMode: RECONSTRUCTION_AUTH_MODE,
    note: reason,
    occurredAt: at,
    sourceBatchId: resolvedSourceBatchId
  }, {
    guard: {
      sql: `NOT EXISTS (
        SELECT 1 FROM balance_ledger
        WHERE reference_id = ? OR transaction_id = ?
      )`,
      params: [order.order_id, stableTransactionId]
    },
    dynamicBalanceAfter: true
  });

  await runMutationBatch(database, mutation.statements);
  const committedRows = await financialReferences(database, order.order_id, stableTransactionId);
  const committed = matchingOrderDebit(committedRows, order);
  if (!committed) throw reconstructionConflict(order.order_id);
  return resultFor(database, order, committed, 'APPLIED');
};

export { RECONSTRUCTION_REASON };
