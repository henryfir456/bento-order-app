import { authClient } from '../auth/liffClient.js';
import { createMockGasApi } from './mockGasApi.js';

export const createGasApi = ({
  env = import.meta.env,
  auth = authClient,
  fetchImpl = globalThis.fetch
} = {}) => {
  const gasApiUrl = String(env.VITE_GAS_API_URL || '').trim();
  let mockStorage;
  if (auth.isMock) {
    try {
      mockStorage = globalThis.localStorage;
    } catch {
      mockStorage = null;
    }
  }
  const mockGasApi = auth.isMock
    ? createMockGasApi({ mockUser: auth.mockUser, storage: mockStorage })
    : null;

  if (!mockGasApi && !gasApiUrl) {
    throw new Error('Missing VITE_GAS_API_URL');
  }

  return {
    get: (query) => (
      mockGasApi ? mockGasApi.get(query) : fetchImpl(`${gasApiUrl}${query}`)
    ),
    post: (payload) => (
      mockGasApi
        ? mockGasApi.post(payload)
        : fetchImpl(gasApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload)
        })
    )
  };
};

let defaultGasApi;
const getDefaultGasApi = () => {
  defaultGasApi ||= createGasApi();
  return defaultGasApi;
};

export const gasGet = (query) => getDefaultGasApi().get(query);
export const gasPost = (payload) => getDefaultGasApi().post(payload);
