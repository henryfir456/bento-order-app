import { identityStateFor, VERIFICATION_STATUSES } from '../auth/permissions.js';

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
    pickupFloor: String(row.pickup_floor || ''),
    balance: Number(row.balance),
    role: String(row.role || 'User'),
    active: Boolean(row.active),
    verificationStatus: row.verification_status || 'VERIFIED',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
};

const USER_COLUMNS = `
  user_id, employee_id, line_user_id, display_name, pickup_floor,
  balance, role, active, verification_status, created_at, updated_at
`;

export const getUserById = async (database, userId) => {
  const row = await database.prepare(`
    SELECT ${USER_COLUMNS}
    FROM users
    WHERE user_id = ?
    LIMIT 1
  `).bind(userId).first();
  return toUser(row);
};

export const getUserByEmployeeId = async (database, employeeId) => {
  const lookupKey = String(employeeId || '').trim().toUpperCase();
  const row = await database.prepare(`
    SELECT ${USER_COLUMNS}
    FROM users
    WHERE UPPER(trim(employee_id)) = ? AND length(trim(employee_id)) > 0
    LIMIT 1
  `).bind(lookupKey).first();
  return toUser(row);
};

export const getUserByLineId = async (database, lineUserId) => {
  const row = await database.prepare(`
    SELECT ${USER_COLUMNS}
    FROM users
    WHERE line_user_id = ?
    LIMIT 1
  `).bind(lineUserId).first();
  return toUser(row);
};

export const publicUser = (user) => {
  if (!user) return null;
  const hasEmployeeId = Boolean(String(user.employeeId || '').trim());
  const verificationStatus = user.verificationStatus || VERIFICATION_STATUSES.VERIFIED;
  const identityState = identityStateFor({
    userId: user.userId,
    employeeId: user.employeeId,
    registered: hasEmployeeId && verificationStatus === VERIFICATION_STATUSES.VERIFIED,
    verificationStatus,
    active: user.active
  });
  const authSource = String(user.lineUserId || '').trim() ? 'LINE' : 'EMPLOYEE_GUEST';
  return {
    userId: user.userId,
    employeeId: user.employeeId,
    name: user.displayName,
    floor: user.pickupFloor,
    defaultFloor: user.pickupFloor,
    balance: user.balance,
    role: user.role,
    active: user.active,
    authSource,
    identityState,
    verificationStatus,
    lineUserId: user.lineUserId,
    displayName: user.displayName
  };
};
