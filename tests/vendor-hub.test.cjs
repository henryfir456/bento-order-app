const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');

const importFromRoot = (relativePath) => import(pathToFileURL(
  path.join(ROOT, relativePath)
).href);

test('vendor model normalizes aliases and keeps menu snapshot/source fields separate', async () => {
  const { formatVendorDate, normalizeVendor, normalizeVendorName } = await importFromRoot('src/features/vendors/vendorModel.js');
  const vendor = normalizeVendor({
    vendor_id: 'vendor-1',
    name: '合十',
    menu_image_url: 'https://res.cloudinary.com/demo/menu.png',
    menu_source_url: 'https://vendor.example/menu',
    menu_updated_at: '2026-09-01',
    enabled: 1,
    is_open_for_ordering: true,
    recent_groups: [{ order_date: '2026-09-12', mode: 'A', is_expired: false }]
  });

  assert.equal(normalizeVendorName('合十'), '禾拾');
  assert.equal(vendor.name, '禾拾');
  assert.equal(vendor.id, 'vendor-1');
  assert.equal(vendor.menu_image_url, 'https://res.cloudinary.com/demo/menu.png');
  assert.equal(vendor.menu_source_url, 'https://vendor.example/menu');
  assert.equal(vendor.enabled, true);
  assert.equal(vendor.is_open_for_ordering, true);
  assert.equal(formatVendorDate(vendor.menu_updated_at), '2026/09/01');
});

test('mock adapter can render and update vendor metadata without external scraping', async () => {
  const { createMockGasApi } = await importFromRoot('src/api/mockGasApi.js');
  const api = createMockGasApi({ mockUser: 'admin' });

  const listResponse = await api.get('?action=getVendors');
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(list.success, true);
  assert.equal(list.vendors.length, 2);
  assert.match(list.vendors[0].menu_image_url, /cloudinary/);

  const updateResponse = await api.post({
    action: 'updateVendor',
    accessToken: 'mock-admin-token',
    vendorId: 'mock-vendor-b',
    description: '每日手作便當（測試）'
  });
  const updated = await updateResponse.json();
  assert.equal(updated.id, 'mock-vendor-b');
  assert.equal(updated.description, '每日手作便當（測試）');

  const userApi = createMockGasApi({ mockUser: 'user' });
  const forbiddenResponse = await userApi.post({
    action: 'updateVendor',
    accessToken: 'mock-user-token',
    vendorId: 'mock-vendor-b',
    description: '不應更新'
  });
  const forbidden = await forbiddenResponse.json();
  assert.equal(forbidden.success, false);
});

test('GAS mode exposes a typed unsupported contract instead of falling back', async () => {
  const { createApiClient } = await importFromRoot('src/api/apiClientCore.js');
  const client = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'gas',
      VITE_GAS_API_URL: 'https://gas.example/exec'
    },
    authClient: { isMock: false, getAccessToken: () => 'line-token' },
    gasApi: { get: async () => new Response('{}'), post: async () => new Response('{}') }
  });

  assert.equal(client.transport, 'gas');
  assert.throws(
    () => client.getVendors(),
    (error) => error.code === 'VENDOR_HUB_UNSUPPORTED_TRANSPORT'
      && error.kind === 'contract-gap'
  );
  assert.throws(
    () => client.updateVendor({ vendorId: 'vendor-1', payload: {} }),
    (error) => error.code === 'VENDOR_HUB_UNSUPPORTED_TRANSPORT'
  );
});

test('vendor UI is wired to formal Worker/mock contracts and keeps GAS explicit', () => {
  const appSource = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
  const hubSource = fs.readFileSync(path.join(ROOT, 'src/features/vendors/VendorHub.jsx'), 'utf8');
  const calendarSource = fs.readFileSync(path.join(ROOT, 'src/features/calendar/CalendarManagement.jsx'), 'utf8');
  const permissionsSource = fs.readFileSync(path.join(ROOT, 'src/auth/permissions.js'), 'utf8');

  assert.match(appSource, /🏪 店家專區/);
  assert.match(appSource, /apiClient\.getVendors/);
  assert.match(appSource, /apiClient\.getVendor/);
  assert.match(appSource, /apiClient\.updateVendor/);
  assert.match(appSource, /canAuth\('manageVendors'\)/);
  assert.match(appSource, /handleExitVendorHub/);
  assert.match(hubSource, /vendor\.menu_image_url/);
  assert.match(hubSource, /vendor\.menu_source_url/);
  assert.doesNotMatch(hubSource, /src=\{vendor\.menu_source_url\}/);
  assert.match(hubSource, /GAS 模式尚未支援店家專區/);
  assert.match(calendarSource, /vendorOptions\.map/);
  assert.match(permissionsSource, /manageVendors: true/);
});
