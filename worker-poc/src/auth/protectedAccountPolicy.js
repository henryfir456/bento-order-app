import { serviceUnavailable } from '../http/errors.js';

const normalizedEmployeeId = (value) => String(value ?? '').trim().toUpperCase();

export const assertProtectedAccountMappingReady = async (database) => {
  try {
    const result = await database.prepare(`
      SELECT mapping.employee_id,
             COUNT(u.user_id) AS owner_count,
             SUM(CASE WHEN u.active = 1
                       AND u.invalid_reason IS NULL
                       AND u.verification_status = 'VERIFIED'
                       AND length(trim(COALESCE(u.line_user_id, ''))) > 0
                      THEN 1 ELSE 0 END) AS eligible_owner_count
      FROM protected_account_employee_mappings mapping
      LEFT JOIN users u
        ON UPPER(trim(u.employee_id)) = UPPER(trim(mapping.employee_id))
      WHERE mapping.account_key = 'RESERVED_VENDOR_OWNER'
        AND length(trim(mapping.employee_id)) > 0
      GROUP BY mapping.account_key, mapping.employee_id
      LIMIT 2
    `).all();
    const rows = Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : []);
    if (rows.length !== 1
      || Number(rows[0].owner_count) !== 1
      || Number(rows[0].eligible_owner_count) !== 1) {
      throw serviceUnavailable('PROTECTED_ACCOUNT_CONFIGURATION_REQUIRED');
    }
  } catch (error) {
    if (error?.status === 503 && error?.code === 'PROTECTED_ACCOUNT_CONFIGURATION_REQUIRED') throw error;
    throw serviceUnavailable('PROTECTED_ACCOUNT_CONFIGURATION_UNAVAILABLE');
  }
};

export const isProtectedAccount = (user) => user?.isProtectedAccount === true;

export const isProtectedEmployeeId = async (database, value) => {
  const employeeId = normalizedEmployeeId(value);
  if (!employeeId) return false;
  const row = await database.prepare(`
    SELECT 1 AS protected_account
    FROM protected_account_employee_mappings
    WHERE UPPER(trim(employee_id)) = ?
    LIMIT 1
  `).bind(employeeId).first();
  return Boolean(row);
};

export const hasAnyProtectedEmployeeId = async (database, ...employeeIds) => {
  for (const employeeId of employeeIds) {
    if (await isProtectedEmployeeId(database, employeeId)) return true;
  }
  return false;
};
