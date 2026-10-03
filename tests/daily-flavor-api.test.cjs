const assert = require('node:assert/strict');
const { test } = require('node:test');

const apiModule = import('../src/api/apiClientCore.js');

test('manual daily flavor operations use Worker endpoints and never add GAS calls', async () => {
  const { createApiClient } = await apiModule;
  const calls = [];
  const client = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test'
    },
    authClient: { getAccessToken: () => 'user-access-token' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ success: true });
    }
  });

  await client.getAdminDailyFlavorSyncStatus();
  await client.syncAdminDailyFlavors();
  assert.deepEqual(calls.map(({ url, options }) => [new URL(url).pathname, options.method]), [
    ['/api/admin/daily-flavors/sync-status', 'GET'],
    ['/api/admin/daily-flavors/sync', 'POST']
  ]);
  assert.equal(calls.every(({ options }) => options.headers.Authorization === 'Bearer user-access-token'), true);
  assert.equal(calls[1].options.body, undefined);

  const gasClient = createApiClient({
    env: { VITE_API_TRANSPORT: 'gas', VITE_GAS_API_URL: 'https://gas.example.test' },
    authClient: { getAccessToken: () => 'user-access-token' },
    gasApi: { get: async () => ({}), post: async () => ({}) }
  });
  assert.equal(gasClient.getAdminDailyFlavorSyncStatus, undefined);
  assert.equal(gasClient.syncAdminDailyFlavors, undefined);
});
