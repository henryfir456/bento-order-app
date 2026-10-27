export const filterMembersByEmployeeId = (members, filter = '') => {
  const rows = Array.isArray(members) ? members : [];
  const normalizedFilter = String(filter ?? '').trim().toLowerCase();

  if (!normalizedFilter) return rows;

  return rows.filter((member) => {
    const employeeId = member?.employeeId ?? member?.employee_id ?? '';
    return String(employeeId).trim().toLowerCase().includes(normalizedFilter);
  });
};

export const filterMembersByEmployeeIdOrName = (members, filter = '') => {
  const rows = Array.isArray(members) ? members : [];
  const normalizedFilter = String(filter ?? '').trim().toLowerCase();

  if (!normalizedFilter) return rows;

  return rows.filter((member) => {
    const employeeId = member?.employeeId ?? member?.employee_id ?? '';
    const name = member?.name ?? member?.displayName ?? member?.display_name ?? '';
    return [employeeId, name].some((value) => String(value).trim().toLowerCase().includes(normalizedFilter));
  });
};
