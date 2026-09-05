import { getMockIdentityResponse } from './mockData.js';
import { resolveAuthConfig } from './authMode.js';

const MOCK_SESSION_CREDENTIAL = 'local-mock-session';

export const createAuthClient = ({ env = {}, liffClient, logger = console } = {}) => {
  if (!liffClient) {
    throw new Error('A LIFF client is required');
  }

  const config = resolveAuthConfig(env);
  logger.info?.(`[AUTH] mode=${config.mode}${config.mode === 'mock' ? ` user=${config.mockUser}` : ''}`);

  return {
    ...config,
    isMock: config.mode === 'mock',

    getMockIdentity() {
      return getMockIdentityResponse(config.mockUser);
    },

    async init() {
      if (config.mode === 'mock') return;
      if (!config.liffId) throw new Error('Missing VITE_LIFF_ID');
      await liffClient.init({ liffId: config.liffId });
    },

    isLoggedIn() {
      return config.mode === 'mock' ? true : liffClient.isLoggedIn();
    },

    isInClient() {
      return config.mode === 'mock' ? false : liffClient.isInClient();
    },

    login() {
      if (config.mode !== 'mock') return liffClient.login();
      return undefined;
    },

    getAccessToken() {
      return config.mode === 'mock' ? MOCK_SESSION_CREDENTIAL : liffClient.getAccessToken();
    }
  };
};
