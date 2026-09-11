import { badRequest, conflict, forbidden, unauthorized } from '../http/errors.js';
import { getUserByEmployeeId, getUserById, getUserByLineId, publicUser } from '../db/users.js';
import { createGuestSession, inspectGuestSession } from '../auth/guestSession.js';
import {
  capabilitiesFor,
  identityStateFor,
  VERIFICATION_STATUSES
} from '../auth/permissions.js';
import { prepareStatement, randomId, resolveClock } from '../db/transactions.js';
import { VALID_PICKUP_FLOORS } from './users.js';
import {
  employeeIdText,
  sameEmployeeId,
  resolveEmployeeVerification
} from './employeeVerification.js';

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
      identityState: identityStateFor({
        provisional: true,
        verificationStatus: VERIFICATION_STATUSES.UNVERIFIED
      }),
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
    identityState: identityStateFor({
      userId: user.userId,
      registered: status === 'VERIFIED',
      verificationStatus: user.verificationStatus,
      active: user.active
    }),
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

const provisionalGuestResult = (user, session) => {
  const verified = user.verificationStatus === VERIFICATION_STATUSES.VERIFIED;
  return {
  success: true,
  registered: verified,
  status: verified ? 'VERIFIED' : 'UNVERIFIED_EMPLOYEE',
  identityState: identityStateFor({
    userId: user.userId,
    employeeId: user.employeeId,
    registered: verified,
    verificationStatus: user.verificationStatus,
    active: user.active
  }),
  verificationStatus: user.verificationStatus,
  authMode: 'employee_guest',
  expiresAt: session?.expiresAt || null,
  capabilities: capabilitiesFor(
    user.role,
    'employee_guest',
    user.verificationStatus,
    user.active
  ),
  employeeId: user.employeeId,
  user: publicUser(user)
  };
};

export const completeEmployeeGuestOnboarding = async (
  database,
  {
    guestToken,
    displayName,
    pickupFloor,
    clock = new Date()
  } = {}
) => {
  if (typeof guestToken !== 'string' || !guestToken.trim()) {
    throw unauthorized('GUEST_SESSION_INVALID');
  }
  const now = resolveClock(clock).toISOString();
  const inspected = await inspectGuestSession(database, guestToken, { now });
  if (!inspected || !inspected.normal || !inspected.employeeId) {
    throw unauthorized('GUEST_SESSION_INVALID');
  }
  if (inspected.user && !inspected.provisional) {
    return provisionalGuestResult(inspected.user, inspected.session);
  }
  if (!inspected.provisional) throw unauthorized('GUEST_SESSION_INVALID');
  if (inspected.user) {
    if (
      inspected.user.verificationStatus !== VERIFICATION_STATUSES.UNVERIFIED
      || inspected.user.lineUserId !== null
    ) {
      throw conflict('EMPLOYEE_ONBOARDING_CONFLICT');
    }
    return provisionalGuestResult(inspected.user, inspected.session);
  }

  const employeeId = employeeIdText(inspected.employeeId);
  const onboardingName = profileText(displayName);
  const onboardingFloor = pickupFloorText(pickupFloor);
  const existing = await getUserByEmployeeId(database, employeeId);
  if (existing) throw conflict('EMPLOYEE_ONBOARDING_CONFLICT');
  const decision = await resolveEmployeeVerification(database, employeeId);

  const userId = randomId('user');
  const insertUser = prepareStatement(database, `
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, active, verification_status, created_at, updated_at
    ) VALUES (?, ?, NULL, ?, ?, 0, 'User', 1, ?, ?, ?)
  `, [
    userId,
    employeeId,
    onboardingName,
    onboardingFloor,
    decision.verificationStatus,
    now,
    now
  ]);
  const attachSession = prepareStatement(database, `
    UPDATE employee_guest_sessions
    SET user_id = ?, status = ?
    WHERE session_id = ?
      AND UPPER(trim(employee_id)) = ?
      AND status = 'UNVERIFIED_EMPLOYEE'
      AND user_id IS NULL
      AND revoked_at IS NULL
  `, [userId, decision.verificationStatus === VERIFICATION_STATUSES.VERIFIED
    ? 'VERIFIED' : 'UNVERIFIED_EMPLOYEE', inspected.session.sessionId, employeeId]);

  try {
    const [insertResult, attachResult] = await database.batch([insertUser, attachSession]);
    if (statementChanges(insertResult) !== 1 || statementChanges(attachResult) !== 1) {
      throw new Error('Employee guest onboarding attach failed.');
    }
  } catch (error) {
    if (/unique|constraint/i.test(error?.message || error?.cause?.message || '')) {
      const replay = await inspectGuestSession(database, guestToken, { now });
      if (replay?.normal && replay.provisional && replay.user) {
        return provisionalGuestResult(replay.user, replay.session);
      }
      throw conflict('EMPLOYEE_ONBOARDING_CONFLICT');
    }
    throw error;
  }

  const user = await getUserById(database, userId);
  if (!user || user.lineUserId !== null || user.verificationStatus !== decision.verificationStatus) {
    throw new Error('Employee guest onboarding readback failed.');
  }
  return provisionalGuestResult(user, inspected.session);
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
  if (currentLineUser) {
    if (!currentLineUser.active) throw forbidden('EMPLOYEE_INACTIVE');
    if (currentLineUser.employeeId !== null && currentLineUser.employeeId !== undefined) {
      throw conflict('LINE_ALREADY_BOUND');
    }
    const boundEmployee = await getUserByEmployeeId(database, employeeId);
    if (boundEmployee && boundEmployee.userId !== currentLineUser.userId) {
      throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
    }
  }

  const user = await getUserByEmployeeId(database, employeeId);
  if (!user) {
    return {
      success: true,
      status: 'UNVERIFIED_EMPLOYEE',
      identityState: identityStateFor({
        provisional: true,
        verificationStatus: VERIFICATION_STATUSES.UNVERIFIED
      }),
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
    identityState: identityStateFor({
      userId: user.userId,
      registered: user.verificationStatus !== VERIFICATION_STATUSES.UNVERIFIED,
      verificationStatus: user.verificationStatus,
      active: user.active
    }),
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
    verificationStatus = VERIFICATION_STATUSES.UNVERIFIED,
    clock
  }
) => {
  const timestamp = resolveClock(clock).toISOString();
  const onboardingName = profileText(displayName || lineDisplayName);
  const onboardingFloor = pickupFloorText(pickupFloor);
  const userId = randomId('user');
  const result = await prepareStatement(database, `
    INSERT INTO users (
      user_id, employee_id, line_user_id, display_name, pickup_floor,
      balance, role, active, verification_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 0, 'User', 1, ?, ?, ?)
  `, [
    userId,
    employeeId,
    lineUserId,
    onboardingName,
    onboardingFloor,
    verificationStatus,
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
    if (!currentLineUser.active) throw forbidden('EMPLOYEE_INACTIVE');
    if (sameEmployeeId(currentLineUser.employeeId, employeeId)) {
      return {
        success: true,
        status: 'ALREADY_BOUND',
        identityState: identityStateFor({
          userId: currentLineUser.userId,
          employeeId: currentLineUser.employeeId,
          registered: currentLineUser.verificationStatus !== VERIFICATION_STATUSES.UNVERIFIED,
          provisional: currentLineUser.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED,
          verificationStatus: currentLineUser.verificationStatus,
          active: currentLineUser.active
        }),
        verificationStatus: currentLineUser.verificationStatus,
        authMode: 'line',
        user: publicUser(currentLineUser)
      };
    }
    if (currentLineUser.employeeId !== null && currentLineUser.employeeId !== undefined) {
      throw conflict('LINE_ALREADY_BOUND');
    }

    const conflictingEmployee = await getUserByEmployeeId(database, employeeId);
    if (conflictingEmployee && conflictingEmployee.userId !== currentLineUser.userId) {
      throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
    }

    const timestamp = resolveClock(clock).toISOString();
    const decision = await resolveEmployeeVerification(database, employeeId);
    try {
      const result = await database.prepare(`
        UPDATE users
        SET employee_id = ?, verification_status = ?, updated_at = ?
        WHERE user_id = ?
          AND line_user_id = ?
          AND employee_id IS NULL
          AND active = 1
      `).bind(
        employeeId,
        decision.verificationStatus,
        timestamp,
        currentLineUser.userId,
        verifiedLineUserId
      ).run();
      if (statementChanges(result) !== 1) {
        const concurrentUser = await getUserByLineId(database, verifiedLineUserId);
        if (sameEmployeeId(concurrentUser?.employeeId, employeeId)) {
          return {
            success: true,
            status: 'ALREADY_BOUND',
            identityState: identityStateFor({
              userId: concurrentUser.userId,
              employeeId: concurrentUser.employeeId,
              registered: concurrentUser.verificationStatus !== VERIFICATION_STATUSES.UNVERIFIED,
              provisional: concurrentUser.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED,
              verificationStatus: concurrentUser.verificationStatus,
              active: concurrentUser.active
            }),
            verificationStatus: concurrentUser.verificationStatus,
            authMode: 'line',
            user: publicUser(concurrentUser)
          };
        }
        if (await getUserByEmployeeId(database, employeeId)) {
          throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
        }
        throw conflict('LINE_BIND_CONFLICT');
      }
    } catch (error) {
      if (error?.status === 409) throw error;
      if (/unique|constraint/i.test(error?.message || error?.cause?.message || '')) {
        const conflicting = await getUserByEmployeeId(database, employeeId);
        if (conflicting && conflicting.userId !== currentLineUser.userId) {
          throw conflict('EMPLOYEE_ID_ALREADY_BOUND');
        }
        throw conflict('LINE_BIND_CONFLICT');
      }
      throw error;
    }

    const boundUser = await getUserByLineId(database, verifiedLineUserId);
    if (!boundUser || boundUser.userId !== currentLineUser.userId || !sameEmployeeId(boundUser.employeeId, employeeId)) {
      throw conflict('LINE_BIND_CONFLICT');
    }
    return {
      success: true,
      status: 'BOUND',
      identityState: identityStateFor({
        userId: boundUser.userId,
        employeeId: boundUser.employeeId,
        registered: boundUser.verificationStatus !== VERIFICATION_STATUSES.UNVERIFIED,
        provisional: boundUser.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED,
        verificationStatus: boundUser.verificationStatus,
        active: boundUser.active
      }),
      verificationStatus: boundUser.verificationStatus,
      authMode: 'line',
      user: publicUser(boundUser)
    };
  }

  const user = await getUserByEmployeeId(database, employeeId);
  if (user) {
    if (!user.active) throw forbidden('EMPLOYEE_INACTIVE');
    if (user.lineUserId !== null && user.lineUserId !== undefined) {
      throw conflict('EMPLOYEE_ALREADY_LINE_BOUND');
    }
    const timestamp = resolveClock(clock).toISOString();
    const decision = await resolveEmployeeVerification(database, employeeId);
    try {
      const result = await database.prepare(`
        UPDATE users
        SET line_user_id = ?, verification_status = ?, updated_at = ?
        WHERE UPPER(trim(employee_id)) = ? AND active = 1 AND line_user_id IS NULL
      `).bind(verifiedLineUserId, decision.verificationStatus, timestamp, employeeId).run();
      if (statementChanges(result) !== 1) {
        const concurrent = await getUserByEmployeeId(database, employeeId);
        if (concurrent?.lineUserId === verifiedLineUserId) {
          return {
            success: true,
            status: 'ALREADY_BOUND',
            identityState: publicUser(concurrent).identityState,
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
        if (conflicting && !sameEmployeeId(conflicting.employeeId, employeeId)) {
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
      identityState: publicUser(boundUser).identityState,
      verificationStatus: boundUser.verificationStatus,
      authMode: 'line',
      user: publicUser(boundUser)
    };
  }

  try {
    const decision = await resolveEmployeeVerification(database, employeeId);
    const provisionalUser = await createProvisionalCanonicalUser(database, {
      employeeId,
      lineUserId: verifiedLineUserId,
      lineDisplayName,
      displayName,
      pickupFloor,
      verificationStatus: decision.verificationStatus,
      clock
    });
    return {
      success: true,
      status: 'BOUND',
      identityState: publicUser(provisionalUser).identityState,
      verificationStatus: provisionalUser.verificationStatus,
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
          identityState: publicUser(conflictingEmployee).identityState,
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
        identityState: publicUser(inspected.user).identityState,
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
    const employeeId = employeeIdText(inspected.employeeId);
    const decision = await resolveEmployeeVerification(database, employeeId);
    const onboardingName = profileText(displayName || lineDisplayName);
    const onboardingFloor = pickupFloorText(pickupFloor);
    const userId = randomId('user');
    const insertUser = prepareStatement(database, `
      INSERT INTO users (
        user_id, employee_id, line_user_id, display_name, pickup_floor,
        balance, role, active, verification_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 'User', 1, ?, ?, ?)
    `, [
      userId,
      employeeId,
      verifiedLineUserId,
      onboardingName,
      onboardingFloor,
      decision.verificationStatus,
      timestamp,
      timestamp
    ]);
    const attachAndRevoke = prepareStatement(database, `
      UPDATE employee_guest_sessions
      SET user_id = ?, status = ?, revoked_at = ?, revoked_reason = 'line_bound'
      WHERE UPPER(trim(employee_id)) = ? AND revoked_at IS NULL
    `, [userId, decision.verificationStatus === VERIFICATION_STATUSES.VERIFIED
      ? 'VERIFIED' : 'UNVERIFIED_EMPLOYEE', timestamp, employeeId]);
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
        const conflictingEmployee = await getUserByEmployeeId(database, employeeId);
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
      identityState: publicUser(user).identityState,
      verificationStatus: user.verificationStatus,
      authMode: 'line',
      lineDisplayName: onboardingName,
      user: publicUser(user)
    };
  }

  const decision = inspected.user.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED
    ? await resolveEmployeeVerification(database, inspected.user.employeeId)
    : {
      verificationStatus: inspected.user.verificationStatus
    };
  const update = prepareStatement(database, `
    UPDATE users
    SET line_user_id = ?, verification_status = ?, updated_at = ?
    WHERE user_id = ? AND active = 1 AND line_user_id IS NULL
  `, [verifiedLineUserId, decision.verificationStatus, now, inspected.user.userId]);
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
      identityState: publicUser(user).identityState,
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
