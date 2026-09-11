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

  await client.lineEmployeeLookup({ employeeId: '001234' });
  assert.equal(calls[1].options.headers.Authorization, 'Bearer line-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), { employeeId: '001234' });

  await client.lineEmployeeBind({ employeeId: '001234', displayName: 'Name', pickupFloor: '1樓' });
  assert.equal(calls[2].options.headers.Authorization, 'Bearer line-token');
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    employeeId: '001234',
    displayName: 'Name',
    pickupFloor: '1樓'
  });

  sessionStore.setGuestSession({ token: 'eg_opaque', expiresAt: '2099-01-01T00:00:00.000Z' });
  await client.getIdentity();
  assert.equal(calls[3].options.headers.Authorization, 'Bearer eg_opaque');
  assert.equal(new URL(calls[3].url).search, '');

  await client.bindLine({ guestToken: 'eg_opaque' });
  assert.equal(calls[4].options.headers.Authorization, 'Bearer line-token');
  assert.equal(calls[4].options.headers['X-Employee-Guest-Session'], 'eg_opaque');
});

test('Worker guest onboarding completion uses the guest session without requesting LINE auth', async () => {
  const { createApiClient } = await import('../src/api/apiClientCore.js');
  const calls = [];
  const client = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient: {
      getAccessToken: () => {
        throw new Error('LINE auth must not be requested for employee guest onboarding.');
      },
      isMock: false
    },
    sessionStore: new MemoryStorage(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        success: true,
        status: 'UNVERIFIED_EMPLOYEE',
        authMode: 'employee_guest',
        verificationStatus: 'UNVERIFIED'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });

  await client.completeEmployeeGuestOnboarding({
    guestToken: 'eg_opaque',
    displayName: 'Guest Provisional',
    pickupFloor: '9樓'
  });

  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/api/auth/employee-guest/onboarding');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.headers['X-Employee-Guest-Session'], 'eg_opaque');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    displayName: 'Guest Provisional',
    pickupFloor: '9樓'
  });
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
  const lineLookupSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LineEmployeeLookup.jsx'), 'utf8');
  const sessionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth', 'sessionStore.js'), 'utf8');
  const guestRender = appSource.match(/<EmployeeGuestLogin[\s\S]*?\/>/)?.[0] || '';

  assert.match(appSource, /EmployeeGuestLogin/);
  assert.match(appSource, /apiClient\.employeeGuestLogin/);
  assert.match(appSource, /apiClient\.bindLine/);
  assert.match(appSource, /guestSessionStore\.setBindIntent/);
  assert.match(appSource, /authMode === 'employee_guest'/);
  assert.match(loginSource, /type="text"/);
  assert.match(loginSource, /inputMode="text"/);
  assert.match(loginSource, /onEmployeeSubmit/);
  assert.match(loginSource, /其他登入方式/);
  assert.doesNotMatch(loginSource, /lineEmployeeLookup|lineAuthenticated/);
  assert.match(lineLookupSource, /LINE 已登入/);
  assert.match(lineLookupSource, /onSubmit/);
  assert.doesNotMatch(lineLookupSource, /employeeGuestLogin|guestSession/);
  assert.doesNotMatch(guestRender, /AUTH_STATES\.UNREGISTERED/);
  assert.match(appSource, /LineEmployeeLookup/);
  assert.match(appSource, /lineEmployeeLookup/);
  assert.match(appSource, /lineEmployeeBind/);
  assert.match(appSource, /AUTH_STATES\.UNREGISTERED/);
  assert.doesNotMatch(sessionSource, /localStorage/);
  assert.doesNotMatch(sessionSource, /setItem\([^\n]*(role|permission|balance)/i);
});

test('Worker App keeps provisional onboarding separate from registered application data', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const confirmationSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'EmployeeIdentityConfirmation.jsx'), 'utf8');
  const onboardingSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ProvisionalEmployeeOnboarding.jsx'), 'utf8');
  const clientSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'apiClientCore.js'), 'utf8');
  const errorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'apiErrors.js'), 'utf8');

  assert.match(appSource, /AUTH_STATES\.UNVERIFIED/);
  assert.match(appSource, /status === 'UNVERIFIED_EMPLOYEE'/);
  assert.match(appSource, /EmployeeIdentityConfirmation/);
  assert.match(appSource, /ProvisionalEmployeeOnboarding/);
  assert.match(confirmationSource, /確認並綁定 LINE/);
  assert.match(confirmationSource, /user\?\.name/);
  assert.match(onboardingSource, /employeeId/);
  assert.match(onboardingSource, /pickupFloor/);
  assert.doesNotMatch(onboardingSource, /lineUserId|userId|verificationStatus|balance/);
  assert.match(clientSource, /body: \{ displayName, pickupFloor \}/);
  assert.doesNotMatch(clientSource, /body: \{[^}]*lineUserId/);
  assert.match(errorSource, /LINE_LOGIN_REQUIRED/);
});

test('employee guest provisional onboarding does not require or initiate LINE binding', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const onboardingSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ProvisionalEmployeeOnboarding.jsx'), 'utf8');
  const submitBlock = appSource.match(/const handleProvisionalProfileSubmit[\s\S]*?\n  const fetchCalendarEvents/)?.[0] || '';

  assert.match(appSource, /apiClient\.completeEmployeeGuestOnboarding/);
  assert.match(submitBlock, /authMode === 'employee_guest'/);
  assert.match(submitBlock, /handleEmployeeGuestOnboarding/);
  assert.doesNotMatch(
    submitBlock.match(/if \(authMode === 'employee_guest'[\s\S]*?return;/)?.[0] || '',
    /handleLineEmployeeBind|handleBindLine/
  );
  assert.match(submitBlock, /authMode === 'line'/);
  assert.match(onboardingSource, /lineAuthenticated \? '完成 onboarding 並綁定 LINE' : '完成 onboarding'/);
  assert.match(onboardingSource, /lineAuthenticated \? '建立 onboarding 並綁定中\.\.\.' : '建立 onboarding 中\.\.\.'/);
});
