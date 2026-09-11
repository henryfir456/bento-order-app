import { conflict, forbidden, unauthorized, badRequest } from '../http/errors.js';
import { getUserByEmployeeId, getUserById, getUserByLineId, publicUser } from '../db/users.js';
import { createGuestSession, inspectGuestSession } from '../auth/guestSession.js';
import { capabilitiesFor, VERIFICATION_STATUSES } from '../auth/permissions.js';
import { prepareStatement, randomId, resolveClock } from '../db/transactions.js';
import { VALID_PICKUP_FLOORS } from './users.js';

const employeeIdText = (value) => {
  if (typeof value !== 'string') throw badRequest('INVALID_EMPLOYEE_ID');
  const employeeId = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(employeeId)) {
    throw badRequest('INVALID_EMPLOYEE_ID');
  }
  return employeeId;
};

const lineIdText = (value) => {
  const lineUserId = typeof value === 'string' ? value.trim() : '';
  if (!lineUserId || lineUserId.length > 200) throw badRequest('LINE_BIND_PROFILE_INVALID');
  return lineUserId;
};

const profileText = (value, fallback = '') => {
  const text = typeof value === 'string' ? value.trim() : fallback;
  const hasControlCharacter = [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!text || text.length > 100 || hasControlCharacter) {
    throw badRequest('PROFILE_INVALID');
  }
  return text;
};

const pickupFloorText = (value) => {
  if (!VALID_PICKUP_FLOORS.includes(value)) throw badRequest('INVALID_PICKUP_FLOOR');
  return value;
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
  if (!user) {
    const session = await createGuestSession(database, {
      employeeId,
      status: 'UNVERIFIED_EMPLOYEE',
      clock
    });
    return {
      success: true,
      status: 'UNVERIFIED_EMPLOYEE',
      verificationStatus: VERIFICATION_STATUSES.UNVERIFIED,
      authMode: 'employee_guest',
      token: session.token,
      expiresAt: session.expiresAt,
      capabilities: capabilitiesFor(
        null,
        'employee_guest',
        VERIFICATION_STATUSES.UNVERIFIED
      ),
      employeeId,
      user: null
    };
  }
  if (!user.active) throw forbidden('EMPLOYEE_INACTIVE');
  if (user.lineUserId !== null && user.lineUserId !== undefined) {
    throw conflict('LINE_LOGIN_REQUIRED');
  }
  const status = user.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED
    ? 'UNVERIFIED_EMPLOYEE'
    : 'VERIFIED';
  const session = await createGuestSession(database, {
    userId: user.userId,
    employeeId: user.employeeId || employeeId,
    status,
    clock
  });
  return {
    success: true,
    status,
    verificationStatus: user.verificationStatus,
    authMode: 'employee_guest',
    token: session.token,
    expiresAt: session.expiresAt,
    capabilities: capabilitiesFor(
      user.role,
      'employee_guest',
      user.verificationStatus,
      user.active
    ),
    user: publicUser(user)
  };
};

const employeePreview = (user) => ({
  employeeId: user.employeeId,
  name: user.displayName,
  floor: user.pickupFloor,
  defaultFloor: user.pickupFloor,
  verificationStatus: user.verificationStatus
});

export const lineEmployeeLookup = async (
  database,
  {
    employeeId: employeeIdInput,
    lineUserId
  } = {}
) => {
  const employeeId = employeeIdText(employeeIdInput);
  const verifiedLineUserId = lineIdText(lineUserId);
  const currentLineUser = await getUserByLineId(database, verifiedLineUserId);
  if (currentLineUser) throw conflict('LINE_ALREADY_BOUND');

  const user = await getUserByEmployeeId(database, employeeId);
  if (!user) {
    return {
      success: true,
      status: 'UNVERIFIED_EMPLOYEE',
      verificationStatus: VERIFICATION_STATUSES.UNVERIFIED,
      authMode: 'line',
      employeeId,
      capabilities: capabilitiesFor(
        null,
        'line',
        VERIFICATION_STATUSES.UNVERIFIED
      ),
      user: null
    };
  }
  if (!user.active) throw forbidden('EMPLOYEE_INACTIVE');
  if (user.lineUserId !== null && user.lineUserId !== undefined) {
    throw conflict('EMPLOYEE_ALREADY_LINE_BOUND');
  }
  return {
    success: true,
    status: 'FOUND',
    verificationStatus: user.verificationStatus,
    authMode: 'line',
    employeeId,
    user: employeePreview(user)
  };
};

const createProvisionalCanonicalUser = async (
  database,
  {
    employeeId,
    lineUserId,
    lineDisplayName,
    displayName,
    pickupFloor,
    clock
  }
) => {
  const timestamp = resolveClock(clock).toISOString();
  const onboardingName = profileText(displayName, profileText(lineDisplayName));
  const onboardingFloor = pickupFloorText(pickupFloor);
  const userId = randomId('user');
  const result = await prepareStatement(database, `
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, active, verification_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 'User', 1, 'UNVERIFIED', ?, ?)
  `, [
    userId,
    employeeId,
    lineUserId,
    onboardingName,
    onboardingFloor,
    timestamp,
    timestamp
  ]).run();
  if (statementChanges(result) !== 1) {
    throw new Error('Provisional user creation failed.');
  }
  const user = await getUserById(database, userId);
  if (!user) throw new Error('Provisional LINE binding readback failed.');
  return user;
};

export const lineEmployeeBind = async (
  database,
  {
    employeeId: employeeIdInput,
    lineUserId,
    lineDisplayName = '',
    displayName,
    pickupFloor,
    clock = new Date()
  } = {}
) => {
  const employeeId = employeeIdText(employeeIdInput);
  const verifiedLineUserId = lineIdText(lineUserId);
  const currentLineUser = await getUserByLineId(database, verifiedLineUserId);
  if (currentLineUser) {
    if (currentLineUser.employeeId === employeeId) {
      return {
        success: true,
        status: 'ALREADY_BOUND',
        verificationStatus: currentLineUser.verificationStatus,
        authMode: 'line',
        user: publicUser(currentLineUser)
      };
    }
    throw conflict('LINE_ALREADY_BOUND');
  }

  const user = await getUserByEmployeeId(database, employeeId);
  if (user) {
    if (!user.active) throw forbidden('EMPLOYEE_INACTIVE');
    if (user.lineUserId !== null && user.lineUserId !== undefined) {
      throw conflict('EMPLOYEE_ALREADY_LINE_BOUND');
    }
    const timestamp = resolveClock(clock).toISOString();
    try {
      const result = await database.prepare(`
        UPDATE users
        SET line_user_id = ?, updated_at = ?
        WHERE employee_id = ? AND active = 1 AND line_user_id IS NULL
      `).bind(verifiedLineUserId, timestamp, employeeId).run();
      if (statementChanges(result) !== 1) {
        const concurrent = await getUserByEmployeeId(database, employeeId);
        if (concurrent?.lineUserId === verifiedLineUserId) {
          return {
            success: true,
            status: 'ALREADY_BOUND',
            verificationStatus: concurrent.verificationStatus,
            authMode: 'line',
            user: publicUser(concurrent)
          };
        }
        throw conflict('LINE_BIND_CONFLICT');
      }
    } catch (error) {
      if (/unique|constraint/i.test(error?.message || error?.cause?.message || '')) {
        const conflicting = await getUserByLineId(database, verifiedLineUserId);
        if (conflicting && conflicting.employeeId !== employeeId) {
          throw conflict('LINE_ALREADY_BOUND');
        }
        throw conflict('LINE_BIND_CONFLICT');
      }
      throw error;
    }
    const boundUser = await getUserByEmployeeId(database, employeeId);
    if (!boundUser || boundUser.lineUserId !== verifiedLineUserId) {
      throw conflict('LINE_BIND_CONFLICT');
    }
    return {
      success: true,
      status: 'BOUND',
      verificationStatus: boundUser.verificationStatus,
      authMode: 'line',
      user: publicUser(boundUser)
    };
  }

  try {
    const provisionalUser = await createProvisionalCanonicalUser(database, {
      employeeId,
      lineUserId: verifiedLineUserId,
      lineDisplayName,
      displayName,
      pickupFloor,
      clock
    });
    return {
      success: true,
      status: 'BOUND',
      verificationStatus: VERIFICATION_STATUSES.UNVERIFIED,
      authMode: 'line',
      lineDisplayName: provisionalUser.displayName,
      user: publicUser(provisionalUser)
    };
  } catch (error) {
    if (/unique|constraint/i.test(error?.message || error?.cause?.message || '')) {
      const conflictingEmployee = await getUserByEmployeeId(database, employeeId);
      if (conflictingEmployee?.lineUserId === verifiedLineUserId) {
        return {
          success: true,
          status: 'ALREADY_BOUND',
          verificationStatus: conflictingEmployee.verificationStatus,
          authMode: 'line',
          user: publicUser(conflictingEmployee)
        };
      }
      if (conflictingEmployee) throw conflict('EMPLOYEE_ALREADY_LINE_BOUND');
      const conflictingLine = await getUserByLineId(database, verifiedLineUserId);
      if (conflictingLine) throw conflict('LINE_ALREADY_BOUND');
    }
    throw error;
  }
};

export const bindLineIdentity = async (
  database,
  {
    guestToken,
    lineUserId,
    lineDisplayName = '',
    displayName,
    pickupFloor,
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

  if (inspected.provisional && !inspected.user) {
    const timestamp = now;
    const onboardingName = profileText(displayName, profileText(lineDisplayName));
    const onboardingFloor = pickupFloorText(pickupFloor);
    const userId = randomId('user');
    const insertUser = prepareStatement(database, `
      INSERT INTO users (
        user_id, employee_id, line_user_id, display_name, pickup_floor,
        balance, role, active, verification_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'User', 1, 'UNVERIFIED', ?, ?)
    `, [
      userId,
      inspected.employeeId,
      verifiedLineUserId,
      onboardingName,
      onboardingFloor,
      timestamp,
      timestamp
    ]);
    const attachAndRevoke = prepareStatement(database, `
      UPDATE employee_guest_sessions
      SET user_id = ?, status = 'UNVERIFIED_EMPLOYEE', revoked_at = ?, revoked_reason = 'line_bound'
      WHERE employee_id = ? AND revoked_at IS NULL
    `, [userId, timestamp, inspected.employeeId]);
    try {
      const [insertResult, attachResult] = await database.batch([
        insertUser,
        attachAndRevoke
      ]);
      if (statementChanges(insertResult) !== 1 || statementChanges(attachResult) < 1) {
        throw new Error('Provisional user creation failed.');
      }
    } catch (error) {
      if (/unique|constraint/i.test(error?.message || error?.cause?.message || '')) {
        const conflictingEmployee = await getUserByEmployeeId(database, inspected.employeeId);
        if (conflictingEmployee) throw conflict('EMPLOYEE_BIND_CONFLICT');
        const conflictingLine = await getUserByLineId(database, verifiedLineUserId);
        if (conflictingLine) throw conflict('LINE_ALREADY_BOUND');
      }
      throw error;
    }
    const user = await getUserById(database, userId);
    if (!user) throw new Error('Provisional LINE binding readback failed.');
    return {
      success: true,
      status: 'BOUND',
      verificationStatus: VERIFICATION_STATUSES.UNVERIFIED,
      authMode: 'line',
      lineDisplayName: onboardingName,
      user: publicUser(user)
    };
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
      verificationStatus: user.verificationStatus,
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
