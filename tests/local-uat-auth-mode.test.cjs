const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const authModePath = pathToFileURL(path.join(__dirname, '..', 'src', 'auth', 'authMode.js')).href;

test('local UAT auth mode is a development-only real Worker identity mode', async () => {
  const { resolveAuthConfig } = await import(authModePath);

  const local = resolveAuthConfig({ DEV: true, VITE_AUTH_MODE: 'local-uat' });
  assert.equal(local.mode, 'local-uat');
  assert.equal(local.isLocalUat, true);
  assert.equal(local.isMock, false);

  const production = resolveAuthConfig({ DEV: false, VITE_AUTH_MODE: 'local-uat' });
  assert.equal(production.mode, 'liff');
  assert.equal(production.isLocalUat, false);
});

test('local UAT password is sent to the Worker but only its token is stored in session storage', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const entries = new Map();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key) => entries.get(key) || null,
        setItem: (key, value) => entries.set(key, value),
        removeItem: (key) => entries.delete(key)
      }
    }
  });

  try {
    const { createAuthClient } = await import(pathToFileURL(
      path.join(__dirname, '..', 'src', 'auth', 'authClient.js')
    ).href);
    let requestBody;
    const client = createAuthClient({
      env: {
        DEV: true,
        VITE_AUTH_MODE: 'local-uat',
        VITE_WORKER_API_URL: 'http://localhost:8787'
      },
      liffClient: {},
      logger: {},
      fetchImpl: async (url, options) => {
        assert.equal(url, 'http://localhost:8787/__local-uat/session');
        requestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({
          success: true,
          role: 'vendor-one',
          accessToken: 'synthetic-access-token'
        }), { status: 200 });
      }
    });

    await client.loginLocalUat({ role: 'vendor-one', password: 'test-only-password' });
    assert.deepEqual(requestBody, { role: 'vendor-one', password: 'test-only-password' });
    assert.deepEqual([...entries], [['bento-local-uat-access-token-v1', 'synthetic-access-token']]);
    assert.equal(client.getAccessToken(), 'synthetic-access-token');
    client.logoutLocalUat();
    assert.equal(entries.size, 0);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  }
});
