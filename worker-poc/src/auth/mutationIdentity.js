import { conflict } from '../http/errors.js';

export const currentIdentityPredicate = (identity, now = new Date()) => {
  const actor = identity?.authorizationActor || identity?.actor;
  if (!actor?.userId) return { sql: '0 = 1', params: [] };

  if (actor.authMode === 'line' && actor.lineUserId) {
    return {
      sql: `EXISTS (
        SELECT 1 FROM users current_identity
        WHERE current_identity.user_id = ?
          AND current_identity.line_user_id = ?
          AND current_identity.active = 1
          AND NOT EXISTS (
            SELECT 1 FROM vendor_principals vp WHERE vp.user_id = current_identity.user_id
          )
      )`,
      params: [actor.userId, actor.lineUserId]
    };
  }

  if (actor.authMode === 'employee_guest') {
    const sessionId = identity?.guestSession?.sessionId;
    const employeeId = actor.employeeId || identity?.guestSession?.employeeId;
    if (!sessionId || !employeeId) return { sql: '0 = 1', params: [] };
    const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    return {
      sql: `EXISTS (
        SELECT 1
        FROM employee_guest_sessions current_session
        JOIN users current_identity ON current_identity.user_id = ?
        WHERE current_session.session_id = ?
          AND current_session.auth_mode = 'employee_guest'
          AND current_session.revoked_at IS NULL
          AND current_session.expires_at > ?
          AND current_identity.active = 1
          AND NOT EXISTS (
            SELECT 1 FROM vendor_principals vp WHERE vp.user_id = current_identity.user_id
          )
          AND (
            current_session.user_id = current_identity.user_id
            OR (
              current_session.user_id IS NULL
              AND UPPER(trim(current_session.employee_id)) = UPPER(trim(current_identity.employee_id))
              AND UPPER(trim(current_session.employee_id)) = UPPER(trim(?))
            )
          )
      )`,
      params: [actor.userId, sessionId, timestamp, employeeId]
    };
  }

  return { sql: '0 = 1', params: [] };
};

export const assertCurrentIdentity = async (database, identity, now = new Date()) => {
  const predicate = currentIdentityPredicate(identity, now);
  const row = await database.prepare(`SELECT ${predicate.sql} AS current_identity`)
    .bind(...predicate.params)
    .first();
  if (Number(row?.current_identity || 0) !== 1) {
    throw conflict('IDENTITY_SESSION_STALE');
  }
  return predicate;
};
