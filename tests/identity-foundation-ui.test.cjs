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

test('auth boot plan checks LIFF before restoring a guest fallback', async () => {
  const {
    AUTH_BOOT_STAGES,
    resolveAuthBootPlan,
    resolveWorkerAuthResolution,
    WORKER_AUTH_RESOLUTIONS
  } = await import('../src/auth/bootFlow.js');
  assert.deepEqual(resolveAuthBootPlan({
    transport: 'worker',
    hasGuestSession: true,
    isLoggedIn: false
  }), [
    AUTH_BOOT_STAGES.UNKNOWN,
    AUTH_BOOT_STAGES.LIFF_CHECK,
    AUTH_BOOT_STAGES.RESTORE_GUEST,
    AUTH_BOOT_STAGES.AUTH_GUEST
  ]);
  assert.deepEqual(resolveAuthBootPlan({
    transport: 'worker',
    hasGuestSession: true,
    hasBindIntent: true,
    isLoggedIn: true
  }), [
    AUTH_BOOT_STAGES.UNKNOWN,
    AUTH_BOOT_STAGES.LIFF_CHECK,
    AUTH_BOOT_STAGES.RESTORE_GUEST,
    AUTH_BOOT_STAGES.BIND_LINE
  ]);
  assert.deepEqual(resolveAuthBootPlan({
    transport: 'worker',
    hasGuestSession: true,
    isLoggedIn: true
  }), [
    AUTH_BOOT_STAGES.UNKNOWN,
    AUTH_BOOT_STAGES.LIFF_CHECK,
    AUTH_BOOT_STAGES.AUTH_LINE
  ]);
  assert.deepEqual(resolveAuthBootPlan({
    transport: 'worker',
    hasGuestSession: false,
    isLoggedIn: false
  }), [
    AUTH_BOOT_STAGES.UNKNOWN,
    AUTH_BOOT_STAGES.LIFF_CHECK,
    AUTH_BOOT_STAGES.LOGIN_REQUIRED
  ]);

  assert.equal(resolveWorkerAuthResolution({
    hasGuestSession: true,
    lineAuthState: 'authenticated'
  }), WORKER_AUTH_RESOLUTIONS.LINE);
  assert.equal(resolveWorkerAuthResolution({
    hasGuestSession: true,
    preferGuestSession: true,
    lineAuthState: 'authenticated'
  }), WORKER_AUTH_RESOLUTIONS.EMPLOYEE_GUEST);
  assert.equal(resolveWorkerAuthResolution({
    hasGuestSession: true,
    lineAuthState: 'anonymous'
  }), WORKER_AUTH_RESOLUTIONS.EMPLOYEE_GUEST);
  assert.equal(resolveWorkerAuthResolution({
    hasGuestSession: true,
    lineAuthState: 'unavailable'
  }), WORKER_AUTH_RESOLUTIONS.EMPLOYEE_GUEST);
  assert.equal(resolveWorkerAuthResolution({
    hasGuestSession: true,
    lineAuthState: 'unknown'
  }), WORKER_AUTH_RESOLUTIONS.CHECK_LINE);
});

test('Worker startup gives resolved LINE identity precedence over stale guest state', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const bootSource = appSource.match(/const initLiffAndFetchData[\s\S]*?\n  useEffect/)?.[0] || '';
  const liffCheckIndex = bootSource.indexOf("logAuthDiagnostic('LIFF_INIT_START')");
  const guestRestoreIndex = bootSource.indexOf("logAuthDiagnostic('RESTORE_GUEST_SESSION')");
  const lineBootstrapIndex = bootSource.indexOf('fetchBootstrapData(accessToken, bootId)');
  const clearGuestIndex = bootSource.indexOf("reason: 'line-precedence'");

  assert.ok(liffCheckIndex >= 0);
  assert.ok(guestRestoreIndex > liffCheckIndex);
  assert.ok(clearGuestIndex > liffCheckIndex);
  assert.ok(lineBootstrapIndex > clearGuestIndex);
  assert.match(bootSource, /lineAuthState: isLoggedIn && accessToken/);
  assert.match(bootSource, /workerResolution === WORKER_AUTH_RESOLUTIONS\.LINE/);
  assert.match(bootSource, /guestSessionStore\.clearGuestSession\(\{ reason: 'line-precedence', notify: false \}\)/);
  assert.match(bootSource, /resolveWorkerAuthResolution/);
});

test('bound LINE identity never re-enters provisional onboarding', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const submitBlock = appSource.match(/const handleProvisionalProfileSubmit[\s\S]*?\n  const fetchCalendarEvents/)?.[0] || '';

  assert.match(appSource, /const isGuestOnboarding = authMode === 'employee_guest'/);
  assert.match(appSource, /&& isGuestOnboarding/);
  assert.match(submitBlock, /authMode !== 'employee_guest'/);
  assert.match(submitBlock, /handleEmployeeGuestOnboarding/);
  assert.doesNotMatch(submitBlock, /handleLineEmployeeBind|updatePickupFloor|PENDING_VERIFICATION/);
});

test('registered bootstrap consumes nested identity state for an UNVERIFIED Admin', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const bootstrap = {
    success: true,
    registered: true,
    user: {
      userId: 'line-admin-139653',
      employeeId: '139653',
      role: 'Admin',
      authSource: 'LINE',
      identityState: 'VERIFIED',
      verificationStatus: 'UNVERIFIED'
    }
  };
  const identityResolver = appSource.match(/const requireAuthoritativeIdentityState[\s\S]*?\n};/)?.[0] || '';
  const registeredBranch = appSource.match(/if \(identity\?\.success && identity\.registered && identity\.user\)[\s\S]*?\n      } else if \(identity\?\.success && identity\.registered === false\)/)?.[0] || '';

  assert.equal(bootstrap.user.identityState, 'VERIFIED');
  assert.equal(bootstrap.user.verificationStatus, 'UNVERIFIED');
  assert.equal(bootstrap.user.role, 'Admin');
  assert.match(identityResolver, /data\?\.user\?\.identityState/);
  assert.match(appSource, /applyUserInfoData\(identity\)/);
  assert.match(registeredBranch, /setAuthState\(AUTH_STATES\.REGISTERED\)/);
  assert.doesNotMatch(registeredBranch, /employeeGuestLogin|handleProvisionalProfileSubmit|PENDING_VERIFICATION/);
});

test('legacy guest identity states remain compatibility-only and do not gate LINE access', async () => {
  const { IDENTITY_STATES } = await import('../src/auth/bootFlow.js');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const workerIdentitySource = fs.readFileSync(path.join(__dirname, '..', 'worker-poc', 'src', 'auth', 'identity.js'), 'utf8');
  const workerUsersSource = fs.readFileSync(path.join(__dirname, '..', 'worker-poc', 'src', 'domain', 'users.js'), 'utf8');
  const submitBlock = appSource.match(/const handleProvisionalProfileSubmit[\s\S]*?\n  const fetchCalendarEvents/)?.[0] || '';

  assert.equal(IDENTITY_STATES.NEW_PROVISIONAL_EMPLOYEE, 'NEW_PROVISIONAL_EMPLOYEE');
  assert.equal(IDENTITY_STATES.PENDING_VERIFICATION, 'PENDING_VERIFICATION');
  assert.equal(IDENTITY_STATES.EXISTING_UNVERIFIED_EMPLOYEE, 'EXISTING_UNVERIFIED_EMPLOYEE');
  assert.equal(IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED, 'EMPLOYEE_BIND_REQUIRED');
  assert.match(appSource, /const \[, setIdentityState\] = useState\(null\)/);
  assert.match(appSource, /authMode === 'employee_guest'/);
  assert.match(submitBlock, /authMode !== 'employee_guest'/);
  assert.match(submitBlock, /handleEmployeeGuestOnboarding/);
  assert.doesNotMatch(submitBlock, /PENDING_VERIFICATION|EXISTING_UNVERIFIED_EMPLOYEE/);
  assert.match(workerIdentitySource, /getUserByEmployeeId/);
  assert.match(workerIdentitySource, /isRegisteredEmployeeGuestPrincipal/);
  assert.doesNotMatch(workerIdentitySource, /user\.lineUserId !== null/);
  assert.doesNotMatch(workerIdentitySource, /isVerifiedPrincipal/);
  assert.match(workerUsersSource, /const identityState = identityStateFor\(actor\)/);
});

test('LINE identities without employee IDs use explicit binding-required state and flow', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const bootSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth', 'bootFlow.js'), 'utf8');
  const lookupSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LineEmployeeLookup.jsx'), 'utf8');
  const permissionsSource = fs.readFileSync(path.join(__dirname, '..', 'worker-poc', 'src', 'auth', 'permissions.js'), 'utf8');
  const errorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'apiErrors.js'), 'utf8');
  const applyIdentityBlock = appSource.match(/const applyUserInfoData = \(data\) => \{[\s\S]*?\n  \};/)?.[0] || '';

  assert.match(bootSource, /EMPLOYEE_BIND_REQUIRED: 'EMPLOYEE_BIND_REQUIRED'/);
  assert.match(permissionsSource, /CAN_BIND_EMPLOYEE: 'CAN_BIND_EMPLOYEE'/);
  assert.match(errorSource, /EMPLOYEE_ID_ALREADY_BOUND/);
  assert.match(applyIdentityBlock, /data\.identityState === IDENTITY_STATES\.EMPLOYEE_BIND_REQUIRED/);
  assert.match(appSource, /AUTH_STATES\.EMPLOYEE_BIND_REQUIRED/);
  assert.match(appSource, /apiClient\.lineEmployeeBind/);
  assert.match(appSource, /handleLineEmployeeBindRequired/);
  assert.match(appSource, /bindingRequired=\{isEmployeeBindRequired\}/);
  assert.match(appSource, /\[AUTH_STATES\.UNREGISTERED, AUTH_STATES\.EMPLOYEE_BIND_REQUIRED\]/);
  assert.doesNotMatch(appSource, /lineEmployeeLookup/);
  assert.match(lookupSource, /bindingRequired = false/);
  assert.match(lookupSource, /尚未綁定員編/);
  assert.match(lookupSource, /綁定員編/);
  assert.doesNotMatch(appSource.match(/const handleLineEmployeeBindRequired[\s\S]*?const handleLineLogin/)?.[0] || '', /employeeGuestLogin|completeEmployeeGuestOnboarding/);
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

test('LIFF completion resumes the same session into normal UI without manual reopen', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  assert.match(appSource, /const resumeAfterLiffReturn/);
  assert.match(appSource, /window\.addEventListener\('pageshow', resumeAfterLiffReturn\)/);
  assert.match(appSource, /window\.addEventListener\('focus', resumeAfterLiffReturn\)/);
  assert.match(appSource, /document\.addEventListener\('visibilitychange', resumeAfterLiffReturn\)/);
  assert.match(appSource, /logAuthDiagnostic\('LIFF_RETURN_RESUME'\)/);
  assert.match(appSource, /authBootCompletedRef\.current = false;[\s\S]*initLiffAndFetchData\(\{ force: true \}\)/);
  assert.match(appSource, /initLiffAndFetchData\(\{ force: true, preferGuestSession: true \}\)/);
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
  assert.match(lineLookupSource, /LINE 綁定員編/);
  assert.match(lineLookupSource, /onSubmit/);
  assert.doesNotMatch(lineLookupSource, /employeeGuestLogin|guestSession/);
  assert.doesNotMatch(guestRender, /AUTH_STATES\.UNREGISTERED/);
  assert.match(appSource, /LineEmployeeLookup/);
  assert.doesNotMatch(appSource, /lineEmployeeLookup/);
  assert.match(appSource, /lineEmployeeBind/);
  assert.match(appSource, /AUTH_STATES\.UNREGISTERED/);
  assert.doesNotMatch(sessionSource, /localStorage/);
  assert.doesNotMatch(sessionSource, /setItem\([^\n]*(role|permission|balance)/i);
});

test('Worker App keeps employee_guest onboarding separate from registered LINE application data', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const onboardingSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ProvisionalEmployeeOnboarding.jsx'), 'utf8');
  const clientSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'apiClientCore.js'), 'utf8');
  const errorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'apiErrors.js'), 'utf8');

  assert.match(appSource, /AUTH_STATES\.UNVERIFIED/);
  assert.match(appSource, /status === 'UNVERIFIED_EMPLOYEE'/);
  assert.match(appSource, /ProvisionalEmployeeOnboarding/);
  assert.match(onboardingSource, /employeeId/);
  assert.match(onboardingSource, /pickupFloor/);
  assert.doesNotMatch(onboardingSource, /lineUserId|userId|verificationStatus|balance/);
  assert.doesNotMatch(onboardingSource, /待核驗|待審核|LINE 綁定完成/);
  assert.match(clientSource, /body: \{ displayName, pickupFloor \}/);
  assert.doesNotMatch(clientSource, /body: \{[^}]*lineUserId/);
  assert.match(errorSource, /LINE_LOGIN_REQUIRED/);
});

test('Admin identity views render the server-authoritative employee ID with a null fallback', async () => {
  const { formatEmployeeId } = await import('../src/components/userIdentityDisplay.js');
  const { getMockMembers } = await import('../src/auth/mockData.js');
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const balanceSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'features', 'balances', 'MemberBalanceManagement.jsx'),
    'utf8'
  );

  assert.equal(formatEmployeeId('  A1B2C3  '), 'A1B2C3');
  assert.equal(formatEmployeeId(null), '未綁定');
  assert.equal(formatEmployeeId(undefined), '未綁定');
  assert.equal(formatEmployeeId(''), '未綁定');
  assert.equal(getMockMembers('admin').find((member) => member.userId === 'mock-user-id').employeeId, 'MCKUSR');
  assert.match(appSource, /員編 \{formatEmployeeId\(user\.employeeId\)\}/);
  assert.match(balanceSource, /<th className="p-2 whitespace-nowrap">登入來源<\/th>/);
  assert.match(balanceSource, /<th className="p-2 whitespace-nowrap">身份狀態<\/th>/);
  assert.match(balanceSource, /formatEmployeeId\(user\.employeeId\)/);

  const headerRow = balanceSource.match(/<tr>[\s\S]*?<\/tr>/)?.[0] || '';
  assert.ok(headerRow.indexOf('姓名') < headerRow.indexOf('登入來源'));
  assert.ok(headerRow.indexOf('登入來源') < headerRow.indexOf('身份狀態'));
  assert.ok(headerRow.indexOf('身份狀態') < headerRow.indexOf('員編'));
  assert.ok(headerRow.indexOf('員編') < headerRow.indexOf('樓層'));
  assert.ok(headerRow.indexOf('樓層') < headerRow.indexOf('餘額'));
  assert.ok(headerRow.indexOf('餘額') < headerRow.indexOf('角色'));
  assert.match(balanceSource, /overflow-x-auto/);
  assert.match(appSource, /\{user\.floor \|\| '未設定'\}/);
  assert.match(appSource, /\{user\.role \|\| 'User'\}/);
  assert.match(balanceSource, /\{user\.floor \|\| '未設定'\}/);
  assert.match(balanceSource, /\{user\.role \|\| 'User'\}/);
});

test('employee guest provisional onboarding does not require or initiate LINE binding', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const onboardingSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ProvisionalEmployeeOnboarding.jsx'), 'utf8');
  const submitBlock = appSource.match(/const handleProvisionalProfileSubmit[\s\S]*?\n  const fetchCalendarEvents/)?.[0] || '';

  assert.match(appSource, /apiClient\.completeEmployeeGuestOnboarding/);
  assert.match(submitBlock, /authMode !== 'employee_guest'/);
  assert.match(submitBlock, /handleEmployeeGuestOnboarding/);
  assert.doesNotMatch(submitBlock, /handleLineEmployeeBind|handleBindLine/);
  assert.doesNotMatch(onboardingSource, /lineAuthenticated/);
  assert.match(onboardingSource, /一般點餐功能/);
  assert.match(onboardingSource, /LINE 綁定為選用功能/);
});

test('employee binding success copy is role-neutral for every target role', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const onboardingSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ProvisionalEmployeeOnboarding.jsx'), 'utf8');
  assert.match(appSource, /const \[employeeGuestSuccess, setEmployeeGuestSuccess\] = useState\(''\)/);
  assert.match(appSource, /使用者原有角色與權限已保留。/);
  assert.doesNotMatch(appSource, /Admin 角色與既有權限已保留/);
  assert.match(appSource, /const isGuestOnboarding = authMode === 'employee_guest'/);
  assert.match(appSource, /success=\{employeeGuestSuccess\}/);
  assert.doesNotMatch(appSource, /員工身分尚待核驗|核驗完成後即可使用訂餐功能/);
  assert.doesNotMatch(onboardingSource, /待核驗|待審核|核驗完成後/);
  assert.match(appSource, /const isRegistered = authState === AUTH_STATES\.REGISTERED/);
  assert.match(appSource, /const isGuestOnboarding = authMode === 'employee_guest'/);
  assert.match(appSource, /authMode === 'employee_guest'[\s\S]*?AUTH_STATES\.UNVERIFIED/);
});
