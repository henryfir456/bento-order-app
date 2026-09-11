import {
  ApiAuthenticationError,
  ApiAuthorizationError,
  ApiBackendError,
  ApiConfigurationError,
  ApiNetworkError
} from './apiErrors.js';
import { API_TRANSPORTS, resolveApiTransportConfig } from './transportConfig.js';

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

const readWorkerCredential = (authClient, sessionStore, operation, mode = 'auto') => {
  if (mode === 'none') return null;
  if (mode === 'guest' || mode === 'auto') {
    const guestSession = sessionStore?.getGuestSession?.();
    if (guestSession?.token) return { token: guestSession.token, authMode: 'employee_guest' };
    if (mode === 'guest') {
      throw new ApiAuthenticationError(
        'GUEST_SESSION_INVALID',
        'An active employee guest session is required.',
        { operation }
      );
    }
  }
  return { token: readToken(authClient, operation), authMode: 'line' };
};

const queryEntries = (query = {}) => Object.entries(query)
  .filter(([, value]) => value !== undefined && value !== null && value !== '')
  .map(([key, value]) => [key, String(value)]);

const buildWorkerUrl = (baseUrl, path, query) => {
  const url = new URL(`${baseUrl}${path}`);
  queryEntries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
};

const readWorkerErrorCode = async (response, fallback) => {
  try {
    const body = await response.clone().json();
    if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
  } catch {
    // Preserve the typed error category when the error body is not JSON.
  }
  return fallback;
};

const calendarMode = (vendor, mode) => {
  const explicitMode = String(mode || '').trim().toUpperCase();
  if (explicitMode) return explicitMode;
  const normalizedVendor = String(vendor || '').trim();
  return normalizedVendor === '禾拾' || normalizedVendor === '合十' ? 'B' : 'A';
};

const balanceHistoryMonth = (year, month) => {
  const yearValue = String(year ?? '').trim();
  const monthValue = String(month ?? '').trim();
  if (!yearValue || !monthValue) return '';
  return `${yearValue}-${monthValue.padStart(2, '0')}`;
};

const createWorkerRequest = ({ baseUrl, authClient, sessionStore, fetchImpl }) => async (
  operation,
  method,
  path,
  { query, body, extraHeaders = {}, credentialMode = 'auto' } = {}
) => {
  const credential = readWorkerCredential(authClient, sessionStore, operation, credentialMode);
  const headers = {
    Accept: 'application/json',
    ...extraHeaders
  };
  if (credential?.token) headers.Authorization = `Bearer ${credential.token}`;
  const options = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetchImpl(buildWorkerUrl(baseUrl, path, query), options);
  } catch {
    throw new ApiNetworkError(
      'API_REQUEST_FAILED',
      'Worker API request failed.',
      { operation }
    );
  }

  if (response.status === 401) {
    const errorCode = await readWorkerErrorCode(response, 'API_AUTH_REJECTED');
    if (errorCode === 'GUEST_SESSION_INVALID') {
      sessionStore?.clearGuestSession?.({ reason: 'rejected' });
    }
    throw new ApiAuthenticationError(
      errorCode === 'GUEST_SESSION_INVALID' ? errorCode : 'API_AUTH_REJECTED',
      'Worker API authentication failed.',
      { operation, status: response.status }
    );
  }
  if (response.status === 403) {
    const errorCode = await readWorkerErrorCode(response, 'API_AUTHORIZATION_REJECTED');
    throw new ApiAuthorizationError(
      errorCode,
      'Worker API authorization failed.',
      { operation, status: response.status }
    );
  }
  if (!response.ok) {
    const errorCode = await readWorkerErrorCode(response, 'API_HTTP_ERROR');
    throw new ApiBackendError(
      errorCode,
      'Worker API returned an unsuccessful response.',
      { operation, status: response.status }
    );
  }
  return response;
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
  employeeGuestLogin: ({ employeeId } = {}) => workerRequest(
    'employeeGuestLogin',
    'POST',
    '/api/auth/employee-guest',
    { credentialMode: 'none', body: { employeeId } }
  ),
  completeEmployeeGuestOnboarding: ({ guestToken, displayName, pickupFloor } = {}) => workerRequest(
    'completeEmployeeGuestOnboarding',
    'POST',
    '/api/auth/employee-guest/onboarding',
    {
      credentialMode: 'none',
      body: { displayName, pickupFloor },
      extraHeaders: { 'X-Employee-Guest-Session': String(guestToken || '').trim() }
    }
  ),
  lineEmployeeLookup: ({ employeeId } = {}) => workerRequest(
    'lineEmployeeLookup',
    'POST',
    '/api/auth/line-employee-lookup',
    { credentialMode: 'line', body: { employeeId } }
  ),
  lineEmployeeBind: ({ employeeId, displayName, pickupFloor } = {}) => workerRequest(
    'lineEmployeeBind',
    'POST',
    '/api/auth/line-employee-bind',
    {
      credentialMode: 'line',
      body: { employeeId, displayName, pickupFloor }
    }
  ),
  bindLine: ({ guestToken, displayName, pickupFloor } = {}) => workerRequest(
    'bindLine',
    'POST',
    '/api/auth/line-bind',
    {
      credentialMode: 'line',
      ...((displayName || pickupFloor) ? {
        body: { displayName, pickupFloor }
      } : {}),
      extraHeaders: { 'X-Employee-Guest-Session': String(guestToken || '').trim() }
    }
  ),
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
  getCalendar: ({ viewAsUserId } = {}) => workerRequest(
    'getCalendar',
    'GET',
    '/api/calendar',
    { query: { viewAs: viewAsUserId } }
  ),
  getOrdersMap: ({ viewAsUserId } = {}) => workerRequest(
    'getOrdersMap',
    'GET',
    '/api/orders/map',
    { query: { viewAs: viewAsUserId } }
  ),
  getOrderPage: ({ targetDate, viewAsUserId } = {}) => workerRequest(
    'getOrderPage',
    'GET',
    '/api/order-page',
    { query: { targetDate, viewAs: viewAsUserId } }
  ),
  updatePickupFloor: ({ displayName, pickupFloor } = {}) => workerRequest(
    'updatePickupFloor',
    'PATCH',
    '/api/me/pickup-floor',
    { body: { displayName, pickupFloor } }
  ),
  getBalanceHistory: ({ year, month, viewAsUserId } = {}) => workerRequest(
    'getBalanceHistory',
    'GET',
    '/api/me/balance/history',
    { query: { month: balanceHistoryMonth(year, month), viewAs: viewAsUserId } }
  ),
  getAdminSummary: ({ targetDate, includeMemberBalances = false, viewAsUserId } = {}) => workerRequest(
    'getAdminSummary',
    'GET',
    '/api/admin/summary',
    { query: { date: targetDate, includeMemberBalances, viewAs: viewAsUserId } }
  ),
  getAdminAnnouncements: () => workerRequest(
    'getAdminAnnouncements',
    'GET',
    '/api/admin/announcements'
  ),
  createAdminAnnouncement: (payload = {}) => workerRequest(
    'createAdminAnnouncement',
    'POST',
    '/api/admin/announcements',
    { body: payload }
  ),
  updateAdminAnnouncement: (id, payload = {}) => workerRequest(
    'updateAdminAnnouncement',
    'PATCH',
    `/api/admin/announcements/${encodeURIComponent(String(id || '').trim())}`,
    { body: payload }
  ),
  deleteAdminAnnouncement: (id) => workerRequest(
    'deleteAdminAnnouncement',
    'DELETE',
    `/api/admin/announcements/${encodeURIComponent(String(id || '').trim())}`
  ),
  getMemberBalances: () => workerRequest(
    'getMemberBalances',
    'GET',
    '/api/admin/members/balances'
  ),
  adminBindEmployee: ({ userId, employeeId } = {}) => workerRequest(
    'adminBindEmployee',
    'POST',
    `/api/admin/users/${encodeURIComponent(String(userId || '').trim())}/employee-binding`,
    { credentialMode: 'line', body: { employeeId } }
  ),
  toggleLike: ({ date } = {}) => workerRequest(
    'toggleLike',
    'POST',
    `/api/calendar/${encodeURIComponent(String(date || '').trim())}/like`
  ),
  setCalendarVendor: ({ dateStr, vendor, mode } = {}) => workerRequest(
    'setCalendarVendor',
    'PUT',
    `/api/admin/calendar/${encodeURIComponent(String(dateStr || '').trim())}`,
    { body: { vendor, mode: calendarMode(vendor, mode) } }
  ),
  submitOrder: ({ pickup_floor, target_date, items, note, idempotencyKey } = {}) => workerRequest(
    'submitOrder',
    'POST',
    '/api/orders',
    {
      extraHeaders: { 'Idempotency-Key': String(idempotencyKey || '').trim() },
      body: {
        targetDate: target_date,
        pickupFloor: pickup_floor,
        replaceExisting: true,
        items: Array.isArray(items)
          ? items.map(({ item_id, menu_item_id, quantity }) => ({
            ...(menu_item_id !== undefined ? { menu_item_id } : {}),
            ...(item_id !== undefined ? { item_id } : {}),
            quantity
          }))
          : [],
        note
      }
    }
  ),
  cancelOrder: ({ orderId, idempotencyKey } = {}) => workerRequest(
    'cancelOrder',
    'POST',
    `/api/orders/${encodeURIComponent(String(orderId || '').trim())}/cancel`,
    { extraHeaders: { 'Idempotency-Key': String(idempotencyKey || '').trim() } }
  ),
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
  fetchImpl = globalThis.fetch,
  sessionStore = null
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
    sessionStore,
    fetchImpl
  });
  return Object.freeze({
    transport: config.transport,
    ...createWorkerOperations({ workerRequest })
  });
};
