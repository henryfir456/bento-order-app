import { ACTIONS, assertCan } from '../auth/permissions.js';
import { appendAuditEvent } from '../db/audit.js';
import { currentBalanceProjection, getUserById } from '../db/users.js';
import { prepareStatement, randomId, runMutationBatch, resolveClock } from '../db/transactions.js';
import { conflict, forbidden, notFound } from '../http/errors.js';
import {
  auditProtectedAdminIntervention,
  isProtectedEmployeeId
} from '../auth/protectedAccounts.js';

const INVALID_REASON = 'INVALID_EMPLOYEE_ID';
const REPAIR_ACTION = 'INVALID_EMPLOYEE_ID_REPAIR';

const assertLineAdmin = (identity) => {
  const actor = identity?.authorizationActor;
  if (identity?.viewAs
    || actor?.authMode !== 'line'
    || actor?.role !== 'Admin'
    || actor?.active !== true
    || actor?.userId !== identity?.actor?.userId) {
    throw forbidden('ADMIN_LINE_AUTH_REQUIRED');
  }
  assertCan(identity, ACTIONS.ADMIN_EMPLOYEE_BIND);
};

const userPreview = (user) => ({
  userId: user.userId,
  employeeId: user.employeeId,
  displayName: user.displayName,
  pickupFloor: user.pickupFloor,
  role: user.role,
  active: user.active,
  invalidReason: user.invalidReason,
  lineBound: Boolean(user.lineUserId),
  balance: user.balance,
  updatedAt: user.updatedAt
});

const repairAuditExists = async (database, sourceUserId) => {
  const row = await database.prepare(`
    SELECT audit_id
    FROM admin_audit_log
    WHERE target_user_id = ? AND action = ?
    LIMIT 1
  `).bind(sourceUserId, REPAIR_ACTION).first();
  return Boolean(row);
};

const readPair = async (database, sourceUserId, targetUserId) => {
  const source = await getUserById(database, sourceUserId);
  const target = await getUserById(database, targetUserId);
  if (!source) throw notFound('SOURCE_USER_NOT_FOUND');
  if (!target) throw notFound('TARGET_USER_NOT_FOUND');
  return { source, target };
};

const protectedRepairSide = (source, target) => {
  const sourceProtected = isProtectedEmployeeId(source.employeeId);
  const targetProtected = isProtectedEmployeeId(target.employeeId);
  return sourceProtected && targetProtected
    ? 'both'
    : sourceProtected
      ? 'source'
      : targetProtected
        ? 'target'
        : null;
};

const auditProtectedRepairAttempt = async (
  database,
  identity,
  side,
  { preview = false, clock = new Date() } = {}
) => {
  if (!side) return;
  await auditProtectedAdminIntervention(database, {
    actor: identity.authorizationActor,
    action: preview
      ? 'PROTECTED_ACCOUNT_IDENTITY_REPAIR_PREVIEW_BLOCKED'
      : 'PROTECTED_ACCOUNT_IDENTITY_REPAIR_DENIED',
    side,
    reason: preview
      ? 'PROTECTED_ACCOUNT_ADMIN_REPAIR_PREVIEW_BLOCKED'
      : 'PROTECTED_ACCOUNT_ADMIN_REPAIR_BLOCKED',
    clock
  });
};

const conflictsFor = async (database, source, target) => {
  const conflicts = [];
  const add = (code, applies) => { if (applies) conflicts.push(code); };
  add('SOURCE_AND_TARGET_SAME', source.userId === target.userId);
  add('SOURCE_ALREADY_INVALID', source.invalidReason === INVALID_REASON);
  add('PROTECTED_ACCOUNT_IDENTITY_REPAIR_BLOCKED', Boolean(protectedRepairSide(source, target)));
  add('SOURCE_INACTIVE', !source.active);
  add('SOURCE_ROLE_NOT_REPAIRABLE', source.role !== 'User');
  add('SOURCE_EMPLOYEE_ID_MISSING', !String(source.employeeId || '').trim());
  add('SOURCE_NAME_REQUIRED', !String(source.displayName || '').trim());
  add('TARGET_ALREADY_INVALID', target.invalidReason === INVALID_REASON);
  add('TARGET_INACTIVE', !target.active);
  add('TARGET_EMPLOYEE_ID_MISSING', !String(target.employeeId || '').trim());
  add('TARGET_NAME_REQUIRED', !String(target.displayName || '').trim());
  add('REPAIR_ALREADY_RECORDED', await repairAuditExists(database, source.userId));
  return conflicts;
};

export const getInvalidEmployeeRepairPreview = async (
  database,
  identity,
  sourceUserIdInput,
  targetUserIdInput
) => {
  assertLineAdmin(identity);
  const sourceUserId = String(sourceUserIdInput || '').trim();
  const targetUserId = String(targetUserIdInput || '').trim();
  if (!sourceUserId) throw notFound('SOURCE_USER_NOT_FOUND');
  if (!targetUserId) throw notFound('TARGET_USER_NOT_FOUND');
  const { source, target } = await readPair(database, sourceUserId, targetUserId);
  const protectedSide = protectedRepairSide(source, target);
  await auditProtectedRepairAttempt(database, identity, protectedSide, {
    preview: true
  });
  const conflicts = await conflictsFor(database, source, target);
  return {
    success: true,
    readyToRepair: conflicts.length === 0,
    conflicts,
    source: userPreview(source),
    target: userPreview(target),
    changes: {
      sourceInvalidReason: INVALID_REASON,
      sourceActive: false,
      targetDisplayName: source.displayName,
      targetLineBindingPreserved: true,
      targetRolePreserved: true,
      targetEmployeeIdPreserved: true,
      targetPickupFloorPreserved: true,
      targetOrdersAndAccountingPreserved: true,
      lineBindingTransferPerformed: false
    }
  };
};

const changesOf = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0);

export const repairInvalidEmployeeIdentity = async (
  database,
  identity,
  sourceUserIdInput,
  {
    targetUserId: targetUserIdInput,
    expectedSourceUpdatedAt,
    expectedTargetUpdatedAt,
    expectedSourceDisplayName,
    expectedSourceEmployeeId,
    expectedTargetEmployeeId,
    expectedSourceBalance,
    expectedTargetBalance,
    confirmTargetDisplayName
  } = {},
  clock = new Date()
) => {
  assertLineAdmin(identity);
  const sourceUserId = String(sourceUserIdInput || '').trim();
  const targetUserId = String(targetUserIdInput || '').trim();
  if (!sourceUserId) throw notFound('SOURCE_USER_NOT_FOUND');
  if (!targetUserId) throw notFound('TARGET_USER_NOT_FOUND');
  const { source, target } = await readPair(database, sourceUserId, targetUserId);
  const protectedSide = protectedRepairSide(source, target);
  if (protectedSide) {
    await auditProtectedRepairAttempt(database, identity, protectedSide, {
      clock
    });
    throw conflict('INVALID_EMPLOYEE_REPAIR_NOT_READY');
  }
  const conflicts = await conflictsFor(database, source, target);
  if (conflicts.length) throw conflict('INVALID_EMPLOYEE_REPAIR_NOT_READY');
  if (source.updatedAt !== expectedSourceUpdatedAt
    || target.updatedAt !== expectedTargetUpdatedAt
    || source.displayName !== expectedSourceDisplayName
    || source.employeeId !== expectedSourceEmployeeId
    || target.employeeId !== expectedTargetEmployeeId
    || Number(source.balance) !== Number(expectedSourceBalance)
    || Number(target.balance) !== Number(expectedTargetBalance)) {
    throw conflict('INVALID_EMPLOYEE_REPAIR_STALE');
  }
  if (typeof confirmTargetDisplayName !== 'string'
    || confirmTargetDisplayName !== target.displayName) {
    throw conflict('TARGET_NAME_CONFIRMATION_REQUIRED');
  }

  const occurredAt = resolveClock(clock).toISOString();
  const requestId = randomId('request');
  const sourceUpdate = prepareStatement(database, `
    UPDATE users
    SET active = 0, invalid_reason = ?, updated_at = ?
    WHERE user_id = ?
      AND active = 1
      AND role = 'User'
      AND employee_id = ?
      AND length(trim(employee_id)) > 0
      AND display_name = ?
      AND length(trim(display_name)) > 0
      AND invalid_reason IS NULL
      AND updated_at = ?
      AND ${currentBalanceProjection('users')} = ?
      AND EXISTS (
        SELECT 1 FROM users target
        WHERE target.user_id = ?
          AND target.active = 1
          AND target.invalid_reason IS NULL
          AND target.employee_id = ?
          AND target.display_name = ?
          AND target.employee_id IS NOT NULL
          AND target.updated_at = ?
          AND ${currentBalanceProjection('target')} = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM admin_audit_log prior
        WHERE prior.target_user_id = users.user_id
          AND prior.action = ?
      )
  `, [
    INVALID_REASON,
    occurredAt,
    source.userId,
    expectedSourceEmployeeId,
    expectedSourceDisplayName,
    expectedSourceUpdatedAt,
    expectedSourceBalance,
    target.userId,
    expectedTargetEmployeeId,
    confirmTargetDisplayName,
    expectedTargetUpdatedAt,
    expectedTargetBalance,
    REPAIR_ACTION
  ]);
  const targetUpdate = prepareStatement(database, `
    UPDATE users
    SET display_name = (
          SELECT source.display_name
          FROM users source
          WHERE source.user_id = ?
            AND source.active = 0
            AND source.invalid_reason = ?
            AND source.updated_at = ?
        ),
        updated_at = ?
    WHERE user_id = ?
      AND active = 1
      AND invalid_reason IS NULL
      AND employee_id = ?
      AND display_name = ?
      AND updated_at = ?
      AND ${currentBalanceProjection('users')} = ?
      AND EXISTS (
        SELECT 1 FROM users source
        WHERE source.user_id = ?
          AND source.active = 0
          AND source.invalid_reason = ?
          AND source.updated_at = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM admin_audit_log prior
        WHERE prior.target_user_id = ?
          AND prior.action = ?
      )
  `, [
    source.userId,
    INVALID_REASON,
    occurredAt,
    occurredAt,
    target.userId,
    target.employeeId,
    target.displayName,
    expectedTargetUpdatedAt,
    expectedTargetBalance,
    source.userId,
    INVALID_REASON,
    occurredAt,
    source.userId,
    REPAIR_ACTION
  ]);
  const audit = prepareStatement(database, `
    INSERT INTO admin_audit_log (
      audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
      actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
      target_line_user_id_snapshot, action, metadata_json, occurred_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, json_object(
        'reason', ?,
        'requestId', ?,
        'repairedTargetUserId', ?,
        'sourceDisplayNameSnapshot', source.display_name,
        'sourceBalanceSnapshot', ${currentBalanceProjection('source')},
        'targetOriginalDisplayNameSnapshot', ?,
        'targetDisplayNameAfter', target.display_name,
        'targetEmployeeIdSnapshot', target.employee_id,
        'targetRoleSnapshot', target.role,
        'targetPickupFloorSnapshot', target.pickup_floor,
        'targetLineBoundSnapshot', target.line_user_id IS NOT NULL,
        'targetBalanceSnapshot', ${currentBalanceProjection('target')},
        'targetNameSynchronized', 1,
        'lineBindingTransferred', 0
      ), ?
    FROM users source
    JOIN users target ON target.user_id = ?
    WHERE source.user_id = ? AND changes() = 1
  `, [
    randomId('audit'),
    identity.authorizationActor.userId,
    identity.authorizationActor.authMode,
    identity.authorizationActor.employeeId,
    identity.authorizationActor.lineUserId,
    source.userId,
    source.employeeId,
    source.lineUserId,
    REPAIR_ACTION,
    INVALID_REASON,
    requestId,
    target.userId,
    target.displayName,
    occurredAt,
    target.userId,
    source.userId
  ]);

  const results = await runMutationBatch(database, [sourceUpdate, targetUpdate, audit]);
  if (results.length !== 3 || results.some((result) => changesOf(result) !== 1)) {
    throw conflict('INVALID_EMPLOYEE_REPAIR_STALE');
  }
  const updatedSource = await getUserById(database, source.userId);
  const updatedTarget = await getUserById(database, target.userId);
  if (updatedSource?.invalidReason !== INVALID_REASON
    || updatedSource.active
    || updatedTarget?.displayName !== source.displayName) {
    throw conflict('INVALID_EMPLOYEE_REPAIR_READBACK_FAILED');
  }
  return {
    success: true,
    source: userPreview(updatedSource),
    target: userPreview(updatedTarget),
    requestId,
    auditRecorded: true
  };
};

export const listInvalidEmployeeRepairs = async (
  database,
  identity,
  now = new Date()
) => {
  assertLineAdmin(identity);
  await appendAuditEvent(database, {
    actorUserId: identity.authorizationActor.userId,
    actorAuthMode: identity.authorizationActor.authMode,
    actorEmployeeIdSnapshot: identity.authorizationActor.employeeId,
    actorLineUserIdSnapshot: identity.authorizationActor.lineUserId,
    action: 'INVALID_EMPLOYEE_REPAIR_AUDIT_READ',
    metadata: { limit: 100 },
    occurredAt: resolveClock(now).toISOString()
  });
  const result = await database.prepare(`
    SELECT repair.audit_id,
           json_extract(repair.metadata_json, '$.requestId') AS request_id,
           repair.target_user_id AS source_user_id,
           repair.target_employee_id_snapshot AS source_employee_id,
           COALESCE(
             json_extract(repair.metadata_json, '$.sourceDisplayNameSnapshot'),
             source.display_name
           ) AS source_display_name,
           json_extract(repair.metadata_json, '$.sourceBalanceSnapshot') AS source_balance,
           source.active AS source_active,
           source.invalid_reason AS source_invalid_reason,
           json_extract(repair.metadata_json, '$.repairedTargetUserId') AS target_user_id,
           COALESCE(json_extract(repair.metadata_json, '$.targetEmployeeIdSnapshot'), target.employee_id) AS target_employee_id,
           COALESCE(json_extract(repair.metadata_json, '$.targetOriginalDisplayNameSnapshot'), target.display_name) AS target_original_display_name,
           COALESCE(json_extract(repair.metadata_json, '$.targetDisplayNameAfter'), target.display_name) AS target_display_name,
           COALESCE(json_extract(repair.metadata_json, '$.targetRoleSnapshot'), target.role) AS target_role,
           COALESCE(json_extract(repair.metadata_json, '$.targetPickupFloorSnapshot'), target.pickup_floor) AS target_pickup_floor,
           COALESCE(json_extract(repair.metadata_json, '$.targetLineBoundSnapshot'), target.line_user_id IS NOT NULL) AS target_line_bound,
           json_extract(repair.metadata_json, '$.targetBalanceSnapshot') AS target_balance,
           repair.actor_user_id, repair.occurred_at
    FROM admin_audit_log repair
    LEFT JOIN users source ON source.user_id = repair.target_user_id
    LEFT JOIN users target
      ON target.user_id = json_extract(repair.metadata_json, '$.repairedTargetUserId')
    WHERE repair.action = ?
    ORDER BY repair.occurred_at DESC, repair.audit_id DESC
    LIMIT 100
  `).bind(REPAIR_ACTION).all();
  const entries = Array.isArray(result?.results) ? result.results : [];
  return {
    success: true,
    repairs: entries.map((row) => ({
      auditId: row.audit_id,
      requestId: row.request_id,
      sourceUserId: row.source_user_id,
      sourceEmployeeId: row.source_employee_id,
      sourceDisplayName: row.source_display_name,
      sourceBalance: row.source_balance === null || row.source_balance === undefined
        ? null
        : Number(row.source_balance),
      sourceActive: Boolean(row.source_active),
      sourceInvalidReason: row.source_invalid_reason,
      targetUserId: row.target_user_id,
      targetEmployeeId: row.target_employee_id,
      targetOriginalDisplayName: row.target_original_display_name,
      targetDisplayName: row.target_display_name,
      targetRole: row.target_role,
      targetPickupFloor: row.target_pickup_floor,
      targetLineBound: Boolean(row.target_line_bound),
      targetBalance: row.target_balance === null || row.target_balance === undefined
        ? null
        : Number(row.target_balance),
      actorUserId: row.actor_user_id,
      occurredAt: row.occurred_at
    }))
  };
};
