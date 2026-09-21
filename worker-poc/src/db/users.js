import {
  identityStateFor,
  isRegisteredEmployeeGuestPrincipal,
  VERIFICATION_STATUSES
} from '../auth/permissions.js';
import { isProfileComplete } from '../domain/profile.js';

export const toUser = (row) => {
  if (!row) return null;
  return {
    userId: String(row.user_id),
    employeeId: row.employee_id === null || row.employee_id === undefined
      ? null
      : String(row.employee_id),
    lineUserId: row.line_user_id === null || row.line_user_id === undefined
      ? null
      : String(row.line_user_id),
    displayName: String(row.display_name || ''),
    pickupFloor: row.pickup_floor === null || row.pickup_floor === undefined
      ? null
      : String(row.pickup_floor),
    balance: Number(row.balance),
    role: String(row.role || 'User'),
    active: Boolean(row.active),
    verificationStatus: row.verification_status || 'VERIFIED',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
};

export const authoritativeBalanceProjection = (alias = 'u') => `COALESCE((
  SELECT bl.balance_after
  FROM balance_ledger bl
  JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
  WHERE bl.user_id = ${alias}.user_id
  ORDER BY bls.sequence_number DESC
  LIMIT 1
), ${alias}.balance)`;

// Kept as a compatibility name for existing read projections. New ledger
// writers must use authoritativeBalanceProjection through ledgerQueries.
export const currentBalanceProjection = authoritativeBalanceProjection;

export const getCurrentBalance = async (database, userId) => {
  const row = await database.prepare(`
    SELECT ${currentBalanceProjection('u')} AS balance
    FROM users u
    WHERE u.user_id = ?
    LIMIT 1
  `).bind(userId).first();
  return row ? Number(row.balance) : null;
};

const userColumns = (alias = 'u') => `
  ${alias}.user_id, ${alias}.employee_id, ${alias}.line_user_id,
  ${alias}.display_name, ${alias}.pickup_floor,
  ${currentBalanceProjection(alias)} AS balance,
  ${alias}.role, ${alias}.active, ${alias}.verification_status,
  ${alias}.created_at, ${alias}.updated_at
`;

export const getUserById = async (database, userId) => {
  const row = await database.prepare(`
    SELECT ${userColumns('u')}
    FROM users u
    WHERE u.user_id = ?
    LIMIT 1
  `).bind(userId).first();
  return toUser(row);
};

export const getUserByEmployeeId = async (database, employeeId) => {
  const lookupKey = String(employeeId || '').trim().toUpperCase();
  const row = await database.prepare(`
    SELECT ${userColumns('u')}
    FROM users u
    WHERE UPPER(trim(u.employee_id)) = ? AND length(trim(u.employee_id)) > 0
    LIMIT 1
  `).bind(lookupKey).first();
  return toUser(row);
};

export const getUserByLineId = async (database, lineUserId) => {
  const row = await database.prepare(`
    SELECT ${userColumns('u')}
    FROM users u
    WHERE u.line_user_id = ?
    LIMIT 1
  `).bind(lineUserId).first();
  return toUser(row);
};

export const publicUser = (user, { authMode: projectedAuthMode = null, provisional = false } = {}) => {
  if (!user) return null;
  const hasEmployeeId = Boolean(String(user.employeeId || '').trim());
  const verificationStatus = user.verificationStatus || VERIFICATION_STATUSES.VERIFIED;
  const hasLineBinding = Boolean(String(user.lineUserId || '').trim());
  const authMode = projectedAuthMode || user.authMode || (hasLineBinding ? 'line' : 'canonical');
  const isEmployeeGuest = authMode === 'employee_guest';
  const canonicalRole = user.canonicalRole || user.role;
  const registeredEmployeeGuest = isRegisteredEmployeeGuestPrincipal({
    ...user,
    authMode,
    canonicalRole
  });
  // A canonical member without a LINE binding is still a canonical member.
  // `employee_guest` belongs to the authenticated session principal and must
  // not be inferred from a nullable users.line_user_id projection.
  const identityState = identityStateFor({
    userId: user.userId,
    employeeId: user.employeeId,
    authMode,
    registered: isEmployeeGuest
      ? registeredEmployeeGuest
      : user.active && hasEmployeeId,
    provisional: isEmployeeGuest && (provisional || !registeredEmployeeGuest),
    verificationStatus,
    active: user.active
  });
  const authSource = isEmployeeGuest
    ? 'EMPLOYEE_GUEST'
    : hasLineBinding
      ? 'LINE'
      : hasEmployeeId
        ? 'EMPLOYEE'
        : 'NON_LINE';
  return {
    userId: user.userId,
    employeeId: user.employeeId,
    name: user.displayName,
    floor: user.pickupFloor,
    defaultFloor: user.pickupFloor,
    balance: user.balance,
    // The employee_guest projection is intentionally self-service only and
    // must never expose an elevated role obtained through employee auth.
    role: isEmployeeGuest ? 'User' : user.role,
    active: user.active,
    authSource,
    identityState,
    verificationStatus,
    lineUserId: user.lineUserId,
    displayName: user.displayName,
    profileComplete: isProfileComplete(user)
  };
};
