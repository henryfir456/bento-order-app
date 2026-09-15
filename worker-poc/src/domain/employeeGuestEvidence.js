export const matchingEmployeeGuestEvidencePredicate = ({
  sessionAlias = 'employee_guest_sessions',
  ownerUserIdExpression = '?',
  ownerEmployeeIdExpression = '?'
} = {}) => `
  ${sessionAlias}.user_id = ${ownerUserIdExpression}
  AND ${sessionAlias}.auth_mode = 'employee_guest'
  AND ${sessionAlias}.status = 'UNVERIFIED_EMPLOYEE'
  AND ${sessionAlias}.employee_id IS NOT NULL
  AND length(trim(${sessionAlias}.employee_id)) > 0
  AND UPPER(trim(${sessionAlias}.employee_id)) = UPPER(trim(${ownerEmployeeIdExpression}))
`;
