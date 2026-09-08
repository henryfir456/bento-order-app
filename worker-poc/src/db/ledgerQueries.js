import { badRequest, conflict } from '../http/errors.js';
import { prepareStatement, runMutationBatch } from './transactions.js';

export const LEDGER_TYPES = Object.freeze(['TOPUP', 'ORDER', 'REFUND', 'ADJUSTMENT']);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const timestamp = (value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest('LEDGER_TIMESTAMP_INVALID');
  return date.toISOString();
};

const approvedPolicy = (policy) => Boolean(
  policy?.approved === true
  && typeof policy.policyId === 'string'
  && policy.policyId.trim()
  && typeof policy.approvedBy === 'string'
  && policy.approvedBy.trim()
  && typeof policy.approvedAt === 'string'
  && !Number.isNaN(new Date(policy.approvedAt).getTime())
  && typeof policy.reference === 'string'
  && policy.reference.trim()
);

const referenceRule = (entry) => {
  if (entry.type === 'ORDER' || entry.type === 'REFUND') {
    return {
      sql: `EXISTS (
        SELECT 1 FROM orders o
        WHERE o.order_id = ? AND o.line_user_id = ?
      )`,
      params: [entry.referenceId, entry.lineUserId]
    };
  }
  if (entry.type === 'TOPUP') {
    return {
      sql: `EXISTS (
        SELECT 1 FROM admin_audit_log a
        WHERE a.audit_id = ?
          AND a.target_line_user_id = ?
          AND a.actor_line_user_id = ?
          AND a.action = 'BALANCE_TOP_UP'
      )`,
      params: [entry.referenceId, entry.lineUserId, entry.operatorLineUserId]
    };
  }
  return {
    sql: `EXISTS (
      SELECT 1 FROM admin_audit_log a
      WHERE a.audit_id = ?
        AND a.target_line_user_id = ?
        AND a.actor_line_user_id = ?
        AND a.action = 'BALANCE_ADJUSTMENT'
    )`,
    params: [entry.referenceId, entry.lineUserId, entry.operatorLineUserId]
  };
};

export const validateLedgerEntry = (input) => {
  const entry = {
    transactionId: text(input?.transactionId),
    lineUserId: text(input?.lineUserId),
    amount: input?.amount,
    balanceAfter: input?.balanceAfter,
    type: text(input?.type).toUpperCase(),
    referenceId: text(input?.referenceId),
    operatorLineUserId: text(input?.operatorLineUserId) || null,
    note: text(input?.note),
    occurredAt: timestamp(input?.occurredAt),
    sourceBatchId: text(input?.sourceBatchId) || null,
    policy: input?.policy || null
  };

  if (!entry.transactionId) throw badRequest('LEDGER_TRANSACTION_ID_REQUIRED');
  if (!entry.lineUserId) throw badRequest('LEDGER_USER_REQUIRED');
  if (!Number.isSafeInteger(entry.amount)) throw badRequest('LEDGER_AMOUNT_INTEGER_REQUIRED');
  if (!Number.isSafeInteger(entry.balanceAfter)) {
    throw badRequest('LEDGER_BALANCE_INTEGER_REQUIRED');
  }
  if (!LEDGER_TYPES.includes(entry.type)) throw badRequest('LEDGER_TYPE_INVALID');
  if (!entry.referenceId) throw badRequest('LEDGER_REFERENCE_REQUIRED');
  if (entry.type === 'TOPUP' && !entry.operatorLineUserId) {
    throw badRequest('LEDGER_OPERATOR_REQUIRED');
  }
  if (entry.type === 'ADJUSTMENT' && !entry.operatorLineUserId) {
    throw badRequest('LEDGER_OPERATOR_REQUIRED');
  }
  if (entry.type === 'ADJUSTMENT' && !approvedPolicy(entry.policy)) {
    throw conflict('OPENING_BALANCE_POLICY_REQUIRED');
  }
  if (entry.note.length > 2000) throw badRequest('LEDGER_NOTE_TOO_LONG');
  return entry;
};

export const ledgerMutationStatements = (
  database,
  input,
  { guard, dynamicBalanceAfter = false } = {}
) => {
  const entry = validateLedgerEntry({
    ...input,
    balanceAfter: dynamicBalanceAfter ? 0 : input?.balanceAfter
  });
  const guardSql = guard?.sql || '1 = 1';
  const guardParams = guard?.params || [];
  const reference = referenceRule(entry);

  const update = prepareStatement(database, `
    UPDATE users
    SET balance = CASE
          WHEN ${dynamicBalanceAfter ? `(${reference.sql})` : `balance + ? = ? AND (${reference.sql})`}
          THEN balance + ?
          ELSE NULL
        END,
        updated_at = ?
    WHERE line_user_id = ? AND ${guardSql}
  `, dynamicBalanceAfter
    ? [
      ...reference.params,
      entry.amount,
      entry.occurredAt,
      entry.lineUserId,
      ...guardParams
    ]
    : [
      entry.amount,
      entry.balanceAfter,
      ...reference.params,
      entry.amount,
      entry.occurredAt,
      entry.lineUserId,
      ...guardParams
    ]);

  const insert = prepareStatement(database, `
    INSERT INTO balance_ledger (
      transaction_id, line_user_id, amount, balance_after, type,
      reference_id, operator_line_user_id, note, occurred_at, source_batch_id
    )
    SELECT ?, ?, ?, ${dynamicBalanceAfter ? 'balance' : '?'}, ?, ?, ?, ?, ?, ?
    FROM users
    WHERE line_user_id = ?
      ${dynamicBalanceAfter ? '' : 'AND balance = ?'}
      AND ${guardSql}
  `, [
    entry.transactionId,
    entry.lineUserId,
    entry.amount,
    ...(dynamicBalanceAfter ? [] : [entry.balanceAfter]),
    entry.type,
    entry.referenceId,
    entry.operatorLineUserId,
    entry.note,
    entry.occurredAt,
    entry.sourceBatchId,
    entry.lineUserId,
    ...(dynamicBalanceAfter ? [] : [entry.balanceAfter]),
    ...guardParams
  ]);

  return { entry, statements: [update, insert] };
};

const assertReferenceExists = async (database, entry) => {
  const reference = referenceRule(entry);
  const row = await database.prepare(`SELECT 1 AS present WHERE ${reference.sql}`)
    .bind(...reference.params)
    .first();
  if (!row) {
    throw badRequest(
      entry.type === 'TOPUP' ? 'LEDGER_AUDIT_REFERENCE_INVALID' : 'LEDGER_ORDER_REFERENCE_INVALID'
    );
  }
};

export const appendLedgerEntry = async (database, input) => {
  const entry = validateLedgerEntry(input);
  const user = await database.prepare(`
    SELECT line_user_id FROM users WHERE line_user_id = ? LIMIT 1
  `).bind(entry.lineUserId).first();
  if (!user) throw badRequest('LEDGER_USER_NOT_FOUND');
  await assertReferenceExists(database, entry);
  const { statements } = ledgerMutationStatements(database, entry);
  try {
    await runMutationBatch(database, statements);
  } catch (error) {
    if (error?.code === 'TRANSACTION_FAILED') {
      throw conflict('LEDGER_INVARIANT_VIOLATION');
    }
    throw error;
  }
  return database.prepare(`
    SELECT transaction_id, line_user_id, amount, balance_after, type,
           reference_id, operator_line_user_id, note, occurred_at, source_batch_id
    FROM balance_ledger
    WHERE transaction_id = ?
    LIMIT 1
  `).bind(entry.transactionId).first();
};

export const getLedgerRows = async (database, lineUserId, { from, to } = {}) => {
  const result = await database.prepare(`
    SELECT bl.transaction_id, bl.line_user_id, bl.amount, bl.balance_after,
           bl.type, bl.reference_id, bl.operator_line_user_id, bl.note,
           bl.occurred_at, bl.source_batch_id, o.order_date
    FROM balance_ledger bl
    JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
    LEFT JOIN orders o ON o.order_id = bl.reference_id
      AND bl.type IN ('ORDER', 'REFUND')
    WHERE bl.line_user_id = ?
      AND (? IS NULL OR bl.occurred_at >= ?)
      AND (? IS NULL OR bl.occurred_at < ?)
    ORDER BY bls.sequence_number ASC
  `).bind(lineUserId, from || null, from || null, to || null, to || null).all();
  return Array.isArray(result) ? result : (result?.results || []);
};

export const getLatestLedgerRow = async (database, lineUserId, before = null) => (
  database.prepare(`
    SELECT bl.transaction_id, bl.line_user_id, bl.amount, bl.balance_after, bl.type,
           bl.reference_id, bl.operator_line_user_id, bl.note, bl.occurred_at,
           bl.source_batch_id
    FROM balance_ledger bl
    JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
    WHERE bl.line_user_id = ?
      AND (? IS NULL OR bl.occurred_at < ?)
    ORDER BY bls.sequence_number DESC
    LIMIT 1
  `).bind(lineUserId, before, before).first()
);
