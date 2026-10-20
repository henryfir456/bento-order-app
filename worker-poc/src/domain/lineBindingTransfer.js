import { ACTIONS, assertCan, isRegisteredLinePrincipal } from '../auth/permissions.js';
import { isProtectedEmployeeId, recordProtectedAccountDenial } from '../auth/protectedAccounts.js';
import { appendAuditEvent } from '../db/audit.js';
import { getUserByEmployeeId, getUserById, getUserByLineId } from '../db/users.js';
import { conflict, forbidden, notFound } from '../http/errors.js';
import { prepareStatement, randomId, resolveClock, runMutationBatch } from '../db/transactions.js';
import { employeeIdText } from './employeeVerification.js';

const count = (value) => Number(value || 0);

const lineBindingLabel = (lineUserId) => {
  const value = String(lineUserId || '');
  if (!value) return { bound: false, masked: null };
  return {
    bound: true,
    masked: `${'*'.repeat(Math.max(4, Math.min(8, value.length - 4)))}${value.slice(-4)}`
  };
};

const assertLineTransferAdmin = (identity) => {
  const actor = identity?.authorizationActor;
  if (identity?.viewAs
    || !actor
    || actor.role !== 'Admin'
    || actor.authMode !== 'line'
    || !isRegisteredLinePrincipal(actor)) {
    throw forbidden('ADMIN_LINE_AUTH_REQUIRED');
  }
  assertCan(identity, ACTIONS.ADMIN_LINE_BINDING_TRANSFER);
  return actor;
};

const readRelations = async (database, user, now) => {
  const row = await database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM orders WHERE user_id = ?) AS order_count,
      (SELECT COUNT(*) FROM balance_ledger WHERE user_id = ?) AS transaction_count,
      (SELECT COUNT(*) FROM likes WHERE user_id = ?) AS like_count,
      (SELECT COUNT(*) FROM opening_balance_snapshots WHERE user_id = ?) AS opening_balance_count,
      (SELECT COUNT(*) FROM idempotency_keys WHERE actor_user_id = ?) AS idempotency_count,
      (SELECT COUNT(*) FROM employee_guest_sessions
        WHERE revoked_at IS NULL AND expires_at > ?
          AND (user_id = ? OR (
            user_id IS NULL
            AND UPPER(trim(employee_id)) = UPPER(trim(?))
          ))) AS active_session_count
  `).bind(
    user.userId,
    user.userId,
    user.userId,
    user.userId,
    user.userId,
    now,
    user.userId,
    user.employeeId || ''
  ).first();
  return {
    orderCount: count(row?.order_count),
    transactionCount: count(row?.transaction_count),
    likeCount: count(row?.like_count),
    openingBalanceCount: count(row?.opening_balance_count),
    idempotencyCount: count(row?.idempotency_count),
    activeSessionCount: count(row?.active_session_count),
    balance: Number(user.balance || 0)
  };
};

const digestFingerprint = async (source, target) => {
  const value = [
    source.userId,
    source.employeeId || '',
    source.lineUserId || '',
    source.updatedAt || '',
    target.userId,
    target.employeeId || '',
    target.updatedAt || ''
  ].join('\u0000');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const makeMemberSummary = (user, relations) => ({
  userId: user.userId,
  employeeId: user.employeeId,
  displayName: user.displayName,
  pickupFloor: user.pickupFloor,
  role: user.role,
  active: user.active,
  lineBinding: lineBindingLabel(user.lineUserId),
  relatedData: relations
});

const inspectTransfer = async (database, sourceUserId, employeeIdInput, now) => {
  const sourceId = String(sourceUserId || '').trim();
  if (!sourceId) throw notFound('USER_NOT_FOUND');
  const employeeId = employeeIdText(employeeIdInput);
  const source = await getUserById(database, sourceId);
  if (!source) throw notFound('USER_NOT_FOUND');
  const target = await getUserByEmployeeId(database, employeeId);
  if (!target) throw notFound('TRANSFER_TARGET_NOT_FOUND');

  const [sourceRelations, targetRelations] = await Promise.all([
    readRelations(database, source, now),
    readRelations(database, target, now)
  ]);
  const conflicts = [];
  const addConflict = (code, shouldAdd) => { if (shouldAdd) conflicts.push(code); };
  const protectedAccountTransfer = isProtectedEmployeeId(source.employeeId)
    || isProtectedEmployeeId(target.employeeId);

  addConflict('SOURCE_AND_TARGET_SAME', source.userId === target.userId);
  addConflict('PROTECTED_ACCOUNT_LINE_BINDING_IMMUTABLE', protectedAccountTransfer);
  addConflict('SOURCE_INVALID_EMPLOYEE_ID', source.invalidReason === 'INVALID_EMPLOYEE_ID');
  addConflict('TARGET_INVALID_EMPLOYEE_ID', target.invalidReason === 'INVALID_EMPLOYEE_ID');
  addConflict('SOURCE_INACTIVE', !source.active);
  addConflict('TARGET_INACTIVE', !target.active);
  addConflict('SOURCE_EMPLOYEE_ID_MISSING', !String(source.employeeId || '').trim());
  addConflict('SOURCE_LINE_NOT_BOUND', !source.lineUserId);
  addConflict('TARGET_LINE_ALREADY_BOUND', Boolean(target.lineUserId));
  addConflict('SOURCE_HAS_ORDERS', sourceRelations.orderCount > 0);
  addConflict('SOURCE_HAS_TRANSACTIONS', sourceRelations.transactionCount > 0);
  addConflict('SOURCE_BALANCE_NON_ZERO', sourceRelations.balance !== 0);
  addConflict('SOURCE_HAS_LIKES', sourceRelations.likeCount > 0);
  addConflict('SOURCE_HAS_OPENING_BALANCE', sourceRelations.openingBalanceCount > 0);
  addConflict('SOURCE_HAS_IDEMPOTENCY_RECORDS', sourceRelations.idempotencyCount > 0);

  if (source.lineUserId) {
    const owner = await getUserByLineId(database, source.lineUserId);
    addConflict('LINE_ALREADY_BOUND', Boolean(owner && owner.userId !== source.userId));
  }

  const checks = {
    sourceExists: true,
    targetExists: true,
    sourceActive: source.active,
    targetActive: target.active,
    sourceLineBound: Boolean(source.lineUserId),
    targetLineUnbound: !target.lineUserId,
    sourceHasNoOrders: sourceRelations.orderCount === 0,
    sourceHasNoTransactions: sourceRelations.transactionCount === 0,
    sourceBalanceIsZero: sourceRelations.balance === 0,
    sourceHasNoOtherData: sourceRelations.likeCount === 0
      && sourceRelations.openingBalanceCount === 0
      && sourceRelations.idempotencyCount === 0
  };

  return {
    source,
    target,
    sourceRelations,
    targetRelations,
    conflicts,
    protectedAccountTransfer,
    checks,
    previewFingerprint: await digestFingerprint(source, target)
  };
};

const auditProtectedTransferAttempt = async (
  database,
  actor,
  inspection,
  { action, occurredAt }
) => {
  const protectedTarget = isProtectedEmployeeId(inspection.source.employeeId)
    ? inspection.source
    : inspection.target;
  await appendAuditEvent(database, {
    actorUserId: actor.userId,
    actorAuthMode: actor.authMode,
    actorEmployeeIdSnapshot: null,
    actorLineUserIdSnapshot: null,
    targetUserId: protectedTarget.userId,
    targetEmployeeIdSnapshot: null,
    targetLineUserIdSnapshot: null,
    action,
    metadata: {
      protectedSide: protectedTarget.userId === inspection.source.userId ? 'source' : 'target',
      reason: 'PROTECTED_ACCOUNT_LINE_BINDING_IMMUTABLE'
    },
    occurredAt
  });
};

const publicPreview = (inspection) => ({
  readyToTransfer: inspection.conflicts.length === 0,
  source: makeMemberSummary(inspection.source, inspection.sourceRelations),
  target: makeMemberSummary(inspection.target, inspection.targetRelations),
  checks: inspection.checks,
  conflicts: inspection.conflicts,
  previewFingerprint: inspection.previewFingerprint,
  sourceSessionsToRevoke: inspection.sourceRelations.activeSessionCount
});

export const getLineBindingTransferPreview = async (
  database,
  identity,
  sourceUserId,
  employeeIdInput,
  clock = new Date()
) => {
  const actor = assertLineTransferAdmin(identity);
  const timestamp = resolveClock(clock).toISOString();
  const inspection = await inspectTransfer(database, sourceUserId, employeeIdInput, timestamp);
  if (inspection.protectedAccountTransfer) {
    await auditProtectedTransferAttempt(database, actor, inspection, {
      action: 'PROTECTED_ACCOUNT_LINE_BINDING_TRANSFER_PREVIEW',
      occurredAt: timestamp
    });
  }
  return publicPreview(inspection);
};

const statementChanges = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0);

const transferStatements = ({ database, actor, source, target, timestamp, requestId }) => {
  const sourceUpdate = prepareStatement(database, `
    UPDATE users
    SET line_user_id = NULL, updated_at = ?
    WHERE user_id = ?
      AND employee_id = ?
      AND line_user_id = ?
      AND active = 1
      AND invalid_reason IS NULL
      AND COALESCE((
        SELECT bl.balance_after
        FROM balance_ledger bl
        JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
        WHERE bl.user_id = users.user_id
        ORDER BY bls.sequence_number DESC
        LIMIT 1
      ), users.balance) = 0
      AND NOT EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.user_id)
      AND NOT EXISTS (SELECT 1 FROM balance_ledger WHERE balance_ledger.user_id = users.user_id)
      AND NOT EXISTS (SELECT 1 FROM likes WHERE likes.user_id = users.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM opening_balance_snapshots
        WHERE opening_balance_snapshots.user_id = users.user_id
      )
      AND NOT EXISTS (SELECT 1 FROM idempotency_keys WHERE idempotency_keys.actor_user_id = users.user_id)
      AND EXISTS (
        SELECT 1 FROM users AS target_user
        WHERE target_user.user_id = ?
          AND UPPER(trim(target_user.employee_id)) = UPPER(trim(?))
          AND target_user.active = 1
          AND target_user.invalid_reason IS NULL
          AND target_user.line_user_id IS NULL
      )
  `, [timestamp, source.userId, source.employeeId, source.lineUserId, target.userId, target.employeeId]);

  const targetUpdate = prepareStatement(database, `
    UPDATE users
    SET line_user_id = ?, updated_at = ?
    WHERE user_id = ?
      AND UPPER(trim(employee_id)) = UPPER(trim(?))
      AND active = 1
      AND invalid_reason IS NULL
      AND line_user_id IS NULL
      AND changes() = 1
  `, [source.lineUserId, timestamp, target.userId, target.employeeId]);

  const audit = prepareStatement(database, `
    INSERT INTO admin_audit_log (
      audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
      actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
      target_line_user_id_snapshot, action, metadata_json, occurred_at
    ) VALUES (?, ?, 'line', ?, NULL, ?, ?, NULL,
      CASE WHEN changes() = 1 THEN 'LINE_BINDING_TRANSFER' ELSE NULL END, ?, ?)
  `, [
    randomId('audit'),
    actor.userId,
    actor.employeeId || null,
    target.userId,
    target.employeeId,
    JSON.stringify({
      sourceUserId: source.userId,
      sourceEmployeeId: source.employeeId,
      targetUserId: target.userId,
      targetEmployeeId: target.employeeId,
      lineBindingMasked: lineBindingLabel(source.lineUserId).masked,
      result: 'SUCCESS',
      requestId
    }),
    timestamp
  ]);

  const revokeSourceSessions = prepareStatement(database, `
    UPDATE employee_guest_sessions
    SET revoked_at = ?, revoked_reason = 'admin_revoke'
    WHERE revoked_at IS NULL AND expires_at > ?
      AND (user_id = ? OR (
        user_id IS NULL
        AND UPPER(trim(employee_id)) = UPPER(trim(?))
      ))
  `, [timestamp, timestamp, source.userId, source.employeeId]);

  return [sourceUpdate, targetUpdate, audit, revokeSourceSessions];
};

export const transferLineBinding = async (
  database,
  identity,
  sourceUserId,
  { employeeId: employeeIdInput, previewFingerprint } = {},
  clock = new Date()
) => {
  const actor = assertLineTransferAdmin(identity);
  const timestamp = resolveClock(clock).toISOString();
  const inspection = await inspectTransfer(database, sourceUserId, employeeIdInput, timestamp);
  if (inspection.protectedAccountTransfer) {
    await auditProtectedTransferAttempt(database, actor, inspection, {
      action: 'PROTECTED_ACCOUNT_LINE_BINDING_TRANSFER_DENIED',
      occurredAt: timestamp
    });
    await recordProtectedAccountDenial(database, {
      authMode: 'line',
      reason: 'PROTECTED_ACCOUNT_ADMIN_TRANSFER_BLOCKED',
      clock: timestamp
    });
    throw conflict('PROTECTED_ACCOUNT_LINE_BINDING_IMMUTABLE');
  }
  if (inspection.conflicts.length) throw conflict(inspection.conflicts[0]);
  if (typeof previewFingerprint !== 'string'
    || previewFingerprint !== inspection.previewFingerprint) {
    throw conflict('LINE_BINDING_TRANSFER_STALE');
  }

  const requestId = randomId('request');
  try {
    const results = await runMutationBatch(database, transferStatements({
      database,
      actor,
      source: inspection.source,
      target: inspection.target,
      timestamp,
      requestId
    }));
    const sourceChanges = statementChanges(results[0]);
    const targetChanges = statementChanges(results[1]);
    if (sourceChanges !== 1 || targetChanges !== 1) {
      throw conflict('LINE_BINDING_TRANSFER_RACE');
    }
    return {
      success: true,
      requestId,
      sourceUserId: inspection.source.userId,
      sourceEmployeeId: inspection.source.employeeId,
      targetUserId: inspection.target.userId,
      targetEmployeeId: inspection.target.employeeId,
      sourceSessionsRevoked: statementChanges(results[3])
    };
  } catch (error) {
    if (error?.status) throw error;
    const current = await inspectTransfer(database, sourceUserId, employeeIdInput, timestamp);
    if (current.conflicts.length) throw conflict(current.conflicts[0]);
    if (/unique|constraint/i.test(error?.cause?.message || error?.message || '')) {
      throw conflict('LINE_BINDING_TRANSFER_RACE');
    }
    throw error;
  }
};
