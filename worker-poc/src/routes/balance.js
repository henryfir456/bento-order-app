import { ACTIONS, assertCan } from '../auth/permissions.js';
import {
  balanceMutationResponseSpec,
  hashRequest,
  readExistingIdempotencyResult,
  requireIdempotencyKey,
  runIdempotentMutation
} from '../db/idempotency.js';
import { auditStatement } from '../db/audit.js';
import { ledgerMutationStatements } from '../db/ledgerQueries.js';
import { randomId, resolveClock } from '../db/transactions.js';
import { getBalanceHistory } from '../domain/ledger.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { requireIdentity } from '../http/authMiddleware.js';
import {
  getUserByEmployeeId,
  getUserById,
  getUserByLineId
} from '../db/users.js';

const TOP_UP_OPERATION = 'ADMIN_BALANCE_TOP_UP';

const readJson = async (request) => {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body');
    return value;
  } catch {
    throw badRequest('INVALID_JSON');
  }
};

const idempotencyKey = (request, body) => (
  request.headers.get('Idempotency-Key')?.trim()
  || body.idempotencyKey
  || body.idempotency_key
  || ''
);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const positiveInteger = (value) => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
};

const actorForTopUp = (identity) => {
  assertCan(identity, ACTIONS.ADMIN_TOP_UP);
  return identity.actor;
};

export const topUpBalance = async (database, identity, input, clock = new Date()) => {
  const actor = actorForTopUp(identity);
  const targetUserInput = text(
    input?.targetUserId
    || input?.userId
    || input?.targetEmployeeId
    || input?.targetLineUserId
  );
  const amount = positiveInteger(input?.amount);
  const note = text(input?.note) || 'Admin manual top-up';
  if (!targetUserInput) throw badRequest('TOP_UP_TARGET_REQUIRED');
  if (amount === null) throw badRequest('TOP_UP_AMOUNT_INVALID');
  if (note.length > 2000) throw badRequest('TOP_UP_NOTE_TOO_LONG');
  const idempotency = requireIdempotencyKey(input?.idempotencyKey);
  const target = input?.targetEmployeeId
    ? await getUserByEmployeeId(database, targetUserInput)
    : input?.targetLineUserId
      ? await getUserByLineId(database, targetUserInput)
      : await getUserById(database, targetUserInput);
  if (!target) throw notFound('TOP_UP_TARGET_NOT_FOUND');
  const targetUserId = target.userId;
  const requestHash = await hashRequest({ targetUserId, amount, note });
  const existing = await readExistingIdempotencyResult(database, {
    actorUserId: actor.userId,
    operation: TOP_UP_OPERATION,
    idempotencyKey: idempotency,
    requestHash
  });
  if (existing) return existing;

  const now = resolveClock(clock).toISOString();
  const transactionId = randomId('txn');
  const auditId = randomId('audit');
  const details = {
    actorUserId: actor.userId,
    operation: TOP_UP_OPERATION,
    idempotencyKey: idempotency,
    requestHash,
    claimToken: randomId('claim'),
    occurredAt: now
  };

  try {
    return await runIdempotentMutation(database, {
      ...details,
      responseSpec: balanceMutationResponseSpec({
        message: 'BALANCE_TOPPED_UP',
        targetUserId,
        balanceUserId: targetUserId,
        transactionId
      }),
      buildStatements: ({ guard }) => {
        const audit = auditStatement(database, {
          auditId,
          actorUserId: actor.userId,
          actorAuthMode: actor.authMode,
          actorEmployeeIdSnapshot: actor.employeeId,
          actorLineUserIdSnapshot: actor.lineUserId,
          targetUserId,
          targetEmployeeIdSnapshot: target.employeeId,
          targetLineUserIdSnapshot: target.lineUserId,
          action: 'BALANCE_TOP_UP',
          metadata: { amount, note, transactionId },
          occurredAt: now
        });
        const ledger = ledgerMutationStatements(database, {
          transactionId,
          userId: targetUserId,
          employeeIdSnapshot: target.employeeId,
          lineUserIdSnapshot: target.lineUserId,
          displayNameSnapshot: target.displayName,
          amount,
          balanceAfter: target.balance + amount,
          type: 'TOPUP',
          referenceId: auditId,
          operatorUserId: actor.userId,
          operatorEmployeeIdSnapshot: actor.employeeId,
          operatorLineUserIdSnapshot: actor.lineUserId,
          operatorDisplayNameSnapshot: actor.displayName,
          operatorAuthMode: actor.authMode,
          authMode: actor.authMode,
          note,
          occurredAt: now
        }, { guard, dynamicBalanceAfter: true });
        return [audit, ...ledger.statements];
      }
    });
  } catch (error) {
    if (error?.code === 'TRANSACTION_FAILED') throw conflict('MUTATION_CONFLICT');
    throw error;
  }
};

export const handleBalanceRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now = new Date()
} = {}) => {
  const url = new URL(request.url);
  const isHistory = request.method === 'GET' && url.pathname === '/api/me/balance/history';
  const isTopUp = request.method === 'POST' && url.pathname === '/api/admin/balances/top-up';
  if (!isHistory && !isTopUp) return null;

  const identity = await requireIdentity(request, env, {
    fetchImpl,
    allowViewAs: isHistory,
    now
  });
  if (isHistory) {
    const month = url.searchParams.get('month') || '';
    return jsonResponse(await getBalanceHistory(
      env.DB,
      identity.effectiveSubject.userId,
      month
    ));
  }
  const body = await readJson(request);
  return jsonResponse(await topUpBalance(env.DB, identity, {
    ...body,
    idempotencyKey: idempotencyKey(request, body)
  }, now));
};

export { TOP_UP_OPERATION };
