export const IDENTITY_FILTERS = Object.freeze({
  ALL: 'ALL',
  BIND_REQUIRED: 'EMPLOYEE_BIND_REQUIRED',
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  VERIFIED: 'VERIFIED'
});

const SOURCE_LABELS = Object.freeze({
  LINE: 'LINE',
  EMPLOYEE_GUEST: '非 LINE'
});

const STATE_LABELS = Object.freeze({
  EMPLOYEE_BIND_REQUIRED: '待綁員編',
  PENDING_VERIFICATION: '待審核',
  VERIFIED: '已驗證'
});

export const getIdentityBadges = ({ authSource, identityState } = {}) => ([
  {
    key: 'authSource',
    value: authSource,
    label: SOURCE_LABELS[authSource] || '登入來源待確認',
    tone: authSource === 'LINE' ? 'line' : authSource === 'EMPLOYEE_GUEST' ? 'guest' : 'unknown'
  },
  {
    key: 'identityState',
    value: identityState,
    label: STATE_LABELS[identityState] || '身份狀態待確認',
    tone: identityState === 'VERIFIED'
      ? 'verified'
      : identityState === 'PENDING_VERIFICATION'
        ? 'pending'
        : identityState === 'EMPLOYEE_BIND_REQUIRED'
          ? 'bind'
          : 'unknown'
  }
]);

export const identityFilterMatches = (member, filter) => (
  filter === IDENTITY_FILTERS.ALL || member?.identityState === filter
);

export const identityFilterOptions = Object.freeze([
  { value: IDENTITY_FILTERS.ALL, label: '全部' },
  { value: IDENTITY_FILTERS.BIND_REQUIRED, label: '待綁員編' },
  { value: IDENTITY_FILTERS.PENDING_VERIFICATION, label: '待審核' },
  { value: IDENTITY_FILTERS.VERIFIED, label: '已驗證' }
]);
