import { forbidden } from '../http/errors.js';

export const ACTIONS = Object.freeze({
  READ_SELF: 'READ_SELF',
  REGISTER_SELF: 'REGISTER_SELF',
  WRITE_SELF: 'WRITE_SELF',
  CAN_VIEW_SELF_ONBOARDING_STATE: 'CAN_VIEW_SELF_ONBOARDING_STATE',
  CAN_COMPLETE_PROFILE: 'CAN_COMPLETE_PROFILE',
  CAN_BIND_LINE: 'CAN_BIND_LINE',
  READ_ADMIN_SUMMARY: 'READ_ADMIN_SUMMARY',
  READ_MEMBER_BALANCES: 'READ_MEMBER_BALANCES',
  ADMIN_BALANCE: 'ADMIN_BALANCE',
  ADMIN_TOP_UP: 'ADMIN_TOP_UP',
  ADMIN_CALENDAR: 'ADMIN_CALENDAR',
  ADMIN_ROLE: 'ADMIN_ROLE',
  ADMIN_ANNOUNCEMENTS: 'ADMIN_ANNOUNCEMENTS',
  VIEW_AS: 'VIEW_AS'
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
    ACTIONS.ADMIN_CALENDAR
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
  EXISTING_UNVERIFIED_EMPLOYEE: 'EXISTING_UNVERIFIED_EMPLOYEE',
  VERIFIED: 'VERIFIED',
  UNREGISTERED: 'UNREGISTERED'
});

const ONBOARDING_ACTIONS = new Set([
  ACTIONS.CAN_BIND_LINE,
  ACTIONS.CAN_COMPLETE_PROFILE,
  ACTIONS.CAN_VIEW_SELF_ONBOARDING_STATE
]);

const normalizedVerificationStatus = (value) => (
  value === VERIFICATION_STATUSES.UNVERIFIED
    ? VERIFICATION_STATUSES.UNVERIFIED
    : VERIFICATION_STATUSES.VERIFIED
);

export const isVerifiedPrincipal = (principal) => Boolean(
  principal?.registered
  && principal?.active !== false
  && normalizedVerificationStatus(principal?.verificationStatus)
    === VERIFICATION_STATUSES.VERIFIED
);

export const isProvisionalPrincipal = (principal) => (
  normalizedVerificationStatus(principal?.verificationStatus)
    === VERIFICATION_STATUSES.UNVERIFIED
);

export const identityStateFor = (principal) => {
  if (principal?.provisional || isProvisionalPrincipal(principal)) {
    return principal?.userId
      ? IDENTITY_STATES.EXISTING_UNVERIFIED_EMPLOYEE
      : IDENTITY_STATES.NEW_PROVISIONAL_EMPLOYEE;
  }
  if (principal?.registered && principal?.active !== false) {
    return IDENTITY_STATES.VERIFIED;
  }
  return IDENTITY_STATES.UNREGISTERED;
};

export const capabilitiesFor = (
  role,
  authMode = 'line',
  verificationStatus = VERIFICATION_STATUSES.VERIFIED,
  active = true
) => {
  if (!active) return [];
  if (normalizedVerificationStatus(verificationStatus) === VERIFICATION_STATUSES.UNVERIFIED) {
    return [...ONBOARDING_ACTIONS].sort();
  }
  const actions = authMode === 'employee_guest'
    ? GUEST_ACTIONS
    : (ROLE_ACTIONS[role] || new Set());
  return [...actions].sort();
};

export const can = (
  role,
  action,
  authMode = 'line',
  verificationStatus = VERIFICATION_STATUSES.VERIFIED,
  active = true
) => capabilitiesFor(role, authMode, verificationStatus, active).includes(action);

export const assertCan = (identity, action) => {
  const actor = identity?.actor;
  if (!actor
    || (!actor.registered && !isProvisionalPrincipal(actor))
    || !can(
    actor.role,
    action,
    actor.authMode || 'line',
    actor.verificationStatus,
    actor.active !== false
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
