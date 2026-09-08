import { conflict, badRequest } from '../http/errors.js';
import {
  appendLedgerEntry,
  getLatestLedgerRow,
  getLedgerRows
} from '../db/ledgerQueries.js';
import { getUserByLineId } from '../db/users.js';

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const monthBounds = (month) => {
  const match = String(month || '').match(MONTH_PATTERN);
  if (!match) throw badRequest('INVALID_MONTH');
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return { month: `${match[1]}-${match[2]}`, start: start.toISOString(), end: end.toISOString() };
};

const descriptionFor = (row) => row.note || row.type || 'BALANCE_CHANGE';

export const isApprovedOpeningBalancePolicy = (policy) => Boolean(
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

export const assertOpeningBalancePolicy = (policy) => {
  if (!isApprovedOpeningBalancePolicy(policy)) {
    throw conflict('OPENING_BALANCE_POLICY_REQUIRED');
  }
  return policy;
};

export const getBalanceHistory = async (database, lineUserId, monthInput) => {
  const month = monthBounds(monthInput);
  const user = await getUserByLineId(database, lineUserId);
  if (!user) throw conflict('USER_NOT_FOUND');

  const allRows = await getLedgerRows(database, lineUserId);
  if (allRows.length === 0 && user.balance !== 0) {
    throw conflict('OPENING_BALANCE_POLICY_REQUIRED');
  }
  const monthRows = allRows.filter((row) => (
    row.occurred_at >= month.start && row.occurred_at < month.end
  ));
  const prior = await getLatestLedgerRow(database, lineUserId, month.start);
  const closing = await getLatestLedgerRow(database, lineUserId, month.end);
  const first = monthRows[0];
  const openingBalance = prior
    ? Number(prior.balance_after)
    : (first ? Number(first.balance_after) - Number(first.amount) : (allRows.length ? null : 0));
  if (openingBalance === null && user.balance !== 0) {
    throw conflict('OPENING_BALANCE_POLICY_REQUIRED');
  }

  let totalCredit = 0;
  let totalDebit = 0;
  for (const row of monthRows) {
    if (row.amount >= 0) totalCredit += Number(row.amount);
    else totalDebit += Math.abs(Number(row.amount));
  }

  const transactions = monthRows.slice().reverse().map((row) => ({
    id: row.transaction_id,
    transactionId: row.transaction_id,
    type: row.type,
    referenceId: row.reference_id || '',
    description: descriptionFor(row),
    note: row.note || '',
    occurredAt: row.occurred_at,
    timestamp: row.occurred_at.slice(0, 16),
    businessDate: row.order_date || null,
    amount: Number(row.amount),
    changeAmount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    balance: Number(row.balance_after)
  }));

  return {
    success: true,
    ok: true,
    month: month.month,
    year: Number(month.month.slice(0, 4)),
    monthNumber: Number(month.month.slice(5, 7)),
    openingBalance: openingBalance ?? null,
    totalCredit,
    totalDebit,
    closingBalance: closing ? Number(closing.balance_after) : (openingBalance ?? 0),
    transactions,
    openingBalancePolicyRequired: openingBalance === null
  };
};

export { appendLedgerEntry };
