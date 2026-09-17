import { getUserById, publicUser } from '../db/users.js';
import { appendAuditEvent } from '../db/audit.js';
import { badRequest, conflict } from '../http/errors.js';
import {
  ACTIONS,
  assertCan,
  assertSelfTarget,
  capabilitiesFor,
  identityStateFor,
  IDENTITY_STATES,
  isRegisteredEmployeeGuestPrincipal,
  VERIFICATION_STATUSES
} from '../auth/permissions.js';
import { VALID_PICKUP_FLOORS } from './profile.js';

export { VALID_PICKUP_FLOORS } from './profile.js';

const nowIso = (clock) => {
  const value = clock instanceof Date ? clock : new Date();
  return value.toISOString();
};

const assertFloor = (pickupFloor) => {
  if (!VALID_PICKUP_FLOORS.includes(pickupFloor)) {
    throw badRequest('INVALID_PICKUP_FLOOR');
  }
};

const assertDisplayName = (displayName) => {
  if (typeof displayName !== 'string') throw badRequest('PROFILE_INVALID');
  const value = displayName.trim();
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!value || value.length > 100 || hasControlCharacter) {
    throw badRequest('PROFILE_INVALID');
  }
  return value;
};

export const getMe = (identity) => {
  const actor = identity?.actor || {};
  const guest = actor.authMode === 'employee_guest';
  const identityState = identityStateFor(actor);
  const employeeBindingRequired = identityState === IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED;
  const registered = Boolean(actor.registered);
  const user = actor.userId ? publicUser(actor) : null;
  return {
    success: true,
    registered,
    identityState,
    authMode: actor.authMode || null,
    user,
    ...(employeeBindingRequired ? {
      status: 'EMPLOYEE_BIND_REQUIRED',
      verificationStatus: actor.verificationStatus || VERIFICATION_STATUSES.VERIFIED,
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities : [],
      employeeId: actor.employeeId || '',
      lineUserId: actor.lineUserId || '',
      displayName: actor.displayName || ''
    } : guest ? {
      status: actor.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED
        ? 'UNVERIFIED_EMPLOYEE' : 'VERIFIED',
      verificationStatus: actor.verificationStatus || VERIFICATION_STATUSES.UNVERIFIED,
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities : [],
      employeeId: actor.employeeId || '',
      lineUserId: actor.lineUserId || '',
      displayName: actor.displayName || ''
    } : registered ? {
      status: 'VERIFIED',
      verificationStatus: actor.verificationStatus || VERIFICATION_STATUSES.VERIFIED,
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities : [],
      employeeId: actor.employeeId || '',
      lineUserId: actor.lineUserId || '',
      displayName: actor.displayName || ''
    } : {
      lineUserId: actor.lineUserId || '',
      displayName: actor.displayName || ''
    })
  };
};

export const registerUser = async (database, identity, { pickupFloor }, clock = new Date()) => {
  if (identity?.actor?.registered) return getMe(identity);
  assertFloor(pickupFloor);
  throw conflict('EMPLOYEE_BIND_REQUIRED');
};

export const updatePickupFloor = async (
  database,
  identity,
  pickupFloor,
  clock = new Date(),
  displayName
) => {
  const guest = identity?.actor?.authMode === 'employee_guest';
  assertCan(identity, ACTIONS.WRITE_SELF);
  assertSelfTarget(identity, identity.actor.userId);
  assertFloor(pickupFloor);
  const nextDisplayName = displayName === undefined ? null : assertDisplayName(displayName);
  const timestamp = nowIso(clock);
  const update = nextDisplayName === null
    ? database.prepare(`
      UPDATE users
      SET pickup_floor = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(pickupFloor, timestamp, identity.actor.userId)
    : database.prepare(`
      UPDATE users
      SET display_name = ?, pickup_floor = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(nextDisplayName, pickupFloor, timestamp, identity.actor.userId);
  await update.run();
  await appendAuditEvent(database, {
    actorUserId: identity.actor.userId,
    targetUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    action: 'UPDATE_PICKUP_FLOOR',
    occurredAt: timestamp
  });
  const user = await getUserById(database, identity.actor.userId);
  const registered = identity.actor.authMode === 'employee_guest'
    ? isRegisteredEmployeeGuestPrincipal({
      ...user,
      authMode: identity.actor.authMode,
      canonicalRole: user?.role
    })
    : Boolean(
      identity.actor.registered
      && identity.actor.authMode === 'line'
      && String(user?.employeeId || '').trim()
    );
  return {
    success: true,
    registered,
    identityState: identityStateFor({
      ...identity.actor,
      userId: user?.userId || identity.actor.userId,
      verificationStatus: user?.verificationStatus || identity.actor.verificationStatus,
      active: user?.active ?? identity.actor.active,
      authMode: identity.actor.authMode,
      employeeId: user?.employeeId || identity.actor.employeeId,
      registered
    }),
    authMode: identity.actor.authMode,
    ...(guest ? {
      status: user.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED
        ? 'UNVERIFIED_EMPLOYEE' : 'VERIFIED',
      verificationStatus: user.verificationStatus || VERIFICATION_STATUSES.UNVERIFIED,
      employeeId: user.employeeId,
      capabilities: capabilitiesFor(
        user.role,
        identity.actor.authMode,
        user.active,
        user.employeeId,
        identity.actor.requiresEmployeeBinding
      )
    } : {
      status: 'VERIFIED',
      verificationStatus: user.verificationStatus || VERIFICATION_STATUSES.VERIFIED,
      capabilities: capabilitiesFor(
        user.role,
        identity.actor.authMode,
        user.active,
        user.employeeId,
        identity.actor.requiresEmployeeBinding
      )
    }),
    user: publicUser(user, {
      authMode: identity.actor.authMode,
      provisional: identity.actor.provisional
    })
  };
};
