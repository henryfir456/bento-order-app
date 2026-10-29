import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleScheduled } from '../src/formalWorker.js';
import { handleFormalRequest, profileFetch, request } from './helpers/formal-fixtures.js';
import { callOrderRoute, ORDER_DATE, seedOrderDatabase, userProfile } from './helpers/order-fixtures.js';

const putSettings = async (database, profile, body) => {
  const response = await handleFormalRequest(
    request('/api/me/reminder-settings', { method: 'PUT', token: profile.token, body }),
    { DB: database },
    { fetchImpl: profileFetch(profile), now: new Date('2026-09-07T00:00:00.000Z') }
  );
  return { status: response.status, body: await response.json() };
};

const pushRecorder = () => {
  const pushes = [];
  return {
    pushes,
    fetchImpl: async (url, init) => {
      pushes.push({ url, init });
      return { ok: true, status: 200 };
    }
  };
};

test('reminder settings are per user and per group mode', async () => {
  const database = seedOrderDatabase();
  const profile = userProfile('user-1', 'token-user-1');
  const initial = await handleFormalRequest(
    request('/api/me/reminder-settings', { token: profile.token }),
    { DB: database },
    { fetchImpl: profileFetch(profile), now: new Date('2026-09-07T00:00:00.000Z') }
  );
  assert.deepEqual((await initial.json()).settings, { A: false, B: false, adminClose: true });
  const saved = await putSettings(database, profile, { A: true });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.settings, { A: true, B: false, adminClose: true });
  assert.equal((await putSettings(database, profile, { B: 'yes' })).status, 400);
  assert.equal((await putSettings(database, profile, {})).status, 400);
});

test('09:50 mode A cron reminds only opted-in users without an order, once', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const orderer = userProfile('user-1', 'token-user-1');
  const waiting = userProfile('user-2', 'token-user-2');
  await callOrderRoute(database, '/api/orders', {
    method: 'POST',
    body: { targetDate: ORDER_DATE, pickupFloor: '1樓', items: [{ menu_item_id: 'menu-a', quantity: 1 }] },
    headers: { 'Idempotency-Key': 'reminder-1' }
  }, orderer);
  await putSettings(database, orderer, { A: true });
  await putSettings(database, waiting, { A: true });
  await putSettings(database, userProfile('admin-1', 'admin-token'), { B: true });

  const { pushes, fetchImpl } = pushRecorder();
  const env = { DB: database, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'secret' };
  const controller = { cron: '50 1,9 * * *', scheduledTime: Date.parse('2026-09-08T01:50:00.000Z') };
  const lines = [];
  const first = await handleScheduled(controller, env, { logger: { log: (line) => lines.push(line) }, fetchImpl });
  assert.equal(first.status, 'REMINDED');
  assert.equal(first.reminded, 1);
  assert.equal(JSON.parse(lines[0]).event, 'order_reminder');
  assert.deepEqual(JSON.parse(pushes[0].init.body).to, ['user-2']);
  assert.match(JSON.parse(pushes[0].init.body).messages[0].text, /Vendor A 今天 10:00截止/);

  const retry = await handleScheduled(controller, env, { logger: { log() {} }, fetchImpl });
  assert.equal(retry.status, 'SKIP_NO_RECIPIENT');
  assert.equal(pushes.length, 1);
});

test('17:50 mode B cron looks at tomorrow and skips when no group of that mode exists', async () => {
  const database = seedOrderDatabase();
  await putSettings(database, userProfile('user-2', 'token-user-2'), { B: true });
  const { pushes, fetchImpl } = pushRecorder();
  const env = { DB: database, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'secret' };
  const controller = { cron: '50 1,9 * * *', scheduledTime: Date.parse('2026-09-07T09:50:00.000Z') };
  const skipped = await handleScheduled(controller, env, { logger: { log() {} }, fetchImpl });
  assert.equal(skipped.status, 'SKIP_NO_GROUP');
  assert.equal(skipped.mode, 'B');

  database.run("UPDATE calendar_settings SET mode = 'B' WHERE order_date = ?", ORDER_DATE);
  const sent = await handleScheduled(controller, env, { logger: { log() {} }, fetchImpl });
  assert.equal(sent.status, 'REMINDED');
  assert.equal(sent.orderDate, ORDER_DATE);
  assert.match(JSON.parse(pushes[0].init.body).messages[0].text, /今天 18:00截止/);
});

test('Admin can opt out of the 10:00 close LINE push while keeping the bell; users cannot set it', async () => {
  const database = seedOrderDatabase();
  const admin = { token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin One' };
  const defaults = await handleFormalRequest(
    request('/api/me/reminder-settings', { token: admin.token }),
    { DB: database },
    { fetchImpl: profileFetch(admin), now: new Date('2026-09-07T00:00:00.000Z') }
  );
  const defaultBody = await defaults.json();
  assert.equal(defaultBody.settings.adminClose, true);
  assert.equal(defaultBody.canManageAdminClose, true);
  assert.equal((await putSettings(database, userProfile('user-1', 'token-user-1'), { adminClose: false })).status, 403);
  assert.equal((await putSettings(database, admin, { adminClose: false })).body.settings.adminClose, false);

  database.run("UPDATE calendar_settings SET vendor = '蔡老師' WHERE order_date = ?", ORDER_DATE);
  const { pushes, fetchImpl } = pushRecorder();
  const result = await handleScheduled(
    { cron: '0 2,10 * * *', scheduledTime: Date.parse('2026-09-08T02:00:00.000Z') },
    { DB: database, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'secret' },
    { logger: { log() {} }, fetchImpl }
  );
  assert.equal(result.status, 'NOTIFIED');
  assert.equal(result.notified, 1);
  assert.equal(pushes.length, 0);
});

test('without a LINE token the reminder cron sends nothing and leaves no log rows', async () => {
  const database = seedOrderDatabase();
  await putSettings(database, userProfile('user-2', 'token-user-2'), { A: true });
  const { pushes, fetchImpl } = pushRecorder();
  const controller = { cron: '50 1,9 * * *', scheduledTime: Date.parse('2026-09-08T01:50:00.000Z') };
  const skipped = await handleScheduled(controller, { DB: database }, { logger: { log() {} }, fetchImpl });
  assert.equal(skipped.status, 'SKIP_NO_TOKEN');
  const sent = await handleScheduled(
    controller,
    { DB: database, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'secret' },
    { logger: { log() {} }, fetchImpl }
  );
  assert.equal(sent.status, 'REMINDED');
  assert.equal(pushes.length, 1);
});
