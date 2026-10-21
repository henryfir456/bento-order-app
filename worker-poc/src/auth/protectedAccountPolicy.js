const normalizedEmployeeId = (value) => String(value ?? '').trim().toUpperCase();

export const isProtectedAccount = (user) => user?.isProtectedAccount === true;

export const isProtectedUserId = async (database, userId) => {
  if (!userId) return false;
  const row = await database.prepare(`
    SELECT 1 AS protected_account
    FROM protected_account_user_mappings
    WHERE user_id = ?
    LIMIT 1
  `).bind(String(userId)).first();
  return Boolean(row);
};

// Compatibility guard for workflows that accept an employee identifier.
// The protected owner is canonicalized by user_id; this lookup only blocks
// employee-based access to the mapped user's current employee_id.
export const isProtectedEmployeeId = async (database, value) => {
  const employeeId = normalizedEmployeeId(value);
  if (!employeeId) return false;
  const row = await database.prepare(`
    SELECT 1 AS protected_account
    FROM protected_account_user_mappings mapping
    JOIN users protected_owner ON protected_owner.user_id = mapping.user_id
    WHERE UPPER(trim(protected_owner.employee_id)) = ?
      AND length(trim(COALESCE(protected_owner.employee_id, ''))) > 0
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
