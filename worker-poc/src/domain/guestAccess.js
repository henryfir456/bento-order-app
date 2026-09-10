import { conflict, forbidden, notFound, unauthorized, badRequest } from '../http/errors.js';
import { getUserByEmployeeId, getUserById, getUserByLineId, publicUser } from '../db/users.js';
import { createGuestSession, inspectGuestSession } from '../auth/guestSession.js';
import { capabilitiesFor } from '../auth/permissions.js';
import { prepareStatement, resolveClock } from '../db/transactions.js';

const employeeIdText = (value) => {
  if (typeof value !== 'string') throw badRequest('INVALID_EMPLOYEE_ID');
  const employeeId = value.trim();
  if (!employeeId || employeeId.length > 100 || /[\u0000-\u001f\u007f]/.test(employeeId)) {
    throw badRequest('INVALID_EMPLOYEE_ID');
  }
  return employeeId;
};

const lineIdText = (value) => {
  const lineUserId = typeof value === 'string' ? value.trim() : '';
  if (!lineUserId || lineUserId.length > 200) throw badRequest('LINE_BIND_PROFILE_INVALID');
  return lineUserId;
};

const statementChanges = (result) => Number(
  result?.meta?.changes ?? result?.changes ?? 0
);

export const employeeGuestLogin = async (
  database,
  employeeIdInput,
  clock = new Date()
) => {
  const employeeId = employeeIdText(employeeIdInput);
  const user = await getUserByEmployeeId(database, employeeId);
  if (!user) throw notFound('EMPLOYEE_NOT_FOUND');
  if (!user.active) throw forbidden('EMPLOYEE_INACTIVE');
  if (user.lineUserId) throw conflict('EMPLOYEE_ALREADY_LINE_BOUND');
  const session = await createGuestSession(database, {
    userId: user.userId,
    clock
  });
  return {
    success: true,
    authMode: 'employee_guest',
    token: session.token,
    expiresAt: session.expiresAt,
    capabilities: capabilitiesFor(user.role, 'employee_guest'),
    user: publicUser(user)
  };
};

export const bindLineIdentity = async (
  database,
  {
    guestToken,
    lineUserId,
    lineDisplayName = '',
    clock = new Date()
  } = {}
) => {
  if (typeof guestToken !== 'string' || !guestToken.trim()) {
    throw unauthorized('GUEST_SESSION_INVALID');
  }
  const verifiedLineUserId = lineIdText(lineUserId);
  const now = resolveClock(clock).toISOString();
  const inspected = await inspectGuestSession(database, guestToken, {
    now,
    allowRevokedLineBindReplay: true
  });
  if (!inspected) throw unauthorized('GUEST_SESSION_INVALID');

  const existingLineUser = await getUserByLineId(database, verifiedLineUserId);
  if (inspected.replay) {
    if (inspected.user.lineUserId === verifiedLineUserId) {
      return {
        success: true,
        status: 'ALREADY_BOUND',
        authMode: 'line',
        user: publicUser(inspected.user)
      };
    }
    throw conflict('EMPLOYEE_ALREADY_LINE_BOUND');
  }
  if (!inspected.normal) {
    throw unauthorized('GUEST_SESSION_INVALID');
  }
  if (existingLineUser && existingLineUser.userId !== inspected.user.userId) {
    throw conflict('LINE_ALREADY_BOUND');
  }

  const update = prepareStatement(database, `
    UPDATE users
    SET line_user_id = ?, updated_at = ?
    WHERE user_id = ? AND active = 1 AND line_user_id IS NULL
  `, [verifiedLineUserId, now, inspected.user.userId]);
  const revoke = prepareStatement(database, `
    UPDATE employee_guest_sessions
    SET revoked_at = ?, revoked_reason = 'line_bound'
    WHERE user_id = ?
      AND revoked_at IS NULL
      AND changes() = 1
      AND EXISTS (
        SELECT 1 FROM users
        WHERE user_id = ? AND line_user_id = ?
      )
  `, [now, inspected.user.userId, inspected.user.userId, verifiedLineUserId]);
  try {
    const [updateResult] = await database.batch([update, revoke]);
    const updateCount = statementChanges(updateResult);
    const user = await getUserById(database, inspected.user.userId);
    if (!user) throw new Error('LINE binding readback failed.');
    if (user.lineUserId !== verifiedLineUserId) {
      throw conflict('LINE_BIND_CONFLICT');
    }
    return {
      success: true,
      status: updateCount === 1 ? 'BOUND' : 'ALREADY_BOUND',
      authMode: 'line',
      lineDisplayName,
      user: publicUser(user)
    };
  } catch (error) {
    if (/unique|constraint/i.test(error?.message || error?.cause?.message || '')) {
      const conflicting = await getUserByLineId(database, verifiedLineUserId);
      if (conflicting && conflicting.userId !== inspected.user.userId) {
        throw conflict('LINE_ALREADY_BOUND');
      }
      throw conflict('LINE_BIND_CONFLICT');
    }
    throw error;
  }
};

export { employeeIdText };
