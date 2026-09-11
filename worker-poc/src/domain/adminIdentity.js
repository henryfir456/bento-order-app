import { ACTIONS, assertCan, isVerifiedPrincipal } from '../auth/permissions.js';
import { auditStatement, appendAuditEvent } from '../db/audit.js';
import { getUserByEmployeeId, getUserById, publicUser } from '../db/users.js';
import { conflict, forbidden, notFound } from '../http/errors.js';
import { prepareStatement, resolveClock, runMutationBatch } from '../db/transactions.js';
import {
  employeeIdText,
  sameEmployeeId,
  resolveEmployeeVerification,
  VERIFICATION_DECISIONS
} from './employeeVerification.js';

const statementChanges = (result) => Number(
  result?.meta?.changes ?? result?.changes ?? 0
);

const digestEmployeeId = async (employeeId) => {
  const bytes = new TextEncoder().encode(employeeId);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

const auditInput = ({
  identity,
  target,
  employeeIdDigest,
  decision,
  result,
  occurredAt,
  onlyIfPriorMutation = false
}) => ({
  actorUserId: identity.authorizationActor.userId,
  actorAuthMode: identity.authorizationActor.authMode,
  actorEmployeeIdSnapshot: identity.authorizationActor.employeeId,
  actorLineUserIdSnapshot: identity.authorizationActor.lineUserId,
  targetUserId: target.userId,
  targetEmployeeIdSnapshot: target.employeeId,
  targetLineUserIdSnapshot: target.lineUserId,
  action: 'ADMIN_EMPLOYEE_BIND',
  metadata: {
    submittedEmployeeIdDigest: employeeIdDigest,
    verificationDecision: decision.decision,
    verificationReason: decision.reason,
    verificationStatus: decision.verificationStatus,
    result
  },
  occurredAt,
  onlyIfPriorMutation
});

const alreadyBound = async (database, identity, target, employeeIdDigest, now) => {
  const decision = {
    decision: VERIFICATION_DECISIONS.NO_CHANGE,
    reason: 'ALREADY_BOUND',
    verificationStatus: target.verificationStatus
  };
  await appendAuditEvent(database, auditInput({
    identity,
    target,
    employeeIdDigest,
    decision,
    result: 'ALREADY_BOUND',
    occurredAt: now
  }));
  return {
    success: true,
    status: 'ALREADY_BOUND',
    verificationDecision: decision.decision,
    verificationStatus: target.verificationStatus,
    identityState: publicUser(target).identityState,
    user: publicUser(target)
  };
};

export const adminBindEmployee = async (
  database,
  identity,
  targetUserId,
  { employeeId: employeeIdInput } = {},
  clock = new Date()
) => {
  assertCan(identity, ACTIONS.ADMIN_EMPLOYEE_BIND);
  const actor = identity?.authorizationActor;
  if (!isVerifiedPrincipal(actor) || actor.authMode !== 'line') {
    throw forbidden('ADMIN_LINE_AUTH_REQUIRED');
  }

  const targetId = String(targetUserId || '').trim();
  if (!targetId) throw notFound('USER_NOT_FOUND');
  const employeeId = employeeIdText(employeeIdInput);
  const timestamp = resolveClock(clock).toISOString();
  const target = await getUserById(database, targetId);
  if (!target) throw notFound('USER_NOT_FOUND');
  if (!target.active) throw conflict('EMPLOYEE_INACTIVE');
  const employeeIdDigest = await digestEmployeeId(employeeId);

  if (target.employeeId) {
    if (sameEmployeeId(target.employeeId, employeeId)) {
      return alreadyBound(database, identity, target, employeeIdDigest, timestamp);
    }
    throw conflict('USER_EMPLOYEE_ALREADY_BOUND');
  }

  const owner = await getUserByEmployeeId(database, employeeId);
  if (owner && owner.userId !== target.userId) {
    throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
  }
  const decision = await resolveEmployeeVerification(database, employeeId);
  const update = prepareStatement(database, `
    UPDATE users
    SET employee_id = ?, verification_status = ?, updated_at = ?
    WHERE user_id = ? AND employee_id IS NULL AND active = 1
  `, [employeeId, decision.verificationStatus, timestamp, target.userId]);
  const audit = auditStatement(database, auditInput({
    identity,
    target,
    employeeIdDigest,
    decision,
    result: 'BOUND',
    occurredAt: timestamp,
    onlyIfPriorMutation: true
  }));

  try {
    const [updateResult] = await runMutationBatch(database, [update, audit]);
    if (statementChanges(updateResult) !== 1) {
      const replay = await getUserById(database, target.userId);
      if (sameEmployeeId(replay?.employeeId, employeeId)) {
        return alreadyBound(database, identity, replay, employeeIdDigest, timestamp);
      }
      const conflicting = await getUserByEmployeeId(database, employeeId);
      if (conflicting && conflicting.userId !== target.userId) {
        throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
      }
      throw conflict('EMPLOYEE_BIND_CONFLICT');
    }
  } catch (error) {
    if (error?.status === 409) throw error;
    if (/unique|constraint/i.test(error?.message || error?.cause?.message || '')) {
      const conflicting = await getUserByEmployeeId(database, employeeId);
      if (conflicting?.userId === target.userId) {
        return alreadyBound(database, identity, conflicting, employeeIdDigest, timestamp);
      }
      throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
    }
    throw error;
  }

  const bound = await getUserById(database, target.userId);
  if (!bound || !sameEmployeeId(bound.employeeId, employeeId)) throw conflict('EMPLOYEE_BIND_CONFLICT');
  return {
    success: true,
    status: 'BOUND',
    verificationDecision: decision.decision,
    verificationStatus: bound.verificationStatus,
    identityState: publicUser(bound).identityState,
    user: publicUser(bound)
  };
};
