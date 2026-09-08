import { ApiConfigurationError } from './apiErrors.js';

export const API_TRANSPORTS = Object.freeze({
  GAS: 'gas',
  WORKER: 'worker',
  MOCK: 'mock'
});

const normalizeValue = (value) => String(value || '').trim();

const normalizeHttpUrl = (value, code, label) => {
  const normalized = normalizeValue(value);
  if (!normalized) {
    throw new ApiConfigurationError(
      code.replace('_INVALID', '_MISSING'),
      `${label} is required.`
    );
  }
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new ApiConfigurationError(code, `${label} must be a valid HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ApiConfigurationError(code, `${label} must use HTTP(S).`);
  }
  return normalized.replace(/\/+$/, '');
};

export const resolveApiTransportConfig = (env = {}, { isMock = false } = {}) => {
  const requestedTransport = normalizeValue(env.VITE_API_TRANSPORT).toLowerCase() || API_TRANSPORTS.GAS;
  if (![API_TRANSPORTS.GAS, API_TRANSPORTS.WORKER].includes(requestedTransport)) {
    throw new ApiConfigurationError(
      'API_TRANSPORT_INVALID',
      'VITE_API_TRANSPORT must be either gas or worker.'
    );
  }

  if (isMock && requestedTransport === API_TRANSPORTS.WORKER) {
    throw new ApiConfigurationError(
      'API_TRANSPORT_MOCK_CONFLICT',
      'Mock auth cannot be combined with Worker transport.'
    );
  }

  if (isMock) {
    return Object.freeze({
      requestedTransport,
      transport: API_TRANSPORTS.MOCK,
      gasApiUrl: ''
    });
  }

  if (requestedTransport === API_TRANSPORTS.GAS) {
    const gasApiUrl = normalizeValue(env.VITE_GAS_API_URL);
    if (!gasApiUrl) {
      throw new ApiConfigurationError('GAS_API_URL_MISSING', 'Missing VITE_GAS_API_URL.');
    }
    return Object.freeze({
      requestedTransport,
      transport: API_TRANSPORTS.GAS,
      gasApiUrl
    });
  }

  return Object.freeze({
    requestedTransport,
    transport: API_TRANSPORTS.WORKER,
    workerApiUrl: normalizeHttpUrl(
      env.VITE_WORKER_API_URL,
      'WORKER_API_URL_INVALID',
      'VITE_WORKER_API_URL'
    )
  });
};
