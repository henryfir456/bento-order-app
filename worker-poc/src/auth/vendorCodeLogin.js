import { forbidden, unauthorized } from '../http/errors.js';
import { randomId, resolveClock } from '../db/transactions.js';
import { getUserByVendorLoginId } from '../db/users.js';
import { DEFAULT_LIFETIME_MS, hashGuestToken, GUEST_TOKEN_PREFIX } from './guestSession.js';

// Temporary testing aid: while VENDOR_CODE_LOGIN_ENABLED is exactly "true",
// a vendor alias (V + five digits) may sign in by typing the code, the same
// way employees do. The session is read-only for vendor actions. Setting the
// variable to anything else invalidates new logins and existing sessions.
export const VENDOR_CODE_AUTH_MODE = 'vendor_code';

const VENDOR_LOGIN_PATTERN = /^V[0-9]{5}$/;

export const isVendorCodeLoginEnabled = (env) => (
  String(env?.VENDOR_CODE_LOGIN_ENABLED ?? '').trim() === 'true'
);

export const vendorLoginCode = (value) => {
  const code = String(value ?? '').trim().toUpperCase();
  return VENDOR_LOGIN_PATTERN.test(code) ? code : null;
};

const randomToken = () => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return GUEST_TOKEN_PREFIX + Array.from(bytes, (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('');
};

const requireUsableVendor = async (database, code) => {
  const user = await getUserByVendorLoginId(database, code);
  if (!user
    || !user.active
    || user.invalidReason
    || user.isProtectedAccount
    || user.role !== 'Vendor'
    || !user.vendorPrincipal
    || !user.vendorAccessActive) {
    throw forbidden('VENDOR_SCOPE_FORBIDDEN');
  }
  return user;
};

export const vendorCodeLogin = async (database, codeInput, clock = new Date()) => {
  const code = vendorLoginCode(codeInput);
  if (!code) throw forbidden('VENDOR_SCOPE_FORBIDDEN');
  const user = await requireUsableVendor(database, code);
  const createdAt = resolveClock(clock);
  const expiresAt = new Date(createdAt.getTime() + DEFAULT_LIFETIME_MS);
  const token = randomToken();
  // The row reuses employee_guest_sessions (auth_mode is constrained to
  // employee_guest). A vendor principal's row is never "normal" for the
  // employee guest flow; resolveVendorCodeSession is its only reader.
  await database.prepare(`
    INSERT INTO employee_guest_sessions (
      session_id, token_hash, user_id, employee_id, auth_mode, status,
      created_at, expires_at
    ) VALUES (?, ?, ?, ?, 'employee_guest', 'VERIFIED', ?, ?)
  `).bind(
    randomId('guest'),
    await hashGuestToken(token),
    user.userId,
    code,
    createdAt.toISOString(),
    expiresAt.toISOString()
  ).run();
  return {
    success: true,
    registered: true,
    status: 'VERIFIED',
    authMode: VENDOR_CODE_AUTH_MODE,
    token,
    expiresAt: expiresAt.toISOString()
  };
};

// Returns the vendor user for a guest-token session created by
// vendorCodeLogin, or throws GUEST_SESSION_INVALID.
export const resolveVendorCodeSession = async (env, guest, now = new Date()) => {
  if (!isVendorCodeLoginEnabled(env)) throw unauthorized('GUEST_SESSION_INVALID');
  const code = vendorLoginCode(guest?.session?.employeeId);
  if (!code
    || guest.expired
    || guest.session.revokedAt !== null
    || guest.session.expiresAt <= resolveClock(now).toISOString()) {
    throw unauthorized('GUEST_SESSION_INVALID');
  }
  let user;
  try {
    user = await requireUsableVendor(env.DB, code);
  } catch {
    throw unauthorized('GUEST_SESSION_INVALID');
  }
  if (user.userId !== guest.session.userId) throw unauthorized('GUEST_SESSION_INVALID');
  return user;
};
