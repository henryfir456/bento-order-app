const PROTECTED_EMPLOYEE_IDS = new Set(['0'.repeat(6)]);

export const isProtectedEmployeeId = (value) => (
  typeof value === 'string'
  && PROTECTED_EMPLOYEE_IDS.has(value.trim().toUpperCase())
);

export const hasAnyProtectedEmployeeId = (...employeeIds) => (
  employeeIds.some(isProtectedEmployeeId)
);
