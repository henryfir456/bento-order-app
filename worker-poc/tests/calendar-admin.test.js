import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const call = async (database, path, options = {}, profile = {}) => {
  const response = await handleFormalRequest(
    request(path, options),
    { DB: database },
    {
      fetchImpl: profileFetch(profile),
      now: new Date('2026-09-08T00:00:00.000Z')
    }
  );
  return { response, body: await response.json() };
};

const databaseWithActors = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  seedUser(database, { lineUserId: 'proxy-1', role: 'ProxyAdmin' });
  seedUser(database, { lineUserId: 'user-1' });
  return database;
};

test('admin calendar upsert requires explicit mode, preserves blank vendor, and audits the actor', async () => {
  const database = databaseWithActors();
  const saved = await call(database, '/api/admin/calendar/2026-09-10', {
    method: 'PUT',
    token: 'admin-token',
    body: { vendor: '', mode: 'A' }
  }, { token: 'admin-token', lineUserId: 'admin-1' });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.setting.vendor, '');
  assert.equal(database.get("SELECT vendor_source FROM calendar_settings WHERE order_date = '2026-09-10'").vendor_source, 'CONFIGURED');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'CALENDAR_SETTING_UPDATED'").count, 1);

  const missingMode = await call(database, '/api/admin/calendar/2026-09-11', {
    method: 'PUT',
    token: 'admin-token',
    body: { vendor: 'Vendor A' }
  }, { token: 'admin-token', lineUserId: 'admin-1' });
  assert.equal(missingMode.response.status, 400);
  assert.equal(missingMode.body.error, 'CALENDAR_MODE_REQUIRED');

  const proxy = await call(database, '/api/admin/calendar/2026-09-12', {
    method: 'PUT',
    token: 'proxy-token',
    body: { vendor: 'Vendor A', mode: 'A' }
  }, { token: 'proxy-token', lineUserId: 'proxy-1' });
  assert.equal(proxy.response.status, 403);
});
