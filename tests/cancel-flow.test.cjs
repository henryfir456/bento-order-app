const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');
const readSource = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const appSource = readSource('src', 'App.jsx');
const modalSource = readSource('src', 'features', 'orders', 'OrderConfirmationModal.jsx');

const extractHandler = (source, name) => {
  const start = source.indexOf(`const ${name} = async () => {`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf('\n  };', start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return source.slice(start, end + '\n  };'.length);
};

test('cancel details preserve the existing order fields used by the confirmation modal', async () => {
  const { buildExistingOrderSubmission, buildOrderSubmission } = await import(
    pathToFileURL(path.join(repoRoot, 'src', 'features', 'orders', 'orderSubmission.js')).href
  );
  const submission = buildOrderSubmission({
    menu: [{ item_id: 'menu-a', item_name: 'Tofu Bento', price: 80 }],
    orderItems: { 'menu-a': 2 },
    selectedDate: '2026-09-10',
    floor: '9樓',
    note: '少飯',
    vendor: 'Vendor A'
  });

  assert.deepEqual(submission, {
    targetDate: '2026-09-10',
    vendor: 'Vendor A',
    pickupFloor: '9樓',
    items: [{
      item_id: 'menu-a',
      item_name: 'Tofu Bento',
      quantity: 2,
      unit_price: 80
    }],
    note: '少飯',
    totalCount: 2,
    totalAmount: 160
  });

  const existing = buildExistingOrderSubmission({
    order: {
      vendor: 'Stored Vendor',
      pickup_floor: '9樓',
      note: 'stored note',
      totalAmount: 170,
      items: [{
        item_id: 'menu-a',
        item_name: 'Stored Tofu Bento',
        quantity: 2,
        unit_price: 85,
        subtotal: 170
      }]
    },
    selectedDate: '2026-09-10',
    vendor: 'Current Vendor',
    fallbackFloor: '1樓'
  });

  assert.deepEqual(existing, {
    targetDate: '2026-09-10',
    vendor: 'Stored Vendor',
    pickupFloor: '9樓',
    items: [{
      item_id: 'menu-a',
      item_name: 'Stored Tofu Bento',
      quantity: 2,
      unit_price: 85,
      subtotal: 170
    }],
    note: 'stored note',
    totalCount: 2,
    totalAmount: 170
  });
});

test('cancel click only opens confirmation and never calls the API directly', () => {
  const handler = extractHandler(appSource, 'handleCancelOrder');
  assert.match(handler, /setShowCancelConfirmation\(true\)/);
  assert.doesNotMatch(handler, /apiClient\.cancelOrder/);
  assert.doesNotMatch(handler, /getStableClientRequestKey/);
  assert.doesNotMatch(handler, /setOrderItems\(\{\}\)|setActiveOrderId\(['"]['"]\)|setHasExistingOrder\(false\)/);
});

test('cancel confirmation modal exposes order details, back, confirm, and pending labels', () => {
  assert.match(modalSource, /submission\.vendor/);
  assert.match(modalSource, /title = ['"]確認訂單['"]/);
  assert.match(modalSource, /單價/);
  assert.match(modalSource, /cancelLabel/);
  assert.match(modalSource, /confirmLabel/);
  assert.match(modalSource, /loadingLabel/);
  assert.match(modalSource, /error/);
  assert.match(modalSource, /onCancel/);
  assert.match(modalSource, /onConfirm/);
});

test('cancel confirmation sends one idempotent request, refreshes, then shows success before leaving', () => {
  const handler = extractHandler(appSource, 'handleConfirmCancel');
  assert.equal((handler.match(/apiClient\.cancelOrder/g) || []).length, 1);
  assert.match(handler, /orderCancelRequestRef/);
  assert.match(handler, /setLoading\(true\)/);
  assert.match(handler, /setAuthUser\(prev => prev \? \{ \.\.\.prev, balance: data\.newBalance \} : prev\)/);
  assert.match(handler, /Promise\.all\(\[[\s\S]*fetchCalendarEvents\([\s\S]*fetchUserAllOrders/);
  assert.match(handler, /title: ['"]取消訂單完成['"]/);
  assert.match(handler, /handleExitToCalendar\(\)/);
});

test('cancel confirmation is wired as a second stateful modal and keeps failure in place', () => {
  assert.match(appSource, /showCancelConfirmation/);
  assert.match(appSource, /<OrderConfirmationModal[\s\S]*showCancelConfirmation/);
  assert.match(appSource, /title=['"]確認取消訂單['"]/);
  assert.match(appSource, /confirmLabel=['"]確認取消['"]/);
  assert.match(appSource, /cancelLabel=['"]返回['"]/);
  assert.match(appSource, /cancelError/);
  assert.match(appSource, /submission=\{activeOrderSnapshot \|\| orderSubmission\}/);
  assert.match(appSource, /getApiErrorPresentation/);
  assert.match(appSource, /cancelError[\s\S]*setShowCancelConfirmation\(false\)/);
});

test('Worker cancel adapter keeps the body-less contract', async () => {
  const { createApiClient } = await import(
    pathToFileURL(path.join(repoRoot, 'src', 'api', 'apiClientCore.js')).href
  );
  const calls = [];
  const client = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test'
    },
    authClient: { getAccessToken: () => 'line-token' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ success: true });
    }
  });

  await client.cancelOrder({ orderId: 'ORD-1', idempotencyKey: 'cancel-key' });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/api/orders/ORD-1/cancel');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer line-token');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'cancel-key');
  assert.equal(calls[0].options.headers['Content-Type'], undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].options, 'body'), false);
});

test('Worker transport maps server JSON and actual fetch failures separately', async () => {
  const { createApiClient } = await import(
    pathToFileURL(path.join(repoRoot, 'src', 'api', 'apiClientCore.js')).href
  );
  const { getApiErrorPresentation } = await import(
    pathToFileURL(path.join(repoRoot, 'src', 'api', 'apiErrors.js')).href
  );
  const authClient = { getAccessToken: () => 'line-token' };

  const businessClient = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test'
    },
    authClient,
    fetchImpl: async () => Response.json(
      { error: 'DEADLINE_CLOSED' },
      { status: 400 }
    )
  });
  await assert.rejects(
    () => businessClient.cancelOrder({ orderId: 'ORD-1', idempotencyKey: 'cancel-key' }),
    (error) => getApiErrorPresentation(error, '取消訂單').category === 'business'
  );

  const networkClient = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test'
    },
    authClient,
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    }
  });
  await assert.rejects(
    () => networkClient.cancelOrder({ orderId: 'ORD-1', idempotencyKey: 'cancel-key' }),
    (error) => getApiErrorPresentation(error, '取消訂單').category === 'network'
  );
});

test('frontend API errors remain distinguishable by category', async () => {
  const {
    ApiAuthenticationError,
    ApiAuthorizationError,
    ApiBackendError,
    ApiNetworkError,
    getApiErrorPresentation
  } = await import(pathToFileURL(path.join(repoRoot, 'src', 'api', 'apiErrors.js')).href);

  assert.equal(
    getApiErrorPresentation(new ApiNetworkError('API_REQUEST_FAILED', 'network', { operation: 'cancelOrder' }), '取消訂單').category,
    'network'
  );
  assert.equal(
    getApiErrorPresentation(new ApiBackendError('DEADLINE_CLOSED', 'business', { operation: 'cancelOrder', status: 400 }), '取消訂單').category,
    'business'
  );
  assert.equal(
    getApiErrorPresentation({ kind: 'business', code: 'DEADLINE_CLOSED', status: 200 }, '取消訂單').category,
    'business'
  );
  assert.equal(
    getApiErrorPresentation(new ApiAuthenticationError('API_AUTH_REJECTED', 'auth', { operation: 'cancelOrder', status: 401 }), '取消訂單').category,
    'auth'
  );
  assert.equal(
    getApiErrorPresentation(new ApiAuthorizationError('ORDER_FORBIDDEN', 'authz', { operation: 'cancelOrder', status: 403 }), '取消訂單').category,
    'auth'
  );
  assert.equal(
    getApiErrorPresentation(new ApiBackendError('INTERNAL_SERVER_ERROR', 'server', { operation: 'cancelOrder', status: 500 }), '取消訂單').category,
    'server'
  );
});
