import { forbidden } from '../http/errors.js';

export const ACTIONS = Object.freeze({
  READ_SELF: 'READ_SELF',
  REGISTER_SELF: 'REGISTER_SELF',
  WRITE_SELF: 'WRITE_SELF',
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

export const can = (role, action, authMode = 'line') => {
  if (authMode === 'employee_guest') {
    return GUEST_ACTIONS.has(action);
  }
  return Boolean(ROLE_ACTIONS[role]?.has(action));
};

export const capabilitiesFor = (role, authMode = 'line') => {
  const actions = authMode === 'employee_guest'
    ? GUEST_ACTIONS
    : (ROLE_ACTIONS[role] || new Set());
  return [...actions].sort();
};

export const assertCan = (identity, action) => {
  if (!identity?.actor?.registered
    || !can(identity.actor.role, action, identity.actor.authMode || 'line')) {
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
