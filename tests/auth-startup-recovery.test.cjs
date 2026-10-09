const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deferred, flush } = require('./helpers/deferred.cjs');
const { createHarness } = require('./helpers/app-auth-harness.cjs');

const identity = (id = 'line-user', mode = 'line') => ({
  success: true, registered: true, authMode: mode,
  user: { userId: id, role: 'User', identityState: 'VERIFIED' }, calendar: { events: {} }, ordersMap: {}
});
const response = (body) => new Response(JSON.stringify(body));
const makeStore = () => {
  let guest = null, intent = null;
  const listeners = new Set();
  return {
    getGuestSession: () => guest,
    setGuestSession: (x) => { guest = x; },
    clearGuestSession: () => { guest = null; },
    hasBindIntent: () => intent !== null,
    getBindIntent: () => intent || {},
    setBindIntent: (x = {}) => { intent = x; },
    clearBindIntent: () => { intent = null; },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    invalidate: () => {
      guest = null;
      listeners.forEach((fn) => fn({ type: 'guest-session-invalid' }));
    }
  };
};
const makeApp = (overrides = {}) => {
  const store = overrides.store || makeStore();
  const authClient = {
    isMock: false, init: async () => {}, isLoggedIn: () => true,
    isInClient: () => true, getAccessToken: () => 'line-token', login() { throw new Error('unexpected redirect'); },
    ...overrides.authClient
  };
  const apiClient = {
    transport: 'worker', getBootstrap: async () => response(identity()),
    getDeferredBootstrap: async ({ bootId }) => response({ success: true, bootId, likes: {}, announcements: [] }),
    ...overrides.apiClient
  };
  return createHarness({ authClient, apiClient, store });
};

test('LIFF pending expires, retry is shared, late rejection cannot clear the new attempt', async (t) => {
  const { createAuthClient } = await import('../src/auth/authClient.js');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const old = deferred(), fresh = deferred();
  let calls = 0;
  const auth = createAuthClient({ env: { VITE_LIFF_ID: 'test' }, logger: {},
    liffClient: { init: () => (++calls === 1 ? old.promise : fresh.promise) } });
  const first = auth.init();
  const rejected = assert.rejects(first, (e) => e.code === 'LIFF_INIT_TIMEOUT');
  await flush(); t.mock.timers.tick(16000); await flush();
  await rejected;
  const second = auth.init(), duplicate = auth.init();
  await flush(); old.reject(new Error('late old error')); await flush();
  const third = auth.init();
  assert.equal(calls, 2);
  fresh.resolve(); await Promise.all([second, duplicate, third]);
  await auth.init(); assert.equal(calls, 2);
});

test('actual App boot expires and manual retry ignores late bootstrap settlement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stale = deferred(); let calls = 0;
  const app = makeApp({ apiClient: { getBootstrap: () => ++calls === 1 ? stale.promise : Promise.resolve(response(identity('fresh'))) } });
  await app.settle();
  t.mock.timers.tick(60000); await app.settle();
  assert.equal(app.view.authState, 'AUTH_FAILED');
  assert.equal(app.view.loading, false);
  await app.view.initLiffAndFetchData({ force: true }); await app.settle();
  stale.resolve(response(identity('stale'))); await app.settle();
  assert.equal(app.view.authUser.userId, 'fresh');
  app.destroy();
});

test('OAuth/background return while loading is retained and recovers once', async () => {
  const pending = deferred(); let loggedIn = false, calls = 0;
  const app = makeApp({ authClient: {
    init: () => { calls++; return calls === 1 ? pending.promise : Promise.resolve(); },
    isLoggedIn: () => loggedIn
  } });
  await app.settle();
  await app.event('visibilitychange', { hidden: true });
  await app.event('pageshow'); await app.event('focus');
  pending.reject(new Error('first init failed')); loggedIn = true;
  await app.settle();
  assert.equal(app.view.authState, 'REGISTERED');
  assert.equal(calls, 2);
  await app.event('pageshow'); await app.event('focus');
  assert.equal(calls, 2);
  app.destroy();
});

test('online recovery retries init even before isLoggedIn is readable', async () => {
  let calls = 0;
  const app = makeApp({ authClient: {
    init: async () => { if (++calls === 1) throw new Error('offline'); },
    isLoggedIn: () => { if (calls === 1) throw new Error('not initialized'); return true; }
  } });
  await app.settle(); assert.equal(app.view.authState, 'AUTH_FAILED');
  await app.event('online');
  assert.equal(app.view.authState, 'REGISTERED'); assert.equal(calls, 2);
  app.destroy();
});

test('explicit guest selection supersedes pending LINE bootstrap; old cleanup cannot unlock new boot', async () => {
  const old = deferred(), guest = deferred(); let calls = 0;
  const app = makeApp({ apiClient: {
    getBootstrap: () => ++calls === 1 ? old.promise : guest.promise,
    employeeGuestLogin: async () => response({ success: true, authMode: 'employee_guest', token: 'guest-token', expiresAt: '2099-01-01' })
  } });
  await app.settle(); app.view.setEmployeeGuestId('001234'); await app.settle();
  const login = app.view.handleEmployeeGuestLogin(); await app.settle();
  old.resolve(response(identity('old-line'))); await app.settle();
  assert.equal(app.view.authUser, null);
  assert.equal(app.view.loading, true);
  guest.resolve(response(identity('guest', 'employee_guest'))); await login; await app.settle();
  assert.equal(app.view.authMode, 'employee_guest');
  assert.equal(app.view.authUser.userId, 'guest');
  app.destroy();
});

test('bind intent returns without redirect loop and events never duplicate a bind POST', async () => {
  const store = makeStore(); store.setGuestSession({ token: 'guest' }); store.setBindIntent();
  let loggedIn = false, posts = 0, redirects = 0;
  const bind = deferred();
  const app = makeApp({ store, authClient: { isLoggedIn: () => loggedIn, login: () => { redirects++; } },
    apiClient: { bindLine: () => { posts++; return bind.promise; } } });
  await app.settle();
  assert.equal(redirects, 0);
  loggedIn = true;
  await app.event('pageshow'); await app.event('focus'); await app.event('visibilitychange');
  assert.equal(posts, 1);
  bind.resolve(response({ success: true, user: { userId: 'line-user' } })); await app.settle();
  assert.equal(app.view.authState, 'REGISTERED');
  assert.equal(posts, 1); assert.equal(redirects, 0);
  app.destroy();
});

for (const phase of ['fetch', 'identity-body', 'bootstrap-fetch', 'bootstrap-body', 'error-body']) {
  test(`Worker startup ${phase} timeout is bounded and retry succeeds`, async (t) => {
    const { createApiClient } = await import('../src/api/apiClientCore.js');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred(); let retry = false, signal;
    const client = createApiClient({ env: { VITE_WORKER_API_URL: 'https://worker.test' },
      authClient: { getAccessToken: () => 'token' },
      fetchImpl: async (url, options) => {
        signal = options.signal;
        if (retry) return response(identity());
        if (phase === 'fetch' || (phase === 'bootstrap-fetch' && url.includes('/bootstrap'))) return pending.promise;
        if (phase === 'error-body') return new Response(new ReadableStream({ start() {} }), { status: 401 });
        if ((phase === 'identity-body' && url.endsWith('/me')) || (phase === 'bootstrap-body' && url.includes('/bootstrap'))) {
          return new Response(new ReadableStream({ start() {} }));
        }
        return response(identity());
      }
    });
    const first = (async () => { const res = await client.getBootstrap(); return res.json(); })();
    const rejected = assert.rejects(first, (e) => e.code === 'API_REQUEST_TIMEOUT' || e.kind === 'authentication');
    await flush(); t.mock.timers.tick(60000); await flush(); await rejected;
    assert.equal(signal.aborted, true);
    retry = true;
    assert.equal((await (await client.getBootstrap()).json()).success, true);
    pending.resolve(response(identity('stale'))); await flush();
  });
}

test('boot calls share one pending attempt; force replaces it and late error cannot clear fresh loading', async () => {
  const stale = deferred(), fresh = deferred(); let calls = 0;
  const app = makeApp({ apiClient: { getBootstrap: () => ++calls === 1 ? stale.promise : fresh.promise } });
  await app.settle();
  const a = app.view.initLiffAndFetchData(), b = app.view.initLiffAndFetchData();
  assert.equal(a, b); assert.equal(calls, 1);
  const retry = app.view.initLiffAndFetchData({ force: true }); await app.settle();
  stale.reject(new Error('late network failure')); await app.settle();
  assert.equal(app.view.loading, true); assert.equal(app.view.authState, 'AUTH_LOADING');
  assert.equal(calls, 2);
  fresh.resolve(response(identity('fresh'))); await retry; await app.settle();
  assert.equal(app.view.authUser.userId, 'fresh'); app.destroy();
});

test('late employee login cannot replace a newer explicit LINE entry', async () => {
  const employee = deferred(); const store = makeStore(); let redirects = 0;
  const app = makeApp({ store, authClient: { login: () => { redirects++; } },
    apiClient: { employeeGuestLogin: () => employee.promise } });
  await app.settle(); app.view.setEmployeeGuestId('001234'); await app.settle();
  const old = app.view.handleEmployeeGuestLogin(); await app.settle();
  await app.view.handleLineLogin(); await app.settle();
  employee.resolve(response({ success: true, authMode: 'employee_guest', token: 'stale-guest', expiresAt: '2099-01-01' }));
  await old; await app.settle();
  assert.equal(store.getGuestSession(), null);
  assert.equal(app.view.authMode, 'line'); assert.equal(redirects, 0); app.destroy();
});

test('restored guest remains selected when LINE is already logged in', async () => {
  const store = makeStore(); store.setGuestSession({ token: 'guest' });
  let posts = 0;
  const app = makeApp({ store, apiClient: {
    getBootstrap: async () => response(identity('guest', 'employee_guest')),
    bindLine: async () => { posts++; return response({}); }
  } });
  await app.settle(); await app.event('focus'); await app.event('pageshow');
  assert.equal(app.view.authMode, 'employee_guest'); assert.equal(posts, 0); app.destroy();
});

test('ambiguous bind timeout never replays POST on retry or return events', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = makeStore(); store.setGuestSession({ token: 'guest' }); store.setBindIntent();
  let posts = 0;
  const app = makeApp({ store, apiClient: {
    bindLine: () => { posts++; return new Promise(() => {}); },
    getBootstrap: async () => response(identity('guest', 'employee_guest'))
  } });
  await app.settle(); assert.equal(posts, 1); assert.equal(store.hasBindIntent(), false);
  t.mock.timers.tick(60000); await app.settle();
  assert.equal(app.view.authState, 'AUTH_FAILED');
  await app.view.initLiffAndFetchData({ force: true }); await app.settle();
  await app.event('pageshow'); await app.event('focus');
  assert.equal(posts, 1); assert.equal(app.view.authMode, 'employee_guest'); app.destroy();
});

test('visibility alone recovers failed boot; hidden and rapid repeated events do not spin', async () => {
  let calls = 0;
  const app = makeApp({ authClient: { init: async () => { if (++calls < 2) throw new Error('offline'); } } });
  await app.settle(); await app.event('visibilitychange', { hidden: true });
  assert.equal(calls, 1);
  await app.event('visibilitychange'); await app.event('focus'); await app.event('pageshow');
  assert.equal(calls, 2); assert.equal(app.view.authState, 'REGISTERED'); app.destroy();
});

test('StrictMode effect replay and unmount do not apply a revoked boot result', async () => {
  const first = deferred(); let calls = 0;
  const app = makeApp({ apiClient: { getBootstrap: () => ++calls === 1 ? first.promise : Promise.resolve(response(identity('replayed'))) } });
  await app.settle(); app.replayEffects(); await app.settle();
  first.resolve(response(identity('stale'))); await app.settle();
  assert.equal(app.view.authUser.userId, 'replayed');
  app.destroy();
});

test('stale guest rejection cannot erase a newer guest credential', async () => {
  const { createApiClient } = await import('../src/api/apiClientCore.js');
  const store = makeStore(); store.setGuestSession({ token: 'old' });
  const first = deferred();
  const api = createApiClient({ env: { VITE_WORKER_API_URL: 'https://worker.test' },
    authClient: { getAccessToken: () => 'line' }, sessionStore: store, fetchImpl: () => first.promise });
  const request = api.getIdentity();
  const rejected = assert.rejects(request, (e) => e.code === 'GUEST_SESSION_INVALID');
  await flush(); store.setGuestSession({ token: 'new' });
  first.resolve(new Response(JSON.stringify({ error: 'GUEST_SESSION_INVALID' }), { status: 401 }));
  await rejected; assert.equal(store.getGuestSession().token, 'new');
});

test('guest invalidation during login readback releases the employee entry lock', async () => {
  const store = makeStore(); const guestRead = deferred(); let logins = 0;
  const app = makeApp({ store, apiClient: {
    getBootstrap: () => store.getGuestSession()
      ? guestRead.promise.then(() => response(identity('guest', 'employee_guest')))
      : Promise.resolve(response(identity())),
    employeeGuestLogin: async () => {
      logins++;
      return response({ success: true, authMode: 'employee_guest', token: 'guest', expiresAt: '2099-01-01' });
    }
  } });
  await app.settle(); app.view.setEmployeeGuestId('001234'); await app.settle();
  const first = app.view.handleEmployeeGuestLogin(); await app.settle();
  store.invalidate(); await app.settle(); await first;
  assert.equal(app.view.authState, 'AUTH_REQUIRED');
  // A successful credential exchange clears the form; an expired session
  // prompts the user to enter the employee ID again.
  app.view.setEmployeeGuestId('001234'); await app.settle();
  const second = app.view.handleEmployeeGuestLogin(); await app.settle();
  assert.equal(logins, 2);
  guestRead.resolve(); await second; await app.settle();
  assert.equal(app.view.authState, 'REGISTERED'); app.destroy();
});

test('throttled online event is drained after a quick failed resume', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 20000 });
  let calls = 0;
  const app = makeApp({ authClient: { init: async () => { if (++calls < 3) throw new Error('offline'); } } });
  await app.settle(); await app.event('focus');
  assert.equal(calls, 2); assert.equal(app.view.authState, 'AUTH_FAILED');
  await app.event('online'); assert.equal(calls, 2);
  t.mock.timers.tick(1000); await app.settle();
  assert.equal(calls, 3); assert.equal(app.view.authState, 'REGISTERED'); app.destroy();
});

test('late employee binding cannot restore an old guest after session invalidation and LINE entry', async () => {
  const binding = deferred(), store = makeStore();
  const app = makeApp({ store, apiClient: { lineEmployeeBind: () => binding.promise } });
  await app.settle();
  const old = app.view.handleLineEmployeeBind({ employeeId: '001234' }); await app.settle();
  store.invalidate(); await app.settle();
  await app.view.handleLineLogin(); await app.settle();
  binding.resolve(response({ success: true, user: { userId: 'stale' }, authMode: 'employee_guest', token: 'stale', expiresAt: '2099-01-01' }));
  await old; await app.settle();
  assert.equal(store.getGuestSession(), null);
  assert.equal(app.view.authMode, 'line'); assert.equal(app.view.authUser.userId, 'line-user');
  app.destroy();
});

test('late guest onboarding cannot rebootstrap after session invalidation and LINE entry', async () => {
  const onboarding = deferred(), store = makeStore(); let calls = 0;
  store.setGuestSession({ token: 'guest' });
  const app = makeApp({ store, apiClient: {
    getBootstrap: async () => { calls++; return response(identity('user', store.getGuestSession() ? 'employee_guest' : 'line')); },
    completeEmployeeGuestOnboarding: () => onboarding.promise
  } });
  await app.settle();
  const old = app.view.handleEmployeeGuestOnboarding({ displayName: 'Test', pickupFloor: '1樓' }); await app.settle();
  store.invalidate(); await app.settle();
  await app.view.handleLineLogin(); await app.settle();
  const before = calls;
  onboarding.resolve(response({ success: true, user: { userId: 'stale' }, authMode: 'employee_guest', status: 'VERIFIED' }));
  await old; await app.settle();
  assert.equal(calls, before); assert.equal(app.view.authMode, 'line');
  app.destroy();
});
