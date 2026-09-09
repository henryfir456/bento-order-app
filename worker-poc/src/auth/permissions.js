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
  VIEW_AS: 'VIEW_AS'
});

const ROLE_ACTIONS = Object.freeze({
  User: new Set([ACTIONS.READ_SELF, ACTIONS.REGISTER_SELF, ACTIONS.WRITE_SELF]),
  ProxyAdmin: new Set([
    ACTIONS.READ_SELF,
    ACTIONS.REGISTER_SELF,
    ACTIONS.WRITE_SELF,
    ACTIONS.READ_ADMIN_SUMMARY,
    ACTIONS.ADMIN_CALENDAR
  ]),
  Admin: new Set(Object.values(ACTIONS))
});

export const can = (role, action) => Boolean(ROLE_ACTIONS[role]?.has(action));

export const assertCan = (identity, action) => {
  if (!identity?.actor?.registered || !can(identity.actor.role, action)) {
    throw forbidden();
  }
  return true;
};

export const assertSelfTarget = (identity, targetLineUserId) => {
  if (identity?.actor?.lineUserId !== targetLineUserId) {
    throw forbidden('FORBIDDEN_TARGET', 'The mutation target must be the authenticated actor.');
  }
  return true;
};
