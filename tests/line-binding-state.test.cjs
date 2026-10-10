const assert = require('node:assert/strict');
const { test } = require('node:test');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const { createHarness } = require('./helpers/app-auth-harness.cjs');
const { deferred } = require('./helpers/deferred.cjs');
const { createAuthSessionStore, GUEST_SESSION_STORAGE_KEY } = require('../src/auth/sessionStore.js');

const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
};
const identity = (mode, lineBound, userId = 'same-user') => ({
  success: true, registered: true, authMode: mode, identityState: 'VERIFIED', capabilities: ['READ_SELF'],
  user: { userId, name: 'Test', employeeId: '001234', active: true, role: 'User', identityState: 'VERIFIED', authSource: mode === 'employee_guest' ? 'EMPLOYEE_GUEST' : 'LINE', lineBound },
  calendar: { events: {} }, ordersMap: {}
});
const response = (body) => Response.json(body);
const makeApp = ({ store = createAuthSessionStore(storage()), api = {}, auth = {}, timers = globalThis } = {}) => {
  const app = createHarness({ store, renderJsx: true, timers,
    authClient: { isMock: false, init: async () => {}, isLoggedIn: () => true, isInClient: () => false,
      getAccessToken: () => 'line-token', login: () => { throw new Error('unexpected redirect'); }, ...auth },
    apiClient: { transport: 'worker', getBootstrap: async () => response(identity(store.getGuestSession() ? 'employee_guest' : 'line', true)),
      getDeferredBootstrap: async ({ bootId }) => response({ success: true, bootId }), ...api }
  });
  return app;
};
const headerMarkup = (app) => {
  const header = React.Children.toArray(app.view.renderedTree.props.children).find((x) => x?.type === 'header');
  return renderToStaticMarkup(header);
};
const loadMemberCard = () => {
  const output = buildSync({ entryPoints: [path.join(__dirname, '../src/features/balances/MemberBalanceManagement.jsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
  const module = { exports: {} };
  vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, require });
  return module.exports.default;
};

for (const [mode, bound] of [['line', true], ['employee_guest', true], ['employee_guest', false], ['line', false], ['employee_guest', undefined]]) {
  test(`actual Header and member card share canonical binding: ${mode}/${bound}`, async () => {
    const store = createAuthSessionStore(storage());
    if (mode === 'employee_guest') store.setGuestSession({ token: 'eg_guest', expiresAt: '2099-01-01' });
    const data = identity(mode, bound);
    const app = makeApp({ store, api: { getBootstrap: async () => response(data) } });
    await app.settle();
    const header = headerMarkup(app);
    const expected = bound === true ? '已綁定 LINE' : bound === false ? '未綁定 LINE' : 'LINE 綁定待確認';
    assert.ok(header.includes(expected), header);
    assert.equal(/>綁定 LINE<\/button>/.test(header), mode === 'employee_guest' && bound === false);
    const Member = loadMemberCard();
    const card = renderToStaticMarkup(React.createElement(Member, { memberBalances: [data.user] }));
    assert.ok(card.includes(expected), card);
    assert.equal(app.view.authMode, mode); assert.equal(app.view.authUser.role, 'User');
    app.destroy();
  });
}

test('Windows external LINE-first success clears stale employee session before readback and reopen', async () => {
  const store = createAuthSessionStore(storage());
  store.setGuestSession({ token: 'eg_old', expiresAt: '2099-01-01' });
  let bound = false, posts = 0;
  const api = {
    getBootstrap: async () => response(identity(store.getGuestSession() ? 'employee_guest' : 'line', bound)),
    lineEmployeeBind: async () => { posts++; bound = true; return response({ success: true, authMode: 'line', user: { userId: 'same-user', lineBound: true } }); }
  };
  const app = makeApp({ store, api }); await app.settle();
  await app.view.handleLineEmployeeBind({ employeeId: '001234' }); await app.settle();
  assert.equal(store.getGuestSession(), null); assert.equal(app.view.authMode, 'line');
  assert.ok(headerMarkup(app).includes('已綁定 LINE')); assert.equal(posts, 1);
  app.destroy();
  const reopened = makeApp({ store, api }); await reopened.settle();
  assert.equal(reopened.view.authMode, 'line'); assert.equal(posts, 1); reopened.destroy();
});

test('real store rejection and expiry revoke stale registered UI without silently selecting LINE', async () => {
  for (const reason of ['rejected', 'expired']) {
    const backing = storage(), store = createAuthSessionStore(backing);
    store.setGuestSession({ token: 'eg_guest', expiresAt: '2099-01-01' });
    const app = makeApp({ store }); await app.settle();
    if (reason === 'rejected') store.clearGuestSession({ reason });
    else { backing.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify({ token: 'eg_guest', expiresAt: '2000-01-01' })); store.getGuestSession(); }
    await app.settle();
    assert.equal(app.view.authUser, null); assert.equal(app.view.authState, 'AUTH_REQUIRED');
    app.destroy();
  }
});

test('registered foreground refresh reads binding state once without POST, redirect or privilege elevation', async () => {
  const store = createAuthSessionStore(storage()); store.setGuestSession({ token: 'eg_guest', expiresAt: '2099-01-01' });
  const pending = deferred(); let reads = 0, posts = 0;
  const app = makeApp({ store, api: {
    getBootstrap: async () => response(identity('employee_guest', false)),
    getIdentity: () => { reads++; return pending.promise; }, bindLine: async () => { posts++; return response({}); }
  } });
  await app.settle(); await app.event('focus'); await app.event('pageshow'); await app.event('visibilitychange');
  assert.equal(reads, 1);
  pending.resolve(response(identity('employee_guest', true))); await app.settle();
  assert.ok(headerMarkup(app).includes('已綁定 LINE')); assert.equal(posts, 0);
  assert.equal(app.view.authMode, 'employee_guest'); assert.equal(app.view.authUser.role, 'User');
  await app.view.handleBindLine(); assert.equal(posts, 0); app.destroy();
});

test('late foreground identity cannot overwrite a newer explicit LINE entry or its binding state', async () => {
  const store = createAuthSessionStore(storage()); store.setGuestSession({ token: 'eg_guest', expiresAt: '2099-01-01' });
  const old = deferred();
  const app = makeApp({ store, api: { getIdentity: () => old.promise } });
  await app.settle(); await app.event('focus');
  await app.view.handleLineLogin(); await app.settle();
  old.resolve(response(identity('employee_guest', false, 'stale-user'))); await app.settle();
  assert.equal(app.view.authMode, 'line'); assert.equal(app.view.authUser.userId, 'same-user');
  assert.ok(headerMarkup(app).includes('已綁定 LINE')); app.destroy();
});

test('foreground refresh preserves View As subject and only updates authenticated actor binding', async () => {
  const actor = identity('line', false); actor.user.role = 'Admin';
  const refreshed = identity('line', true); refreshed.user.role = 'Admin';
  const app = makeApp({ api: { getBootstrap: async () => response(actor), getIdentity: async () => response(refreshed) } });
  await app.settle();
  app.view.setViewAsUser({ userId: 'subject', lineBound: false }); await app.settle();
  await app.event('focus'); await app.settle();
  assert.equal(app.view.authUser.userId, 'same-user'); assert.equal(app.view.authUser.lineBound, true);
  assert.equal(app.view.viewAsUser.userId, 'subject'); assert.equal(app.view.viewAsUser.lineBound, false);
  assert.ok(!/>綁定 LINE<\/button>/.test(headerMarkup(app))); app.destroy();
});

for (const stuckPhase of ['headers', 'body']) {
  test(`registered ${stuckPhase} timeout can retry online and late settlement cannot undo binding`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = deferred(); let calls = 0;
    const app = makeApp({ api: { getBootstrap: async () => response(identity('line', false)),
      getIdentity: () => ++calls === 1
        ? (stuckPhase === 'headers' ? pending.promise : Promise.resolve({ ok: true, json: () => pending.promise }))
        : Promise.resolve(response(identity('line', true))) } });
    await app.settle(); await app.event('focus'); t.mock.timers.tick(15000); await app.settle();
    await app.event('online'); await app.settle();
    assert.equal(calls, 2); assert.equal(app.view.authUser.lineBound, true);
    pending.resolve(stuckPhase === 'headers' ? response(identity('line', false)) : identity('line', false));
    await app.settle(); assert.equal(app.view.authUser.lineBound, true); app.destroy();
  });
}

test('old foreground cleanup cannot clear a new refresh after explicit login', async () => {
  const old = deferred(), fresh = deferred(); let reads = 0;
  const app = makeApp({ api: { getIdentity: () => ++reads === 1 ? old.promise : fresh.promise } });
  await app.settle(); await app.event('focus');
  await app.view.handleLineLogin(); await app.settle(); await app.event('focus');
  old.reject(new Error('late')); await app.settle(); await app.event('pageshow');
  assert.equal(reads, 2); fresh.resolve(response(identity('line', true))); await app.settle();
  assert.equal(app.view.authUser.lineBound, true); app.destroy();
});

test('binding state never infers bound from registration or LINE auth and prefers explicit boolean', () => {
  const { getLineBindingState, canOfferLineBinding } = require('../src/auth/lineBindingState.js');
  assert.equal(getLineBindingState({ authSource: 'LINE', registered: true }), 'UNKNOWN');
  assert.equal(getLineBindingState({ lineBound: false, lineUserId: 'legacy-id' }), 'UNBOUND');
  assert.equal(getLineBindingState({ lineUserId: 'legacy-id' }), 'BOUND');
  assert.equal(getLineBindingState({ lineUserId: null }), 'UNBOUND');
  assert.equal(canOfferLineBinding({ user: {}, registered: true, transport: 'worker', authMode: 'employee_guest' }), false);
});

test('foreground binding refresh preserves a newer balance/profile mutation and session mode', async () => {
  const pending = deferred();
  const app = makeApp({ api: { getIdentity: () => pending.promise } });
  await app.settle(); await app.event('focus');
  app.view.setAuthUser((user) => ({ ...user, balance: 888, defaultFloor: '2F', name: 'Updated' })); await app.settle();
  pending.resolve(response({ ...identity('line', true), user: { ...identity('line', true).user, balance: 0, defaultFloor: 'old', name: 'Old' } }));
  await app.settle();
  assert.equal(app.view.authUser.lineBound, true); assert.equal(app.view.authUser.balance, 888);
  assert.equal(app.view.authUser.defaultFloor, '2F'); assert.equal(app.view.authUser.name, 'Updated');
  assert.equal(app.view.authUser.authMode, 'line'); assert.deepEqual(Array.from(app.view.authUser.capabilities), ['READ_SELF']); app.destroy();
});

for (const rejected of [true, false]) {
  test(`LINE foreground ${rejected ? '401' : 'no longer registered'} clears stale authenticated UI without redirect`, async () => {
    const app = makeApp({ api: { getIdentity: async () => rejected
      ? Response.json({ success: false, error: 'LINE_TOKEN_INVALID' }, { status: 401 })
      : response({ success: true, registered: false, authMode: 'line', user: null }) } });
    await app.settle(); await app.event('focus'); await app.settle();
    assert.equal(app.view.authUser, null); assert.equal(app.view.authState, 'AUTH_REQUIRED'); app.destroy();
  });
}

test('actual Worker API rejected LINE credential revokes registered UI without redirect', async () => {
  const { createApiClient } = require('../src/api/apiClientCore.js');
  const api = createApiClient({ env: { VITE_WORKER_API_URL: 'https://worker.test' },
    authClient: { getAccessToken: () => 'line-token' },
    fetchImpl: async () => Response.json({ success: false, error: 'LINE_TOKEN_INVALID' }, { status: 401 }) });
  const app = makeApp({ api: { getIdentity: api.getIdentity } });
  await app.settle(); await app.event('focus'); await app.settle();
  assert.equal(app.view.authUser, null); assert.equal(app.view.authState, 'AUTH_REQUIRED'); app.destroy();
});

for (const missing of ['empty', 'throw', 'during-read']) {
  test(`LINE credential ${missing} on foreground cannot leave stale registered UI`, async () => {
    let available = true; const pending = deferred();
    const app = makeApp({ auth: { getAccessToken: () => {
      if (!available && missing === 'throw') throw new Error('SDK token unreadable');
      return available ? 'line-token' : '';
    } }, api: { getIdentity: () => pending.promise } });
    await app.settle();
    if (missing === 'during-read') await app.event('focus');
    available = false;
    if (missing === 'during-read') pending.resolve(response(identity('line', true)));
    else await app.event('focus');
    await app.settle(); assert.equal(app.view.authUser, null); assert.equal(app.view.authState, 'AUTH_REQUIRED'); app.destroy();
  });
}

test('foreground role revocation clears View As and protected identity instead of retaining subject cache', async () => {
  const actor = identity('line', true); actor.user.role = 'Admin';
  const app = makeApp({ api: { getBootstrap: async () => response(actor), getIdentity: async () => response(identity('line', true)) } });
  await app.settle(); app.view.setViewAsUser({ userId: 'subject' }); await app.settle(); await app.event('focus');
  await app.settle(); assert.equal(app.view.authUser, null); assert.equal(app.view.viewAsUser, null);
  assert.equal(app.view.authState, 'AUTH_REQUIRED'); app.destroy();
});
