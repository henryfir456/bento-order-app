import { authClient } from '../auth/liffClient.js';
import { createAuthSessionStore } from '../auth/sessionStore.js';
import { createGasApi } from './gasApi.js';
import { createApiClient } from './apiClientCore.js';
import { API_TRANSPORTS, resolveApiTransportConfig } from './transportConfig.js';

const env = import.meta.env;
const config = resolveApiTransportConfig(env, { isMock: authClient.isMock });
const gasApi = config.transport === API_TRANSPORTS.WORKER
  ? null
  : createGasApi({ env, auth: authClient });

export const guestSessionStore = createAuthSessionStore();

export const apiClient = createApiClient({
  env,
  authClient,
  gasApi,
  sessionStore: guestSessionStore
});
