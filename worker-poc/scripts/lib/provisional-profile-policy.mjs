import { stableId } from './import-contract.mjs';

// SQL history proves only the normalized employee identity. It does not prove
// a display name, floor, current balance, role elevation, or authentication.
// Keep the candidate explicit so a later write gate cannot accidentally treat
// evidence as authoritative profile state.
export const SQL_HISTORICAL_PROVISIONAL_PROFILE_POLICY = Object.freeze({
  source: 'SQL_EMPLOYEE_ID_ONLY',
  displayName: 'DETERMINISTIC_EMPLOYEE_ID',
  pickupFloor: 'NULL_UNTIL_PROFILE_COMPLETION',
  balance: 'CANONICAL_DEFAULT_ZERO_NOT_LEGACY_BALANCE',
  role: 'LOWEST_PRIVILEGE_USER',
  active: 'CANONICAL_DEFAULT_ACTIVE',
  verificationStatus: 'UNVERIFIED_NO_AUTH_PROOF'
});

export const sqlHistoricalProvisionalUser = (normalizedEmployeeId) => {
  const employeeId = String(normalizedEmployeeId || '').trim().toUpperCase();
  const user = {
    user_id: stableId('user', employeeId),
    employee_id: employeeId,
    line_user_id: null,
    display_name: `Legacy employee ${employeeId}`,
    pickup_floor: null,
    balance: 0,
    role: 'User',
    active: true,
    verification_status: 'UNVERIFIED'
  };
  const blockedByRequiredProfileFields = [];
  return Object.freeze({
    execute: false,
    kind: 'CREATE_CANONICAL_USER_PREVIEW',
    user: Object.freeze(user),
    profilePolicy: SQL_HISTORICAL_PROVISIONAL_PROFILE_POLICY,
    blockedByRequiredProfileFields,
    canonicalIdentityReady: true,
    profileComplete: false,
    ledgerMutation: false,
    sideEffect: false
  });
};
