import { getUserByLineId, publicUser } from '../db/users.js';
import { randomId } from '../db/transactions.js';
import { badRequest } from '../http/errors.js';
import { ACTIONS, assertCan, assertSelfTarget } from '../auth/permissions.js';

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

const writeAudit = async (
  database,
  { actorLineUserId, targetLineUserId, action, now }
) => {
  await database.prepare(`
    INSERT INTO admin_audit_log (
      audit_id, actor_line_user_id, target_line_user_id, action, metadata_json, occurred_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    randomId('audit'),
    actorLineUserId,
    targetLineUserId,
    action,
    '{}',
    nowIso(now)
  ).run();
};

export const getMe = (identity) => ({
  success: true,
  registered: Boolean(identity?.actor?.registered),
  user: identity?.actor?.registered ? publicUser(identity.actor) : null
});

export const registerUser = async (database, identity, { pickupFloor }, clock = new Date()) => {
  if (identity?.actor?.registered) return getMe(identity);
  assertFloor(pickupFloor);
  const actor = identity.actor;
  const timestamp = nowIso(clock);
  await database.prepare(`
    INSERT INTO users (
      line_user_id, display_name, pickup_floor, balance, role, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(line_user_id) DO NOTHING
  `).bind(
    actor.lineUserId,
    actor.displayName || '',
    pickupFloor,
    0,
    'User',
    timestamp,
    timestamp
  ).run();

  const user = await getUserByLineId(database, actor.lineUserId);
  if (!user) throw new Error('Registration readback failed.');
  await writeAudit(database, {
    actorLineUserId: actor.lineUserId,
    targetLineUserId: actor.lineUserId,
    action: 'REGISTER_SELF',
    now: clock
  });
  return {
    success: true,
    registered: true,
    user: publicUser(user)
  };
};

export const updatePickupFloor = async (
  database,
  identity,
  pickupFloor,
  clock = new Date()
) => {
  assertCan(identity, ACTIONS.WRITE_SELF);
  assertSelfTarget(identity, identity.actor.lineUserId);
  assertFloor(pickupFloor);
  await database.prepare(`
    UPDATE users
    SET pickup_floor = ?, updated_at = ?
    WHERE line_user_id = ?
  `).bind(pickupFloor, nowIso(clock), identity.actor.lineUserId).run();
  await writeAudit(database, {
    actorLineUserId: identity.actor.lineUserId,
    targetLineUserId: identity.actor.lineUserId,
    action: 'UPDATE_PICKUP_FLOOR',
    now: clock
  });
  return {
    success: true,
    registered: true,
    user: publicUser(await getUserByLineId(database, identity.actor.lineUserId))
  };
};
