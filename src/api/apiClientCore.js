import {
  ApiAuthenticationError,
  ApiAuthorizationError,
  ApiBackendError,
  ApiConfigurationError,
  ApiContractGapError
} from './apiErrors.js';
import { API_TRANSPORTS, resolveApiTransportConfig } from './transportConfig.js';

const WORKER_GAP_REASONS = Object.freeze({
  getBalanceHistory: 'Formal balance history exists, but its opening-policy boundary and response contract need a reviewed frontend adapter.',
  getAdminSummary: 'Formal admin summary exists, but its GET/View As query contract is not yet wired to the current GAS-shaped caller.',
  toggleLike: 'Formal like mutation exists, but its idempotency-free toggle semantics and response contract need a reviewed frontend adapter.',
  submitOrder: 'Formal order mutation exists, but the current UI does not provide the formal idempotency-key contract.',
  cancelOrder: 'Formal order cancellation exists, but the current UI does not provide the formal idempotency-key contract.',
  assignRole: 'No current React caller or approved frontend adapter exists for formal role assignment.'
});

const readToken = (authClient, operation) => {
  const token = authClient?.getAccessToken?.();
  if (!token) {
    throw new ApiAuthenticationError(
      'API_AUTH_REQUIRED',
      'An authenticated access token is required.',
      { operation }
    );
  }
  return token;
};

const queryEntries = (query = {}) => Object.entries(query)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => [key, String(value)]);

const buildWorkerUrl = (baseUrl, path, query) => {
  const url = new URL(`${baseUrl}${path}`);
  queryEntries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
};

const calendarMode = (vendor, mode) => {
  const explicitMode = String(mode || '').trim().toUpperCase();
  if (explicitMode) return explicitMode;
  const normalizedVendor = String(vendor || '').trim();
  return normalizedVendor === '禾拾' || normalizedVendor === '合十' ? 'B' : 'A';
};

const createWorkerRequest = ({ baseUrl, authClient, fetchImpl }) => async (
  operation,
  method,
  path,
  { query, body, extraHeaders = {} } = {}
) => {
  const token = readToken(authClient, operation);
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...extraHeaders
  };
  const options = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchImpl(buildWorkerUrl(baseUrl, path, query), options);
  } catch {
    throw new ApiBackendError(
      'API_REQUEST_FAILED',
      'Worker API request failed.',
      { operation }
    );
  }

  if (response.status === 401) {
    throw new ApiAuthenticationError(
      'API_AUTH_REJECTED',
      'Worker API authentication failed.',
      { operation, status: response.status }
    );
  }
  if (response.status === 403) {
    let errorCode = 'API_AUTHORIZATION_REJECTED';
    try {
      const body = await response.clone().json();
      if (typeof body?.error === 'string' && body.error.trim()) errorCode = body.error.trim();
    } catch {
      // Preserve the typed authorization category when the error body is not JSON.
    }
    throw new ApiAuthorizationError(
      errorCode,
      'Worker API authorization failed.',
      { operation, status: response.status }
    );
  }
  if (!response.ok) {
    throw new ApiBackendError(
      'API_HTTP_ERROR',
      'Worker API returned an unsuccessful response.',
      { operation, status: response.status }
    );
  }
  return response;
};

const contractGap = (operation, code = 'WORKER_CONTRACT_MISSING') => {
  throw new ApiContractGapError(
    code,
    operation,
    WORKER_GAP_REASONS[operation] || `No approved Worker adapter exists for ${operation}.`
  );
};

const createGasOperations = ({ gasApi, authClient }) => ({
  getIdentity: () => gasApi.post({
    action: 'getUserInfo',
    accessToken: readToken(authClient, 'getIdentity')
  }),
  getBootstrap: ({ bootId } = {}) => gasApi.post({
    action: 'getBootstrapData',
    accessToken: readToken(authClient, 'getBootstrap'),
    bootId,
    deferUiData: true
  }),
  getDeferredBootstrap: ({ bootId } = {}) => gasApi.post({
    action: 'getDeferredBootstrapData',
    accessToken: readToken(authClient, 'getDeferredBootstrap'),
    bootId
  }),
  register: ({ pickupFloor } = {}) => gasApi.post({
    action: 'registerUser',
    accessToken: readToken(authClient, 'register'),
    pickupFloor
  }),
  getCalendar: ({ userId } = {}) => gasApi.get(
    `?action=getCalendarEvents&userId=${userId || ''}&t=${Date.now()}`
  ),
  getOrdersMap: ({ userId } = {}) => gasApi.get(
    `?action=getUserAllOrdersMap&userId=${encodeURIComponent(userId || '')}&t=${Date.now()}`
  ),
  getOrderPage: ({ userId, targetDate } = {}) => gasApi.get(
    `?action=getOrderPageData&targetDate=${encodeURIComponent(targetDate || '')}&userId=${encodeURIComponent(userId || '')}&t=${Date.now()}`
  ),
  getBalanceHistory: ({ year, month } = {}) => gasApi.post({
    action: 'getBalanceHistoryByMonth',
    accessToken: readToken(authClient, 'getBalanceHistory'),
    year,
    month
  }),
  getAdminSummary: ({ targetDate, includeMemberBalances = false } = {}) => gasApi.post({
    action: 'getAdminSummary',
    accessToken: readToken(authClient, 'getAdminSummary'),
    targetDate,
    includeMemberBalances
  }),
  getMemberBalances: () => gasApi.post({
    action: 'getMemberBalances',
    accessToken: readToken(authClient, 'getMemberBalances')
  }),
  toggleLike: ({ date, userId } = {}) => gasApi.post({
    action: 'toggleLike',
    date,
    accessToken: readToken(authClient, 'toggleLike'),
    userId
  }),
  setCalendarVendor: ({ adminUserId, dateStr, vendor } = {}) => gasApi.post({
    action: 'adminSetVendor',
    accessToken: readToken(authClient, 'setCalendarVendor'),
    adminUserId,
    dateStr,
    vendor
  }),
  submitOrder: ({ userId, pickup_floor, target_date, items, note } = {}) => gasApi.post({
    action: 'submitOrder',
    accessToken: readToken(authClient, 'submitOrder'),
    userId,
    pickup_floor,
    target_date,
    items,
    note
  }),
  cancelOrder: ({ userId, orderId, date } = {}) => gasApi.post({
    action: 'cancelOrder',
    accessToken: readToken(authClient, 'cancelOrder'),
    userId,
    orderId,
    date
  }),
  updatePickupFloor: ({ pickupFloor } = {}) => gasApi.post({
    action: 'updateMyPickupFloor',
    accessToken: readToken(authClient, 'updatePickupFloor'),
    pickupFloor
  }),
  topUpBalance: ({ adminUserId, targetUserId, amount, note } = {}) => gasApi.post({
    action: 'topUpBalance',
    accessToken: readToken(authClient, 'topUpBalance'),
    adminUserId,
    targetUserId,
    amount,
    note
  })
});

const createWorkerOperations = ({ workerRequest }) => ({
  getIdentity: () => workerRequest('getIdentity', 'GET', '/api/me'),
  getBootstrap: async ({ bootId, targetDate } = {}) => {
    // The formal bootstrap route is registered-only. Read canonical identity
    // first so an authenticated unregistered user reaches registration.
    const identityResponse = await workerRequest('getIdentity', 'GET', '/api/me');
    let identity;
    try {
      identity = await identityResponse.clone().json();
    } catch {
      identity = null;
    }
    if (identity?.success && identity.registered === false) return identityResponse;

    return workerRequest(
      'getBootstrap',
      'GET',
      '/api/bootstrap',
      { query: { bootId, targetDate } }
    );
  },
  getDeferredBootstrap: ({ bootId } = {}) => workerRequest(
    'getDeferredBootstrap',
    'GET',
    '/api/bootstrap/deferred',
    { query: { bootId } }
  ),
  register: ({ pickupFloor } = {}) => workerRequest(
    'register',
    'POST',
    '/api/register',
    { body: { pickupFloor } }
  ),
  getCalendar: () => workerRequest('getCalendar', 'GET', '/api/calendar'),
  getOrdersMap: () => workerRequest('getOrdersMap', 'GET', '/api/orders/map'),
  getOrderPage: ({ targetDate } = {}) => workerRequest(
    'getOrderPage',
    'GET',
    '/api/order-page',
    { query: { targetDate } }
  ),
  updatePickupFloor: ({ pickupFloor } = {}) => workerRequest(
    'updatePickupFloor',
    'PATCH',
    '/api/me/pickup-floor',
    { body: { pickupFloor } }
  ),
  getBalanceHistory: async () => contractGap('getBalanceHistory', 'ADAPTER_REQUIRED'),
  getAdminSummary: async () => contractGap('getAdminSummary', 'ADAPTER_REQUIRED'),
  getMemberBalances: () => workerRequest(
    'getMemberBalances',
    'GET',
    '/api/admin/members/balances'
  ),
  toggleLike: async () => contractGap('toggleLike', 'ADAPTER_REQUIRED'),
  setCalendarVendor: ({ dateStr, vendor, mode } = {}) => workerRequest(
    'setCalendarVendor',
    'PUT',
    `/api/admin/calendar/${encodeURIComponent(String(dateStr || '').trim())}`,
    { body: { vendor, mode: calendarMode(vendor, mode) } }
  ),
  submitOrder: async () => contractGap('submitOrder', 'ADAPTER_REQUIRED'),
  cancelOrder: async () => contractGap('cancelOrder', 'ADAPTER_REQUIRED'),
  topUpBalance: ({ targetUserId, amount, note, idempotencyKey } = {}) => workerRequest(
    'topUpBalance',
    'POST',
    '/api/admin/balances/top-up',
    {
      extraHeaders: { 'Idempotency-Key': String(idempotencyKey || '').trim() },
      body: { targetUserId, amount, note }
    }
  )
});

export const createApiClient = ({
  env = {},
  authClient,
  gasApi = null,
  fetchImpl = globalThis.fetch
} = {}) => {
  if (!authClient || typeof authClient.getAccessToken !== 'function') {
    throw new ApiConfigurationError('AUTH_CLIENT_MISSING', 'An auth client is required.');
  }

  const config = resolveApiTransportConfig(env, { isMock: Boolean(authClient.isMock) });
  if (config.transport !== API_TRANSPORTS.WORKER) {
    if (!gasApi || typeof gasApi.get !== 'function' || typeof gasApi.post !== 'function') {
      throw new ApiConfigurationError('GAS_API_MISSING', 'A GAS API adapter is required.');
    }
    return Object.freeze({
      transport: config.transport,
      ...createGasOperations({ gasApi, authClient })
    });
  }

  if (typeof fetchImpl !== 'function') {
    throw new ApiConfigurationError('FETCH_UNAVAILABLE', 'A fetch implementation is required.');
  }

  const workerRequest = createWorkerRequest({
    baseUrl: config.workerApiUrl,
    authClient,
    fetchImpl
  });
  return Object.freeze({
    transport: config.transport,
    ...createWorkerOperations({ workerRequest })
  });
};
