export const filterMembersByEmployeeId = (members, filter = '') => {
  const rows = Array.isArray(members) ? members : [];
  const normalizedFilter = String(filter ?? '').trim().toLowerCase();

  if (!normalizedFilter) return rows;

  return rows.filter((member) => {
    const employeeId = member?.employeeId ?? member?.employee_id ?? '';
    return String(employeeId).trim().toLowerCase().includes(normalizedFilter);
  });
};
