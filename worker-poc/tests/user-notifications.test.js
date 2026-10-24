import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleScheduled } from '../src/formalWorker.js';
import { handleFormalRequest, profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { callOrderRoute, ORDER_DATE, seedOrderDatabase, userProfile } from './helpers/order-fixtures.js';

const seedVendorPrincipal = (database) => {
  seedUser(database, { userId: 'vendor-user', lineUserId: 'vendor-line', employeeId: null });
  database.run("INSERT INTO vendor_principals (user_id, principal_role, status) VALUES ('vendor-user', 'Vendor', 'ACTIVE')");
  database.run("INSERT INTO vendor_memberships (user_id, vendor_id, status) VALUES ('vendor-user', 'canonical-vendor-a', 'ACTIVE')");
};

const notificationsFor = async (database, profile, now) => {
  const response = await handleFormalRequest(
    request('/api/me/notifications', { token: profile.token }),
    { DB: database },
    { fetchImpl: profileFetch(profile), now }
  );
  return { status: response.status, body: await response.json() };
};

test('group cancellation notifies refunded buyers and the assigned vendor, readable through the bell API', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  seedVendorPrincipal(database);
  const buyer = userProfile('user-1', 'token-user-1');
  const created = await callOrderRoute(database, '/api/orders', {
    method: 'POST',
    body: { targetDate: ORDER_DATE, pickupFloor: '1樓', items: [{ menu_item_id: 'menu-a', quantity: 1 }] },
    headers: { 'Idempotency-Key': 'notify-cancel-1' }
  }, buyer);
  assert.equal(created.response.status, 200);

  const closedAt = new Date('2026-09-08T02:30:00.000Z');
  const closed = await handleFormalRequest(
    request(`/api/admin/calendar/${ORDER_DATE}`, { method: 'PUT', token: 'admin-token', body: { vendor: '', mode: 'A' } }),
    { DB: database },
    { fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-1', displayName: 'Admin One' }), now: closedAt }
  );
  assert.equal(closed.status, 200);

  const mine = await notificationsFor(database, buyer, closedAt);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.unreadCount, 1);
  assert.equal(mine.body.notifications[0].kind, 'GROUP_CANCELLED');
  assert.match(mine.body.notifications[0].body, /80 元已退回餘額/);

  const vendor = await notificationsFor(database, { token: 'vendor-token', lineUserId: 'vendor-line' }, closedAt);
  assert.equal(vendor.status, 200);
  assert.equal(vendor.body.notifications.length, 1);
  assert.match(vendor.body.notifications[0].body, /1 筆訂單全部取消/);

  const other = await notificationsFor(database, userProfile('user-2', 'token-user-2'), closedAt);
  assert.equal(other.body.notifications.length, 0);

  const read = await handleFormalRequest(
    request(`/api/me/notifications/${mine.body.notifications[0].id}/read`, { method: 'POST', token: buyer.token, body: {} }),
    { DB: database },
    { fetchImpl: profileFetch(buyer), now: closedAt }
  );
  assert.equal(read.status, 200);
  assert.equal((await notificationsFor(database, buyer, closedAt)).body.unreadCount, 0);

  const foreign = await handleFormalRequest(
    request(`/api/me/notifications/${mine.body.notifications[0].id}/read`, { method: 'POST', token: 'token-user-2', body: {} }),
    { DB: database },
    { fetchImpl: profileFetch(userProfile('user-2', 'token-user-2')), now: closedAt }
  );
  assert.equal(foreign.status, 404);
});

test('18:00 cron sends the vendor one order-closed notification and stays idempotent', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  seedVendorPrincipal(database);
  database.run("UPDATE calendar_settings SET mode = 'B' WHERE order_date = ?", ORDER_DATE);
  const buyer = userProfile('user-1', 'token-user-1');
  const created = await callOrderRoute(database, '/api/orders', {
    method: 'POST',
    body: { targetDate: ORDER_DATE, pickupFloor: '1樓', items: [{ menu_item_id: 'menu-a', quantity: 2 }] },
    headers: { 'Idempotency-Key': 'notify-close-1' }
  }, buyer);
  assert.equal(created.response.status, 200);

  const controller = { cron: '0 10 * * *', scheduledTime: Date.parse('2026-09-07T10:00:00.000Z') };
  const lines = [];
  const first = await handleScheduled(controller, { DB: database }, { logger: { log: (line) => lines.push(line) } });
  assert.equal(first.status, 'NOTIFIED');
  assert.equal(first.orderDate, ORDER_DATE);
  assert.equal(JSON.parse(lines[0]).event, 'vendor_order_closed_notification');
  await handleScheduled(controller, { DB: database }, { logger: { log() {} } });

  const vendor = await notificationsFor(database, { token: 'vendor-token', lineUserId: 'vendor-line' }, new Date(controller.scheduledTime));
  assert.equal(vendor.body.notifications.length, 1);
  assert.equal(vendor.body.notifications[0].kind, 'VENDOR_ORDER_CLOSED');
  assert.match(vendor.body.notifications[0].body, /1 筆訂單、2 份餐點/);

  const nothing = await handleScheduled(
    { cron: '0 10 * * *', scheduledTime: Date.parse('2026-09-10T10:00:00.000Z') },
    { DB: database }, { logger: { log() {} } }
  );
  assert.equal(nothing.status, 'SKIP_NO_GROUP');
});

test('Admin member list shows the vendor login code in place of an employee ID, only to LINE Admin', async () => {
  const database = seedOrderDatabase({ balance: 100 });
  seedVendorPrincipal(database);
  database.run("UPDATE vendor_principals SET vendor_login_id = 'VSYN01' WHERE user_id = 'vendor-user'");
  const fetchAs = async (profile) => {
    const response = await handleFormalRequest(
      request('/api/admin/members/balances', { token: profile.token }),
      { DB: database },
      { fetchImpl: profileFetch(profile), now: new Date('2026-09-08T00:00:00.000Z') }
    );
    return { status: response.status, body: await response.json() };
  };
  const admin = await fetchAs({ token: 'admin-token', lineUserId: 'admin-1' });
  assert.equal(admin.status, 200);
  const vendor = admin.body.members.find((member) => member.role === 'Vendor');
  assert.equal(vendor.vendorLoginId, 'VSYN01');
  assert.equal(vendor.employeeId, null);
  assert.ok(admin.body.members.filter((member) => member.role !== 'Vendor').every((member) => !('vendorLoginId' in member)));
});
