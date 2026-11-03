const test = require('node:test');
const assert = require('node:assert/strict');

test('a 401 on a LINE credential reports the session as rejected', async () => {
  const { createApiClient } = await import('../src/api/apiClientCore.js');
  let reported = 0;
  const sessionStore = { getGuestSession: () => null, reportLineSessionRejected: () => { reported += 1; } };
  const client = createApiClient({
    env: { VITE_WORKER_API_URL: 'https://worker.test' },
    authClient: { getAccessToken: () => 'line-token' },
    sessionStore,
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 })
  });
  await assert.rejects(client.getOrdersHistory({}), (e) => e.status === 401 || e.kind === 'authentication');
  assert.equal(reported, 1);
});

test('a session store exposes line-session-rejected to subscribers', async () => {
  const { createAuthSessionStore } = await import('../src/auth/sessionStore.js');
  const store = createAuthSessionStore(null);
  const events = [];
  store.subscribe((e) => events.push(e.type));
  store.reportLineSessionRejected();
  assert.deepEqual(events, ['line-session-rejected']);
});
