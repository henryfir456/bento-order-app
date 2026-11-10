import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleScheduled } from '../src/formalWorker.js';
import { handleFormalRequest, profileFetch, request } from './helpers/formal-fixtures.js';
import { callOrderRoute, ORDER_DATE, seedOrderDatabase, userProfile } from './helpers/order-fixtures.js';
import { seedUser } from './helpers/formal-fixtures.js';
import { lunarDayOf, scheduleAppliesTo } from '../src/domain/orderReminders.js';

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
  assert.deepEqual((await initial.json()).settings, { A: false, B: false, adminClose: true, vendorClose: true, adminVendorClose: false });
  const saved = await putSettings(database, profile, { A: true });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.settings, { A: true, B: false, adminClose: true, vendorClose: true, adminVendorClose: false });
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
  const controller = { cron: '0,30,50 1,9 * * *', scheduledTime: Date.parse('2026-09-08T01:50:00.000Z') };
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
  const controller = { cron: '0,30,50 1,9 * * *', scheduledTime: Date.parse('2026-09-07T09:50:00.000Z') };
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
  const controller = { cron: '0,30,50 1,9 * * *', scheduledTime: Date.parse('2026-09-08T01:50:00.000Z') };
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

test('vendor principal can opt out of the 18:00 close LINE push; only they may set it', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  seedUser(database, { userId: 'vendor-user', lineUserId: 'vendor-line', employeeId: null });
  database.run("INSERT INTO vendor_principals (user_id, principal_role, status) VALUES ('vendor-user', 'Vendor', 'ACTIVE')");
  database.run("INSERT INTO vendor_memberships (user_id, vendor_id, status) VALUES ('vendor-user', 'canonical-vendor-a', 'ACTIVE')");
  database.run("UPDATE calendar_settings SET mode = 'B' WHERE order_date = ?", ORDER_DATE);
  const created = await callOrderRoute(database, '/api/orders', {
    method: 'POST',
    body: { targetDate: ORDER_DATE, pickupFloor: '1樓', items: [{ menu_item_id: 'menu-a', quantity: 2 }] },
    headers: { 'Idempotency-Key': 'vendor-close-1' }
  }, userProfile('user-1', 'token-user-1'));
  assert.equal(created.response.status, 200);

  const vendor = { token: 'vendor-token', lineUserId: 'vendor-line' };
  const defaults = await handleFormalRequest(
    request('/api/me/reminder-settings', { token: vendor.token }),
    { DB: database },
    { fetchImpl: profileFetch(vendor), now: new Date('2026-09-07T00:00:00.000Z') }
  );
  assert.equal(defaults.status, 200);
  const defaultBody = await defaults.json();
  assert.equal(defaultBody.settings.vendorClose, true);
  assert.equal(defaultBody.canManageVendorClose, true);
  assert.equal(defaultBody.hasLineBinding, true);
  assert.equal((await putSettings(database, userProfile('user-1', 'token-user-1'), { vendorClose: false })).status, 403);
  assert.equal((await putSettings(database, vendor, { A: true })).status, 403);

  const controller = { cron: '0 2,10 * * *', scheduledTime: Date.parse('2026-09-07T10:00:00.000Z') };
  const { pushes, fetchImpl } = pushRecorder();
  const env = { DB: database, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'secret' };
  const first = await handleScheduled(controller, env, { logger: { log() {} }, fetchImpl });
  assert.equal(first.push.sent, 1);
  assert.deepEqual(JSON.parse(pushes[0].init.body).to, ['vendor-line']);
  assert.match(JSON.parse(pushes[0].init.body).messages[0].text, /1 筆訂單、2 份餐點：\n.+ × 2/);
  await handleScheduled(controller, env, { logger: { log() {} }, fetchImpl });
  assert.equal(pushes.length, 1);

  assert.equal((await putSettings(database, vendor, { vendorClose: false })).body.settings.vendorClose, false);
  database.run("DELETE FROM user_notifications");
  await handleScheduled(controller, env, { logger: { log() {} }, fetchImpl });
  assert.equal(pushes.length, 1);
});

test('Admin can opt in to the vendor 18:00 close notification; default off, non-admin rejected', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  seedUser(database, { userId: 'vendor-user', lineUserId: 'vendor-line', employeeId: null });
  database.run("INSERT INTO vendor_principals (user_id, principal_role, status) VALUES ('vendor-user', 'Vendor', 'ACTIVE')");
  database.run("INSERT INTO vendor_memberships (user_id, vendor_id, status) VALUES ('vendor-user', 'canonical-vendor-a', 'ACTIVE')");
  database.run("UPDATE calendar_settings SET mode = 'B' WHERE order_date = ?", ORDER_DATE);
  const admin = { token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin One' };
  const controller = { cron: '0 2,10 * * *', scheduledTime: Date.parse('2026-09-07T10:00:00.000Z') };
  const env = { DB: database, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'secret' };

  const off = pushRecorder();
  const first = await handleScheduled(controller, env, { logger: { log() {} }, fetchImpl: off.fetchImpl });
  assert.equal(first.notified, 1);
  assert.deepEqual(JSON.parse(off.pushes[0].init.body).to, ['vendor-line']);

  assert.equal((await putSettings(database, userProfile('user-1', 'token-user-1'), { adminVendorClose: true })).status, 403);
  assert.equal((await putSettings(database, admin, { adminVendorClose: true })).body.settings.adminVendorClose, true);
  database.run('DELETE FROM user_notifications');
  const on = pushRecorder();
  const second = await handleScheduled(controller, env, { logger: { log() {} }, fetchImpl: on.fetchImpl });
  assert.equal(second.notified, 2);
  assert.deepEqual(JSON.parse(on.pushes[0].init.body).to.sort(), ['admin-1', 'vendor-line']);
});

test('reminder schedule: validation, defaults and per-mode storage', async () => {
  const database = seedOrderDatabase();
  const profile = userProfile('user-1', 'token-user-1');
  const initial = await handleFormalRequest(
    request('/api/me/reminder-settings', { token: profile.token }),
    { DB: database },
    { fetchImpl: profileFetch(profile), now: new Date('2026-09-07T00:00:00.000Z') }
  );
  const defaults = (await initial.json()).schedule;
  assert.deepEqual(defaults.A, { leadMinutes: 10, weekdays: [1, 2, 3, 4, 5], lunarDays: [] });
  assert.deepEqual(defaults.B, defaults.A);

  const bad = [
    { A: { leadMinutes: 15, weekdays: [1], lunarDays: [] } },
    { A: { leadMinutes: 30, weekdays: [], lunarDays: [] } },
    { A: { leadMinutes: 30, weekdays: [6], lunarDays: [] } },
    { A: { leadMinutes: 30, weekdays: [1], lunarDays: [2] } },
    { C: { leadMinutes: 30, weekdays: [1], lunarDays: [] } }
  ];
  for (const schedule of bad) assert.equal((await putSettings(database, profile, { schedule })).status, 400);

  const saved = await putSettings(database, profile, {
    schedule: { B: { leadMinutes: 60, weekdays: [1, 3, 5], lunarDays: [1, 15] } }
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.schedule.B, { leadMinutes: 60, weekdays: [1, 3, 5], lunarDays: [1, 15] });
  assert.deepEqual(saved.body.schedule.A, defaults.A);
  // Saving a schedule must not switch the reminder on.
  assert.equal(saved.body.settings.B, false);
  assert.equal((await putSettings(database, profile, { B: true })).body.schedule.B.leadMinutes, 60);
});

test('reminder cron serves only users whose lead time and weekday match', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  const tenMinutes = userProfile('user-2', 'token-user-2');
  await putSettings(database, tenMinutes, { A: true });
  const thirty = userProfile('user-1', 'token-user-1');
  await putSettings(database, thirty, { A: true, schedule: { A: { leadMinutes: 30, weekdays: [1, 2, 3, 4, 5], lunarDays: [] } } });
  const mondayOnly = userProfile('admin-1', 'admin-token');
  await putSettings(database, mondayOnly, { A: true, schedule: { A: { leadMinutes: 10, weekdays: [1], lunarDays: [] } } });
  database.run("UPDATE calendar_settings SET vendor = '蔡老師', mode = 'A' WHERE order_date = ?", ORDER_DATE);

  const env = { DB: database, LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'secret' };
  const cron = '0,30,50 1,9 * * *';
  const run = async (time) => {
    const recorder = pushRecorder();
    const result = await handleScheduled(
      { cron, scheduledTime: Date.parse(time) },
      env, { logger: { log() {} }, fetchImpl: recorder.fetchImpl }
    );
    const body = recorder.pushes.length ? JSON.parse(recorder.pushes[0].init.body) : null;
    return { result, to: body ? body.to : [], text: body ? body.messages[0].text : '' };
  };

  // ORDER_DATE is a Tuesday: the Monday-only user is skipped at the 10-minute tick.
  assert.deepEqual((await run('2026-09-08T01:50:00.000Z')).to, ['user-2']);
  const half = await run('2026-09-08T01:30:00.000Z');
  assert.deepEqual(half.to, ['user-1']);
  assert.match(half.text, /剩 30 分鐘/);
  assert.equal((await run('2026-09-08T01:00:00.000Z')).result.status, 'SKIP_NO_RECIPIENT');
});

test('lunar-day restriction matches 初一 and 十五 only', () => {
  assert.equal(lunarDayOf('2026-09-25'), 15);
  assert.equal(lunarDayOf('2026-10-10'), 1);
  const lunar = { weekdaysMask: 31, lunarMask: 3 };
  assert.equal(scheduleAppliesTo('2026-09-25', lunar), true);
  assert.equal(scheduleAppliesTo('2026-09-08', lunar), false);
  // A Mon-Fri filter still applies on top, and weekends are never filtered by it.
  assert.equal(scheduleAppliesTo('2026-09-25', { weekdaysMask: 1, lunarMask: 3 }), false);
  assert.equal(scheduleAppliesTo('2026-10-10', { weekdaysMask: 1, lunarMask: 0 }), true);
  assert.equal(scheduleAppliesTo('2026-09-08', { weekdaysMask: 31, lunarMask: 0 }), true);
});
