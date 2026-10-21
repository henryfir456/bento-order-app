export const MOCK_USER_KEYS = Object.freeze([
  'user',
  'admin',
  'vendor',
  'proxy-admin',
  'admin-unverified',
  'admin-unbound',
  'guest-admin',
  'unregistered'
]);

const DEFAULT_MOCK_USER = 'user';

export const resolveAuthConfig = (env = {}) => {
  const requestedMode = String(env.VITE_AUTH_MODE || '').trim().toLowerCase();
  const isMock = Boolean(env.DEV) && requestedMode === 'mock';
  const isLocalUat = Boolean(env.DEV) && requestedMode === 'local-uat';
  const requestedMockUser = String(env.VITE_MOCK_USER || DEFAULT_MOCK_USER).trim().toLowerCase();

  return Object.freeze({
    mode: isMock ? 'mock' : isLocalUat ? 'local-uat' : 'liff',
    isMock,
    isLocalUat,
    mockUser: MOCK_USER_KEYS.includes(requestedMockUser) ? requestedMockUser : DEFAULT_MOCK_USER,
    liffId: String(env.VITE_LIFF_ID || '').trim()
  });
};
