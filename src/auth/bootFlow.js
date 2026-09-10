export const AUTH_BOOT_STAGES = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  RESTORE_GUEST: 'RESTORE_GUEST',
  LIFF_CHECK: 'LIFF_CHECK',
  AUTH_GUEST: 'AUTH_GUEST',
  AUTH_LINE: 'AUTH_LINE',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  BIND_LINE: 'BIND_LINE'
});

export const resolveAuthBootPlan = ({
  transport = 'gas',
  hasGuestSession = false,
  hasBindIntent = false,
  isLoggedIn = false
} = {}) => {
  const plan = [AUTH_BOOT_STAGES.UNKNOWN];
  if (transport === 'worker') plan.push(AUTH_BOOT_STAGES.RESTORE_GUEST);

  if (transport === 'worker') plan.push(AUTH_BOOT_STAGES.LIFF_CHECK);

  if (transport === 'worker' && hasGuestSession) {
    plan.push(AUTH_BOOT_STAGES.AUTH_GUEST);
    if (hasBindIntent) {
      plan.push(isLoggedIn ? AUTH_BOOT_STAGES.BIND_LINE : AUTH_BOOT_STAGES.LOGIN_REQUIRED);
    }
    return plan;
  }

  if (transport !== 'worker') plan.push(AUTH_BOOT_STAGES.LIFF_CHECK);
  plan.push(isLoggedIn ? AUTH_BOOT_STAGES.AUTH_LINE : AUTH_BOOT_STAGES.LOGIN_REQUIRED);
  return plan;
};
