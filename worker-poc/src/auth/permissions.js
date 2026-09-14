import { forbidden } from '../http/errors.js';

export const ACTIONS = Object.freeze({
  READ_SELF: 'READ_SELF',
  REGISTER_SELF: 'REGISTER_SELF',
  WRITE_SELF: 'WRITE_SELF',
  CAN_VIEW_SELF_ONBOARDING_STATE: 'CAN_VIEW_SELF_ONBOARDING_STATE',
  CAN_COMPLETE_PROFILE: 'CAN_COMPLETE_PROFILE',
  CAN_BIND_LINE: 'CAN_BIND_LINE',
  CAN_BIND_EMPLOYEE: 'CAN_BIND_EMPLOYEE',
  READ_ADMIN_SUMMARY: 'READ_ADMIN_SUMMARY',
  READ_MEMBER_BALANCES: 'READ_MEMBER_BALANCES',
  ADMIN_BALANCE: 'ADMIN_BALANCE',
  ADMIN_TOP_UP: 'ADMIN_TOP_UP',
  ADMIN_CALENDAR: 'ADMIN_CALENDAR',
  ADMIN_ROLE: 'ADMIN_ROLE',
  ADMIN_ANNOUNCEMENTS: 'ADMIN_ANNOUNCEMENTS',
  ADMIN_MENU_CHANGES: 'ADMIN_MENU_CHANGES',
  ADMIN_EMPLOYEE_BIND: 'ADMIN_EMPLOYEE_BIND',
  VIEW_AS: 'VIEW_AS',
  DELEGATE_ORDER: 'DELEGATE_ORDER'
});

const ROLE_ACTIONS = Object.freeze({
  User: new Set([
    ACTIONS.READ_SELF,
    ACTIONS.REGISTER_SELF,
    ACTIONS.WRITE_SELF,
    ACTIONS.READ_ADMIN_SUMMARY
  ]),
  ProxyAdmin: new Set([
    ACTIONS.READ_SELF,
    ACTIONS.REGISTER_SELF,
    ACTIONS.WRITE_SELF,
    ACTIONS.READ_ADMIN_SUMMARY,
    ACTIONS.ADMIN_CALENDAR,
    ACTIONS.DELEGATE_ORDER
  ]),
  Admin: new Set(Object.values(ACTIONS))
});

const GUEST_ACTIONS = new Set([
  ACTIONS.READ_SELF,
  ACTIONS.REGISTER_SELF,
  ACTIONS.WRITE_SELF
]);

export const VERIFICATION_STATUSES = Object.freeze({
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED'
});

export const IDENTITY_STATES = Object.freeze({
  NEW_PROVISIONAL_EMPLOYEE: 'NEW_PROVISIONAL_EMPLOYEE',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  // Retained as a source-compatibility name for onboarding callers. New
  // canonical-user projections use PENDING_VERIFICATION publicly.
  EXISTING_UNVERIFIED_EMPLOYEE: 'EXISTING_UNVERIFIED_EMPLOYEE',
  EMPLOYEE_BIND_REQUIRED: 'EMPLOYEE_BIND_REQUIRED',
  VERIFIED: 'VERIFIED',
  UNREGISTERED: 'UNREGISTERED'
});

const hasEmployeeId = (value) => String(value ?? '').trim().length > 0;

export const isRegisteredLinePrincipal = (principal) => Boolean(
  principal?.authMode === 'line'
    && principal?.active === true
    && hasEmployeeId(principal?.employeeId)
);

export const isProvisionalPrincipal = (principal) => Boolean(
  principal?.authMode === 'employee_guest'
    && principal?.provisional
);

export const identityStateFor = (principal) => {
  const authMode = principal?.authMode || 'line';
  if (
    principal?.userId
    && authMode === 'line'
    && !hasEmployeeId(principal.employeeId)
  ) {
    return IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED;
  }
  if (principal?.provisional || isProvisionalPrincipal(principal)) {
    return principal?.userId
      ? IDENTITY_STATES.PENDING_VERIFICATION
      : IDENTITY_STATES.NEW_PROVISIONAL_EMPLOYEE;
  }
  if (
    authMode === 'employee_guest'
    && principal?.userId
    && principal?.active !== false
    && principal?.verificationStatus === VERIFICATION_STATUSES.VERIFIED
  ) {
    return IDENTITY_STATES.VERIFIED;
  }
  if (
    isRegisteredLinePrincipal(principal)
    || (principal?.registered && principal?.active !== false)
  ) {
    return IDENTITY_STATES.VERIFIED;
  }
  if (principal?.userId && !hasEmployeeId(principal.employeeId)) {
    return IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED;
  }
  return IDENTITY_STATES.UNREGISTERED;
};

export const capabilitiesFor = (
  role,
  authMode = 'line',
  active = true,
  employeeId = null,
  employeeBindingRequired = false
) => {
  if (!active) return [];
  if (authMode === 'employee_guest') {
    return [...GUEST_ACTIONS].sort();
  }
  if (
    authMode === 'line'
    && (employeeBindingRequired || !hasEmployeeId(employeeId))
  ) {
    return [
      ACTIONS.CAN_BIND_EMPLOYEE,
      ACTIONS.CAN_VIEW_SELF_ONBOARDING_STATE
    ].sort();
  }
  const actions = ROLE_ACTIONS[role] || new Set();
  return [...actions].sort();
};

export const can = (
  role,
  action,
  authMode = 'line',
  active = true,
  employeeId = null,
  employeeBindingRequired = false
) => capabilitiesFor(
  role,
  authMode,
  active,
  employeeId,
  employeeBindingRequired
).includes(action);

export const isEmployeeBindingPrincipal = (principal) => Boolean(
  principal?.userId
  && principal?.authMode === 'line'
  && principal?.active === true
  && principal?.requiresEmployeeBinding
);

export const assertCan = (identity, action) => {
  const actor = identity?.actor;
  const authMode = actor?.authMode || 'line';
  const registered = isRegisteredLinePrincipal(actor);
  const guest = authMode === 'employee_guest' && actor?.active === true;
  const unbound = isEmployeeBindingPrincipal(actor);
  if (!actor || (!registered && !guest && !unbound) || !can(
    actor.role,
    action,
    authMode,
    actor.active === true,
    actor.employeeId,
    actor.requiresEmployeeBinding
  )) {
    throw forbidden();
  }
  return true;
};

export const assertSelfTarget = (identity, targetUserId) => {
  if (identity?.actor?.userId !== targetUserId
    || (identity?.effectiveSubject?.userId
      && identity.effectiveSubject.userId !== targetUserId)) {
    throw forbidden('FORBIDDEN_TARGET', 'The mutation target must be the authenticated actor.');
  }
  return true;
};
