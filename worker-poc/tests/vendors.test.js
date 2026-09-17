import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { listVendors } from '../src/domain/vendors.js';
import { SqliteD1 } from './helpers/formal-db.js';
import {
  profileFetch,
  request,
  seedUser,
  seedVendor
} from './helpers/formal-fixtures.js';

const NOW = new Date('2026-09-11T01:00:00.000Z');

const seedVendorDatabase = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1', displayName: 'User One', pickupFloor: '1樓', role: 'User' });
  seedUser(database, { lineUserId: 'proxy-1', displayName: 'Proxy One', pickupFloor: '9樓', role: 'ProxyAdmin' });
  seedUser(database, { lineUserId: 'admin-1', displayName: 'Admin One', pickupFloor: '1樓', role: 'Admin' });
  seedVendor(database, {
    vendorId: 'vendor-teacher',
    name: '蔡老師',
    description: '健康蔬食便當，口味清爽',
    phone: '02-0000-0000',
    menuSourceUrl: 'https://example.com/teacher/menu',
    menuImageUrl: 'https://res.cloudinary.com/demo/image/upload/menu.png',
    menuUpdatedAt: '2026-09-01'
  });
  seedVendor(database, { vendorId: 'vendor-disabled', name: '停用店家', description: '目前暫停使用', enabled: 0 });
  database.run(`INSERT INTO calendar_settings (order_date, vendor, mode) VALUES (?, ?, ?)`, '2026-09-12', '蔡老師', 'A');
  database.run(`INSERT INTO calendar_settings (order_date, vendor, mode) VALUES (?, ?, ?)`, '2026-09-01', '蔡老師', 'A');
  return database;
};

const call = async (database, path, options = {}, profile = {}) => {
  const response = await handleFormalRequest(
    request(path, { ...options, token: options.token || profile.token || 'token-user' }),
    { DB: database },
    { fetchImpl: profileFetch(profile), now: NOW }
  );
  return { response, body: await response.json() };
};

test('vendor domain returns metadata, current ordering status, and recent groups', async () => {
  const database = seedVendorDatabase();
  const result = await listVendors(database, { now: NOW });
  assert.deepEqual(result.vendors.map((vendor) => vendor.name), ['蔡老師', '停用店家']);
  const teacher = result.vendors.find((vendor) => vendor.id === 'vendor-teacher');
  assert.equal(teacher.enabled, true);
  assert.equal(teacher.is_open_for_ordering, true);
  assert.equal(teacher.menu_image_url, 'https://res.cloudinary.com/demo/image/upload/menu.png');
  assert.equal(teacher.menu_source_url, 'https://example.com/teacher/menu');
  assert.deepEqual(teacher.recent_groups.map((group) => group.order_date), ['2026-09-12', '2026-09-01']);
  assert.equal(teacher.recent_groups[0].deadline, '2026-09-12T02:00:00.000Z');
  assert.equal(teacher.recent_groups[0].is_expired, false);
});

test('historical vendor aliases share one canonical recent-group status', async () => {
  const database = seedVendorDatabase();
  seedVendor(database, { vendorId: 'vendor-he-shi', name: '禾拾', enabled: 1 });
  seedVendor(database, { vendorId: 'vendor-he-shi-legacy', name: '合十', enabled: 1 });
  database.run(`INSERT INTO calendar_settings (order_date, vendor, mode) VALUES (?, ?, ?)`, '2026-09-13', '合十', 'B');
  const result = await listVendors(database, { now: NOW });
  const heShi = result.vendors.find((vendor) => vendor.id === 'vendor-he-shi');
  assert.equal(result.vendors.filter((vendor) => vendor.name === '禾拾').length, 1);
  assert.equal(heShi.name, '禾拾');
  assert.equal(heShi.is_open_for_ordering, true);
  assert.deepEqual(heShi.recent_groups.map((group) => group.order_date), ['2026-09-13']);
});

test('registered users can read vendor list and detail without client identity substitution', async () => {
  const database = seedVendorDatabase();
  const list = await call(database, '/api/vendors?viewAsUserId=user-1', {}, { token: 'token-admin', lineUserId: 'admin-1', displayName: 'Admin Display Name' });
  assert.equal(list.response.status, 200);
  assert.equal(list.body.vendors.length, 2);
  const detail = await call(database, '/api/vendors/vendor-teacher', {}, { token: 'token-user', lineUserId: 'user-1' });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.name, '蔡老師');
  assert.equal(detail.body.id, 'vendor-teacher');
});

test('vendor reads require a registered canonical identity and missing ids are 404', async () => {
  const database = seedVendorDatabase();
  const unregistered = await call(database, '/api/vendors', {}, { token: 'token-new', lineUserId: 'new-user' });
  assert.equal(unregistered.response.status, 403);
  assert.equal(unregistered.body.error, 'NOT_REGISTERED');
  const missing = await call(database, '/api/vendors/missing', {}, { token: 'token-user', lineUserId: 'user-1' });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error, 'VENDOR_NOT_FOUND');
});

test('Admin and ProxyAdmin can update vendor metadata with an audit event', async () => {
  const database = seedVendorDatabase();
  const admin = await call(database, '/api/admin/vendors/vendor-teacher', {
    method: 'PATCH',
    body: {
      description: '每日手作蔬食便當',
      menu_image_url: 'https://res.cloudinary.com/demo/image/upload/new-menu.png',
      menu_source_url: 'https://example.com/teacher/latest',
      menu_updated_at: '2026-09-11'
    }
  }, { token: 'token-admin', lineUserId: 'admin-1' });
  assert.equal(admin.response.status, 200);
  assert.equal(admin.body.description, '每日手作蔬食便當');
  assert.equal(admin.body.menu_updated_at, '2026-09-11');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'VENDOR_UPDATED'").count, 1);
  const proxy = await call(database, '/api/admin/vendors/vendor-teacher', { method: 'PATCH', body: { phone: '02-1111-2222' } }, { token: 'token-proxy', lineUserId: 'proxy-1' });
  assert.equal(proxy.response.status, 200);
  assert.equal(proxy.body.phone, '02-1111-2222');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'VENDOR_UPDATED'").count, 2);
});

test('User and View As cannot update vendor metadata', async () => {
  const database = seedVendorDatabase();
  const user = await call(database, '/api/admin/vendors/vendor-teacher', { method: 'PATCH', body: { description: 'forbidden' } }, { token: 'token-user', lineUserId: 'user-1' });
  assert.equal(user.response.status, 403);
  assert.equal(user.body.error, 'FORBIDDEN');
  const viewAs = await call(database, '/api/admin/vendors/vendor-teacher?viewAsUserId=user-1', { method: 'PATCH', body: { description: 'forbidden' } }, { token: 'token-admin', lineUserId: 'admin-1' });
  assert.equal(viewAs.response.status, 403);
  assert.equal(viewAs.body.error, 'VIEW_AS_FORBIDDEN');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'VENDOR_UPDATED'").count, 0);
});

test('vendor metadata patch rejects unknown, invalid, and empty payloads', async () => {
  const database = seedVendorDatabase();
  const cases = [
    [{ unknown: 'field' }, 'VENDOR_UNKNOWN_FIELD'],
    [{ menu_source_url: 'javascript:alert(1)' }, 'VENDOR_URL_INVALID'],
    [{ menu_updated_at: '2026-02-30' }, 'VENDOR_MENU_DATE_INVALID'],
    [{}, 'VENDOR_PATCH_EMPTY']
  ];
  for (const [body, error] of cases) {
    const result = await call(database, '/api/admin/vendors/vendor-teacher', { method: 'PATCH', body }, { token: 'token-admin', lineUserId: 'admin-1' });
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, error);
  }
});
