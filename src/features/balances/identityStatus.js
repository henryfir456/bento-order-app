export const IDENTITY_FILTERS = Object.freeze({
  ALL: 'ALL',
  BIND_REQUIRED: 'EMPLOYEE_BIND_REQUIRED',
  // Kept for compatibility with historical member payloads. It is not an
  // active verification-review filter and is intentionally not rendered.
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  VERIFIED: 'VERIFIED'
});

const SOURCE_LABELS = Object.freeze({
  LINE: 'LINE',
  EMPLOYEE: '員編',
  NON_LINE: '未綁 LINE',
  EMPLOYEE_GUEST: '非 LINE'
});

const STATE_LABELS = Object.freeze({
  EMPLOYEE_BIND_REQUIRED: '待綁員編',
  PENDING_VERIFICATION: '員工訪客',
  VERIFIED: '已註冊'
});

const hasEmployeeId = (value) => String(value ?? '').trim().length > 0;

const isEmployeeGuestMember = (member) => (
  member?.authMode === 'employee_guest' || member?.authSource === 'EMPLOYEE_GUEST'
);

const isNonLineCanonicalMember = (member) => (
  member?.authSource === 'EMPLOYEE' || member?.authSource === 'NON_LINE'
);

const isLineMember = (member) => (
  member?.authMode === 'line' || member?.authSource === 'LINE'
);

const isProvisionalEmployeeGuest = (member) => (
  isEmployeeGuestMember(member)
  && (
    member?.provisional === true
    || member?.identityState === IDENTITY_FILTERS.PENDING_VERIFICATION
    || member?.verificationStatus === 'UNVERIFIED'
  )
);

export const isHistoricalProvisionalMember = (member) => (
  member?.active === false && (
    isEmployeeGuestMember(member) || isNonLineCanonicalMember(member)
  )
);

export const isActiveProvisionalEmployeeGuest = (member) => (
  member?.active === true && isProvisionalEmployeeGuest(member)
);

export const isEligibleEmployeeBindingTarget = (member) => Boolean(
  member?.userId
  && member?.active === true
  && !hasEmployeeId(member.employeeId)
  && (isLineMember(member) || isActiveProvisionalEmployeeGuest(member))
);

const projectAdminMember = (member) => (
  isActiveProvisionalEmployeeGuest(member)
    ? { ...member, identityState: IDENTITY_FILTERS.BIND_REQUIRED }
    : member
);

export const getAdminMemberRows = (members = []) => (
  (Array.isArray(members) ? members : [])
    .filter((member) => !isHistoricalProvisionalMember(member))
    .map(projectAdminMember)
);

export const getIdentityBadges = ({ authSource, identityState } = {}) => ([
  {
    key: 'authSource',
    value: authSource,
    label: SOURCE_LABELS[authSource] || '登入來源待確認',
    tone: authSource === 'LINE'
      ? 'line'
      : authSource === 'EMPLOYEE_GUEST'
        ? 'guest'
        : authSource === 'EMPLOYEE' || authSource === 'NON_LINE'
          ? 'employee'
          : 'unknown'
  },
  {
    key: 'identityState',
    value: identityState,
    label: STATE_LABELS[identityState] || '身份狀態待確認',
    tone: identityState === 'VERIFIED'
      ? 'verified'
      : identityState === 'PENDING_VERIFICATION'
        ? 'guest'
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
  { value: IDENTITY_FILTERS.VERIFIED, label: '已註冊' }
]);
