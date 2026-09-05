import { authClient } from '../auth/liffClient.js';
import { createMockGasApi } from './mockGasApi.js';

const GAS_API_URL = import.meta.env.VITE_GAS_API_URL;
const mockGasApi = authClient.isMock ? createMockGasApi({ mockUser: authClient.mockUser }) : null;

if (!authClient.isMock && !GAS_API_URL) {
  throw new Error('Missing VITE_GAS_API_URL');
}

export const gasGet = (query) => (
  mockGasApi ? mockGasApi.get(query) : fetch(`${GAS_API_URL}${query}`)
);

export const gasPost = (payload) => (
  mockGasApi
    ? mockGasApi.post(payload)
    : fetch(GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    })
);
