import { forbidden, unauthorized } from '../http/errors.js';
import { randomId, resolveClock } from '../db/transactions.js';
import { currentBalanceProjection, toUser } from '../db/users.js';
import { isProtectedEmployeeId, isProtectedUserId } from './protectedAccountPolicy.js';

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
           ${currentBalanceProjection('u')} AS balance,
           CASE WHEN u.role = 'User' AND vp.user_id IS NOT NULL
             THEN 'Vendor' ELSE u.role END AS role,
           CASE WHEN vp.user_id IS NULL THEN 0 ELSE 1 END AS vendor_principal,
           CASE WHEN u.role = 'User' AND vp.status = 'ACTIVE' AND EXISTS (
             SELECT 1
             FROM vendor_memberships vm
             JOIN vendors v ON v.vendor_id = vm.vendor_id
             WHERE vm.user_id = u.user_id
               AND vm.status = 'ACTIVE'
               AND v.enabled = 1
           ) THEN 1 ELSE 0 END AS vendor_access_active,
           u.active, u.invalid_reason, u.verification_status,
           u.created_at AS user_created_at,
           u.updated_at AS user_updated_at
    FROM employee_guest_sessions egs
    LEFT JOIN users u ON u.user_id = egs.user_id
    LEFT JOIN vendor_principals vp ON vp.user_id = u.user_id
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
  if (await isProtectedUserId(database, userId)
    || await isProtectedEmployeeId(database, employeeId)) {
    throw forbidden('PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED');
  }
  const createdAt = resolveClock(clock);
  const expiresAt = new Date(createdAt.getTime() + lifetimeMs);
  const token = randomToken();
  const result = await database.prepare(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, employee_id, auth_mode, status,
      created_at, expires_at
    )
    SELECT ?, ?, ?, ?, 'employee_guest', ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1
      FROM users invalid_user
      WHERE invalid_user.invalid_reason = 'INVALID_EMPLOYEE_ID'
        AND (
          (invalid_user.user_id = ? AND ? IS NOT NULL)
          OR (UPPER(trim(invalid_user.employee_id)) = UPPER(trim(?)) AND ? IS NOT NULL)
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM users vendor_user
      JOIN vendor_principals vp ON vp.user_id = vendor_user.user_id
      WHERE (vendor_user.user_id = ? AND ? IS NOT NULL)
         OR (UPPER(trim(vendor_user.employee_id)) = UPPER(trim(?)) AND ? IS NOT NULL)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM vendor_principals vp
      WHERE UPPER(trim(vp.vendor_login_id)) = UPPER(trim(?))
        AND ? IS NOT NULL
    )
  `).bind(
    randomId('guest'),
    await hashGuestToken(token),
    userId,
    employeeId,
    status,
    createdAt.toISOString(),
    expiresAt.toISOString(),
    userId,
    userId,
    employeeId,
    employeeId,
    userId,
    userId,
    employeeId,
    employeeId,
    employeeId,
    employeeId
  ).run();
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  if (changes !== 1) {
    const vendorPrincipal = await database.prepare(`
      SELECT 1
      FROM users vendor_user
      JOIN vendor_principals vp ON vp.user_id = vendor_user.user_id
      WHERE (vendor_user.user_id = ? AND ? IS NOT NULL)
         OR (UPPER(trim(vendor_user.employee_id)) = UPPER(trim(?)) AND ? IS NOT NULL)
      LIMIT 1
    `).bind(userId, userId, employeeId, employeeId).first();
    const vendorAlias = await database.prepare(`
      SELECT 1
      FROM vendor_principals
      WHERE UPPER(trim(vendor_login_id)) = UPPER(trim(?))
        AND ? IS NOT NULL
      LIMIT 1
    `).bind(employeeId, employeeId).first();
    if (vendorPrincipal || vendorAlias) throw forbidden('VENDOR_EMPLOYEE_GUEST_FORBIDDEN');
    throw forbidden('INVALID_EMPLOYEE_ID');
  }
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
  const invalidEmployee = row.invalid_reason === 'INVALID_EMPLOYEE_ID';
  const vendorPrincipal = Number(row.vendor_principal || 0) === 1;
  const active = row.user_id ? Boolean(row.active) && !invalidEmployee : true;
  const lineBound = Boolean(String(row.line_user_id ?? '').trim());
  // Employee authentication is intentionally independent from LINE
  // ownership. A valid employee session remains usable for the same
  // canonical user even when that row already has a LINE binding.
  const normal = !expired && active && !vendorPrincipal && row.revoked_at === null;
  const replay = allowRevokedLineBindReplay
    && !expired
    && active
    && !vendorPrincipal
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
      vendor_principal: row.vendor_principal,
      vendor_access_active: row.vendor_access_active,
      active: row.active,
      invalid_reason: row.invalid_reason,
      verification_status: row.verification_status,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at
    }) : null,
    normal,
    replay,
    expired,
    active,
    invalidReason: invalidEmployee ? 'INVALID_EMPLOYEE_ID' : null,
    lineBound,
    vendorPrincipal,
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
