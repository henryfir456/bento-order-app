export const formatEmployeeId = (employeeId) => {
  const normalized = employeeId === null || employeeId === undefined
    ? ''
    : String(employeeId).trim();
  return normalized || '未綁定';
};
