const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test('guest session storage persists only opaque token and expiry', async () => {
  const {
    BIND_INTENT_STORAGE_KEY,
    GUEST_SESSION_STORAGE_KEY,
    createAuthSessionStore
  } = await import('../src/auth/sessionStore.js');
  const storage = new MemoryStorage();
  const store = createAuthSessionStore(storage);
  const expiresAt = '2099-01-01T00:00:00.000Z';

  store.setGuestSession({ token: 'eg_opaque', expiresAt });
  assert.deepEqual(store.getGuestSession({ now: Date.parse('2098-01-01T00:00:00.000Z') }), {
    token: 'eg_opaque',
    expiresAt
  });
  assert.deepEqual(JSON.parse(storage.getItem(GUEST_SESSION_STORAGE_KEY)), {
    token: 'eg_opaque',
    expiresAt
  });
  assert.equal(storage.getItem(BIND_INTENT_STORAGE_KEY), null);

  store.setBindIntent();
  assert.equal(store.hasBindIntent(), true);
  store.clearBindIntent();
  assert.equal(store.hasBindIntent(), false);

  store.getGuestSession({ now: Date.parse('2100-01-01T00:00:00.000Z') });
  assert.equal(storage.getItem(GUEST_SESSION_STORAGE_KEY), null);
});

test('auth boot plan is deterministic and gives guest sessions precedence over LIFF', async () => {
  const { AUTH_BOOT_STAGES, resolveAuthBootPlan } = await import('../src/auth/bootFlow.js');
  assert.deepEqual(resolveAuthBootPlan({
    transport: 'worker',
    hasGuestSession: true,
    isLoggedIn: false
  }), [
    AUTH_BOOT_STAGES.UNKNOWN,
    AUTH_BOOT_STAGES.RESTORE_GUEST,
    AUTH_BOOT_STAGES.LIFF_CHECK,
    AUTH_BOOT_STAGES.AUTH_GUEST
  ]);
  assert.deepEqual(resolveAuthBootPlan({
    transport: 'worker',
    hasGuestSession: true,
    hasBindIntent: true,
    isLoggedIn: true
  }), [
    AUTH_BOOT_STAGES.UNKNOWN,
    AUTH_BOOT_STAGES.RESTORE_GUEST,
    AUTH_BOOT_STAGES.LIFF_CHECK,
    AUTH_BOOT_STAGES.AUTH_GUEST,
    AUTH_BOOT_STAGES.BIND_LINE
  ]);
  assert.deepEqual(resolveAuthBootPlan({
    transport: 'worker',
    hasGuestSession: false,
    isLoggedIn: false
  }), [
    AUTH_BOOT_STAGES.UNKNOWN,
    AUTH_BOOT_STAGES.RESTORE_GUEST,
    AUTH_BOOT_STAGES.LIFF_CHECK,
    AUTH_BOOT_STAGES.LOGIN_REQUIRED
  ]);
});

test('LIFF init is idempotent across concurrent boot attempts', async () => {
  const { createAuthClient } = await import('../src/auth/authClient.js');
  let initCalls = 0;
  const client = createAuthClient({
    env: { VITE_LIFF_ID: 'liff-test' },
    liffClient: {
      init: async () => {
        initCalls += 1;
      },
      isLoggedIn: () => false,
      isInClient: () => false,
      login: () => undefined,
      getAccessToken: () => ''
    },
    logger: { info: () => undefined }
  });

  await Promise.all([client.init(), client.init(), client.init()]);
  assert.equal(initCalls, 1);
});

test('Worker transport sends guest login without auth and protected calls with opaque guest bearer', async () => {
  const [{ createApiClient }, { createAuthSessionStore }] = await Promise.all([
    import('../src/api/apiClientCore.js'),
    import('../src/auth/sessionStore.js')
  ]);
  const storage = new MemoryStorage();
  const sessionStore = createAuthSessionStore(storage);
  const calls = [];
  const authClient = {
    getAccessToken: () => 'line-token',
    isMock: false
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/auth/employee-guest')) {
      return new Response(JSON.stringify({
        success: true,
        authMode: 'employee_guest',
        token: 'eg_opaque',
        expiresAt: '2099-01-01T00:00:00.000Z'
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: true, registered: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const client = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient,
    sessionStore,
    fetchImpl
  });

  await client.employeeGuestLogin({ employeeId: '001234' });
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), { employeeId: '001234' });

  sessionStore.setGuestSession({ token: 'eg_opaque', expiresAt: '2099-01-01T00:00:00.000Z' });
  await client.getIdentity();
  assert.equal(calls[1].options.headers.Authorization, 'Bearer eg_opaque');
  assert.equal(new URL(calls[1].url).search, '');

  await client.bindLine({ guestToken: 'eg_opaque' });
  assert.equal(calls[2].options.headers.Authorization, 'Bearer line-token');
  assert.equal(calls[2].options.headers['X-Employee-Guest-Session'], 'eg_opaque');
});

test('Worker guest 401 keeps stable code and clears only the guest credential', async () => {
  const [{ createApiClient }, { createAuthSessionStore }] = await Promise.all([
    import('../src/api/apiClientCore.js'),
    import('../src/auth/sessionStore.js')
  ]);
  const storage = new MemoryStorage();
  const sessionStore = createAuthSessionStore(storage);
  sessionStore.setGuestSession({ token: 'eg_stale', expiresAt: '2099-01-01T00:00:00.000Z' });
  const client = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient: { getAccessToken: () => 'line-token', isMock: false },
    sessionStore,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'GUEST_SESSION_INVALID' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  });

  await assert.rejects(() => client.getIdentity(), (error) => (
    error.code === 'GUEST_SESSION_INVALID' && error.kind === 'authentication'
  ));
  assert.equal(sessionStore.getGuestSession(), null);
});

test('frontend permissions treat employee guest as self-only even when canonical role is Admin', async () => {
  const { hasPermission } = await import('../src/auth/permissions.js');
  assert.equal(hasPermission('Admin', 'viewOwnBalance', 'employee_guest'), true);
  assert.equal(hasPermission('Admin', 'orderOwn', 'employee_guest'), true);
  for (const permission of [
    'viewAdminOrderSummary',
    'viewMemberBalances',
    'topupMember',
    'manageCalendar',
    'manageAnnouncements',
    'viewAsUser'
  ]) {
    assert.equal(hasPermission('Admin', permission, 'employee_guest'), false, permission);
  }
});

test('Worker App wires the employee guest and bind flow without exposing LINE IDs or client authority', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const loginSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'EmployeeGuestLogin.jsx'), 'utf8');
  const sessionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth', 'sessionStore.js'), 'utf8');

  assert.match(appSource, /EmployeeGuestLogin/);
  assert.match(appSource, /apiClient\.employeeGuestLogin/);
  assert.match(appSource, /apiClient\.bindLine/);
  assert.match(appSource, /guestSessionStore\.setBindIntent/);
  assert.match(appSource, /authMode === 'employee_guest'/);
  assert.match(loginSource, /type="text"/);
  assert.match(loginSource, /inputMode="text"/);
  assert.match(loginSource, /onEmployeeSubmit/);
  assert.doesNotMatch(sessionSource, /localStorage/);
  assert.doesNotMatch(sessionSource, /setItem\([^\n]*(role|permission|balance)/i);
});
