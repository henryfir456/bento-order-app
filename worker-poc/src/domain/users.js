import { getUserById, publicUser } from '../db/users.js';
import { appendAuditEvent } from '../db/audit.js';
import { badRequest, conflict } from '../http/errors.js';
import {
  ACTIONS,
  assertCan,
  assertSelfTarget,
  capabilitiesFor,
  identityStateFor,
  VERIFICATION_STATUSES
} from '../auth/permissions.js';

export const VALID_PICKUP_FLOORS = Object.freeze(['1樓', '9樓']);

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
  const provisional = actor.provisional || actor.verificationStatus === 'UNVERIFIED';
  // Keep registered for the existing frontend contract: it means verified
  // application access, not whether a canonical user row exists. Consumers
  // must use identityState to distinguish a new provisional identity from an
  // existing UNVERIFIED canonical user.
  const registered = Boolean(actor.registered && !provisional);
  const user = actor.userId ? publicUser(actor) : null;
  return {
    success: true,
    registered,
    identityState: identityStateFor(actor),
    authMode: actor.authMode || null,
    user,
    ...(provisional ? {
      status: 'UNVERIFIED_EMPLOYEE',
      capabilities: Array.isArray(actor.capabilities) ? actor.capabilities : [],
      employeeId: actor.employeeId || '',
      lineUserId: actor.lineUserId || '',
      displayName: actor.displayName || ''
    } : registered ? {
      status: 'VERIFIED',
      ...(actor.authMode === 'employee_guest' && Array.isArray(actor.capabilities)
        ? { capabilities: actor.capabilities }
        : {})
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
  const provisional = identity?.actor?.provisional
    || identity?.actor?.verificationStatus === VERIFICATION_STATUSES.UNVERIFIED;
  assertCan(identity, provisional ? ACTIONS.CAN_COMPLETE_PROFILE : ACTIONS.WRITE_SELF);
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
  return {
    success: true,
    registered: !provisional,
    identityState: identityStateFor({
      ...identity.actor,
      userId: user?.userId || identity.actor.userId,
      verificationStatus: user?.verificationStatus || identity.actor.verificationStatus,
      active: user?.active ?? identity.actor.active,
      registered: !provisional
    }),
    authMode: identity.actor.authMode,
    ...(provisional ? {
      status: 'UNVERIFIED_EMPLOYEE',
      verificationStatus: VERIFICATION_STATUSES.UNVERIFIED,
      employeeId: user.employeeId,
      capabilities: capabilitiesFor(
        user.role,
        identity.actor.authMode,
        user.verificationStatus,
        user.active
      )
    } : {
      status: 'VERIFIED'
    }),
    user: publicUser(user)
  };
};
