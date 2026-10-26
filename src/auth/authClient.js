import { getMockIdentityResponse } from './mockData.js';
import { resolveAuthConfig } from './authMode.js';
import { createDeadline } from './asyncDeadline.js';

const MOCK_SESSION_CREDENTIAL = 'local-mock-session';
const LOCAL_UAT_SESSION_KEY = 'bento-local-uat-access-token-v1';

const readLocalUatToken = () => {
  try {
    return String(globalThis.window?.sessionStorage?.getItem(LOCAL_UAT_SESSION_KEY) || '').trim();
  } catch {
    return '';
  }
};

const writeLocalUatToken = (token) => {
  try {
    globalThis.window?.sessionStorage?.setItem(LOCAL_UAT_SESSION_KEY, token);
  } catch {
    throw Object.assign(new Error('LOCAL_UAT_SESSION_STORAGE_UNAVAILABLE'), {
      code: 'LOCAL_UAT_SESSION_STORAGE_UNAVAILABLE'
    });
  }
};

const clearLocalUatToken = () => {
  try {
    globalThis.window?.sessionStorage?.removeItem(LOCAL_UAT_SESSION_KEY);
  } catch {
    // A local UAT session is optional when browser storage is unavailable.
  }
};

// OAuth callback parameters must never ride along into a new login attempt:
// a stale code/state pair makes LIFF consume an already-used authorization
// and the LINE "continue" step appears to do nothing (Android in-app browser).
const OAUTH_CALLBACK_PARAMS = ['code', 'state', 'liffClientId', 'liffRedirectUri', 'error', 'error_description'];

export const buildCleanLoginRedirectUri = (href) => {
  try {
    const url = new URL(href);
    // A local dev page is not under the LIFF Endpoint URL (dev-start points that
    // at the Pinggy tunnel), so LINE rejects it as an invalid redirect (400).
    // Let LIFF use its own default there.
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined;
    for (const key of OAUTH_CALLBACK_PARAMS) url.searchParams.delete(key);
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
};

export const createAuthClient = ({ env = {}, liffClient, logger = console, fetchImpl = globalThis.fetch } = {}) => {
  if (!liffClient) {
    throw new Error('A LIFF client is required');
  }

  const config = resolveAuthConfig(env);
  let liffInitPromise = null;
  logger.info?.(`[AUTH] mode=${config.mode}${config.mode === 'mock' ? ` user=${config.mockUser}` : ''}`);

  return {
    ...config,
    isMock: config.mode === 'mock',

    getMockIdentity() {
      return getMockIdentityResponse(config.mockUser);
    },

    async init() {
      if (config.mode === 'mock' || config.isLocalUat) return;
      if (!config.liffId) throw new Error('Missing VITE_LIFF_ID');
      if (!liffInitPromise) {
        const timeoutError = Object.assign(new Error('LINE 初始化逾時，請按重新連線。'), {
          code: 'LIFF_INIT_TIMEOUT'
        });
        const deadline = createDeadline({ timeoutMs: 15000, error: timeoutError });
        const attempt = deadline.wait(() => liffClient.init({ liffId: config.liffId }))
          .catch((error) => {
            if (liffInitPromise === attempt) liffInitPromise = null;
            throw error;
          })
          .finally(() => deadline.dispose());
        liffInitPromise = attempt;
      }
      await liffInitPromise;
    },

    isLoggedIn() {
      if (config.mode === 'mock') return true;
      if (config.isLocalUat) return Boolean(readLocalUatToken());
      return liffClient.isLoggedIn();
    },

    isInClient() {
      return config.mode === 'mock' || config.isLocalUat ? false : liffClient.isInClient();
    },

    login() {
      if (config.mode !== 'mock' && !config.isLocalUat) {
        const redirectUri = buildCleanLoginRedirectUri(globalThis.window?.location?.href);
        return liffClient.login(redirectUri ? { redirectUri } : undefined);
      }
      return undefined;
    },

    getAccessToken() {
      if (config.mode === 'mock') return MOCK_SESSION_CREDENTIAL;
      if (config.isLocalUat) return readLocalUatToken();
      return liffClient.getAccessToken();
    },

    async loginLocalUat({ role, password } = {}) {
      if (!config.isLocalUat) {
        throw Object.assign(new Error('LOCAL_UAT_MODE_DISABLED'), { code: 'LOCAL_UAT_MODE_DISABLED' });
      }
      let sessionUrl;
      try {
        sessionUrl = new URL('/__local-uat/session', env.VITE_WORKER_API_URL).toString();
      } catch {
        throw Object.assign(new Error('LOCAL_UAT_WORKER_URL_INVALID'), { code: 'LOCAL_UAT_WORKER_URL_INVALID' });
      }
      let response;
      try {
        response = await fetchImpl(sessionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ role, password })
        });
      } catch {
        throw Object.assign(new Error('LOCAL_UAT_WORKER_UNAVAILABLE'), { code: 'LOCAL_UAT_WORKER_UNAVAILABLE' });
      }
      let body = {};
      try { body = await response.json(); } catch { /* Preserve the HTTP failure code. */ }
      if (!response.ok || typeof body?.accessToken !== 'string' || !body.accessToken) {
        throw Object.assign(new Error(body?.error || 'LOCAL_UAT_LOGIN_REJECTED'), {
          code: body?.error || 'LOCAL_UAT_LOGIN_REJECTED',
          requestId: response.headers.get('X-Request-Id') || null
        });
      }
      writeLocalUatToken(body.accessToken);
      return { role: body.role || role };
    },

    logoutLocalUat() {
      if (config.isLocalUat) clearLocalUatToken();
    }
  };
};
