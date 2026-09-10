import { getUserById, publicUser } from '../db/users.js';
import { appendAuditEvent } from '../db/audit.js';
import { badRequest, conflict } from '../http/errors.js';
import {
  ACTIONS,
  assertCan,
  assertSelfTarget,
  capabilitiesFor
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

export const getMe = (identity) => {
  const registered = Boolean(identity?.actor?.registered);
  return {
    success: true,
    registered,
    authMode: identity?.actor?.authMode || null,
    user: registered ? publicUser(identity.actor) : null,
    ...(registered && identity?.actor?.authMode === 'employee_guest'
      ? { capabilities: capabilitiesFor(identity.actor.role, identity.actor.authMode) }
      : {}),
    ...(!registered ? {
      lineUserId: identity?.actor?.lineUserId || '',
      displayName: identity?.actor?.displayName || ''
    } : {})
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
  clock = new Date()
) => {
  assertCan(identity, ACTIONS.WRITE_SELF);
  assertSelfTarget(identity, identity.actor.userId);
  assertFloor(pickupFloor);
  const timestamp = nowIso(clock);
  await database.prepare(`
    UPDATE users
    SET pickup_floor = ?, updated_at = ?
    WHERE user_id = ?
  `).bind(pickupFloor, timestamp, identity.actor.userId).run();
  await appendAuditEvent(database, {
    actorUserId: identity.actor.userId,
    targetUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    action: 'UPDATE_PICKUP_FLOOR',
    occurredAt: timestamp
  });
  return {
    success: true,
    registered: true,
    authMode: identity.actor.authMode,
    user: publicUser(await getUserById(database, identity.actor.userId))
  };
};
