import { authClient } from '../auth/liffClient.js';
import { createGasApi } from './gasApi.js';
import { createApiClient } from './apiClientCore.js';
import { API_TRANSPORTS, resolveApiTransportConfig } from './transportConfig.js';

const env = import.meta.env;
const config = resolveApiTransportConfig(env, { isMock: authClient.isMock });
const gasApi = config.transport === API_TRANSPORTS.WORKER
  ? null
  : createGasApi({ env, auth: authClient });

export const apiClient = createApiClient({
  env,
  authClient,
  gasApi
});
