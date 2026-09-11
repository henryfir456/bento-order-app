export const AUTH_BOOT_STAGES = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  RESTORE_GUEST: 'RESTORE_GUEST',
  LIFF_CHECK: 'LIFF_CHECK',
  AUTH_GUEST: 'AUTH_GUEST',
  AUTH_LINE: 'AUTH_LINE',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  BIND_LINE: 'BIND_LINE'
});

export const WORKER_AUTH_RESOLUTIONS = Object.freeze({
  CHECK_LINE: 'CHECK_LINE',
  LINE: 'LINE',
  EMPLOYEE_GUEST: 'EMPLOYEE_GUEST',
  LINE_BIND: 'LINE_BIND',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED'
});

// This mirrors the Worker identity contract. authMode remains the
// authentication method; identityState describes canonical-user lifecycle.
export const IDENTITY_STATES = Object.freeze({
  NEW_PROVISIONAL_EMPLOYEE: 'NEW_PROVISIONAL_EMPLOYEE',
  EXISTING_UNVERIFIED_EMPLOYEE: 'EXISTING_UNVERIFIED_EMPLOYEE',
  VERIFIED: 'VERIFIED',
  UNREGISTERED: 'UNREGISTERED'
});

// Guest credentials are a fallback cache. Resolve this only after LIFF has
// been initialized and its authentication state has been checked.
export const resolveWorkerAuthResolution = ({
  hasGuestSession = false,
  hasBindIntent = false,
  lineAuthState = 'unknown'
} = {}) => {
  if (hasBindIntent && hasGuestSession) {
    return lineAuthState === 'authenticated'
      ? WORKER_AUTH_RESOLUTIONS.LINE_BIND
      : WORKER_AUTH_RESOLUTIONS.LOGIN_REQUIRED;
  }
  if (lineAuthState === 'authenticated') return WORKER_AUTH_RESOLUTIONS.LINE;
  if (lineAuthState === 'anonymous' || lineAuthState === 'unavailable') {
    return hasGuestSession
      ? WORKER_AUTH_RESOLUTIONS.EMPLOYEE_GUEST
      : WORKER_AUTH_RESOLUTIONS.LOGIN_REQUIRED;
  }
  return WORKER_AUTH_RESOLUTIONS.CHECK_LINE;
};

export const resolveAuthBootPlan = ({
  transport = 'gas',
  hasGuestSession = false,
  hasBindIntent = false,
  isLoggedIn = false
} = {}) => {
  const plan = [AUTH_BOOT_STAGES.UNKNOWN];
  if (transport === 'worker') plan.push(AUTH_BOOT_STAGES.LIFF_CHECK);

  if (transport === 'worker') {
    const resolution = resolveWorkerAuthResolution({
      hasGuestSession,
      hasBindIntent,
      lineAuthState: isLoggedIn ? 'authenticated' : 'anonymous'
    });
    if (resolution === WORKER_AUTH_RESOLUTIONS.EMPLOYEE_GUEST) {
      plan.push(AUTH_BOOT_STAGES.RESTORE_GUEST, AUTH_BOOT_STAGES.AUTH_GUEST);
      return plan;
    }
    if (resolution === WORKER_AUTH_RESOLUTIONS.LINE_BIND) {
      plan.push(AUTH_BOOT_STAGES.RESTORE_GUEST, AUTH_BOOT_STAGES.BIND_LINE);
      return plan;
    }
    plan.push(
      resolution === WORKER_AUTH_RESOLUTIONS.LINE
        ? AUTH_BOOT_STAGES.AUTH_LINE
        : AUTH_BOOT_STAGES.LOGIN_REQUIRED
    );
    return plan;
  }

  if (transport !== 'worker') plan.push(AUTH_BOOT_STAGES.LIFF_CHECK);
  plan.push(isLoggedIn ? AUTH_BOOT_STAGES.AUTH_LINE : AUTH_BOOT_STAGES.LOGIN_REQUIRED);
  return plan;
};
