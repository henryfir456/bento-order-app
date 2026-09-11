import { unauthorized } from '../http/errors.js';
import { randomId, resolveClock } from '../db/transactions.js';
import { toUser } from '../db/users.js';

const DEFAULT_LIFETIME_MS = 8 * 60 * 60 * 1000;
const GUEST_TOKEN_PREFIX = 'eg_';

const bytesToHex = (bytes) => Array.from(bytes, (byte) => (
  byte.toString(16).padStart(2, '0')
)).join('');

const randomToken = () => {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Web Crypto randomness is required for guest sessions.');
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return GUEST_TOKEN_PREFIX + bytesToHex(bytes);
};

export const hashGuestToken = async (token) => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto hashing is required for guest sessions.');
  }
  const bytes = new TextEncoder().encode(String(token));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
};

export const isGuestToken = (token) => String(token || '').startsWith(GUEST_TOKEN_PREFIX);

const sessionRow = async (database, token) => {
  const tokenHash = await hashGuestToken(token);
  return database.prepare(`
    SELECT egs.session_id, egs.token_hash, egs.user_id, egs.auth_mode,
           egs.employee_id AS session_employee_id, egs.status AS session_status,
           egs.created_at, egs.expires_at, egs.revoked_at, egs.revoked_reason,
           u.employee_id, u.line_user_id, u.display_name, u.pickup_floor,
           u.balance, u.role, u.active, u.verification_status,
           u.created_at AS user_created_at,
           u.updated_at AS user_updated_at
    FROM employee_guest_sessions egs
    LEFT JOIN users u ON u.user_id = egs.user_id
    WHERE egs.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();
};

export const createGuestSession = async (
  database,
  {
    userId = null,
    employeeId = null,
    status = 'VERIFIED',
    clock = new Date(),
    lifetimeMs = DEFAULT_LIFETIME_MS
  } = {}
) => {
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0) {
    throw new TypeError('Guest session lifetime must be a positive safe integer.');
  }
  const createdAt = resolveClock(clock);
  const expiresAt = new Date(createdAt.getTime() + lifetimeMs);
  const token = randomToken();
  await database.prepare(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, employee_id, auth_mode, status,
      created_at, expires_at
    ) VALUES (?, ?, ?, ?, 'employee_guest', ?, ?, ?)
  `).bind(
    randomId('guest'),
    await hashGuestToken(token),
    userId,
    employeeId,
    status,
    createdAt.toISOString(),
    expiresAt.toISOString()
  ).run();
  return { token, expiresAt: expiresAt.toISOString() };
};

export const inspectGuestSession = async (
  database,
  token,
  { now = new Date(), allowRevokedLineBindReplay = false } = {}
) => {
  const row = await sessionRow(database, token);
  if (!row) return null;
  const nowIso = resolveClock(now).toISOString();
  const expired = row.expires_at <= nowIso;
  const active = row.user_id ? Boolean(row.active) : true;
  const lineBound = Boolean(String(row.line_user_id ?? '').trim());
  const normal = !expired && active && !lineBound && row.revoked_at === null;
  const replay = allowRevokedLineBindReplay
    && !expired
    && active
    && row.revoked_at !== null
    && row.revoked_reason === 'line_bound'
    && lineBound;
  return {
    session: {
      sessionId: row.session_id,
      userId: row.user_id,
      employeeId: row.session_employee_id || row.employee_id || null,
      status: row.session_status || 'VERIFIED',
      authMode: row.auth_mode,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason
    },
    user: row.user_id ? toUser({
      user_id: row.user_id,
      employee_id: row.employee_id,
      line_user_id: row.line_user_id,
      display_name: row.display_name,
      pickup_floor: row.pickup_floor,
      balance: row.balance,
      role: row.role,
      active: row.active,
      verification_status: row.verification_status,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at
    }) : null,
    normal,
    replay,
    expired,
    active,
    lineBound,
    provisional: row.session_status === 'UNVERIFIED_EMPLOYEE',
    employeeId: row.session_employee_id || row.employee_id || null,
    status: row.session_status || 'VERIFIED'
  };
};

export const requireGuestSession = async (database, token, options = {}) => {
  const inspected = await inspectGuestSession(database, token, options);
  if (!inspected || !inspected.normal) throw unauthorized('GUEST_SESSION_INVALID');
  return inspected;
};

export { DEFAULT_LIFETIME_MS, GUEST_TOKEN_PREFIX };
