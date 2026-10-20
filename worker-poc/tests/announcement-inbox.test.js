import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const NOW = new Date('2026-09-08T00:00:00.000Z');

const profiles = {
  Admin: { token: 'admin-token', lineUserId: 'admin-1' },
  ProxyAdmin: { token: 'proxy-token', lineUserId: 'proxy-1' },
  User: { token: 'user-token', lineUserId: 'user-1' },
  OtherUser: { token: 'other-user-token', lineUserId: 'user-2' }
};

const seedUsers = (database) => {
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  seedUser(database, { lineUserId: 'proxy-1', role: 'ProxyAdmin' });
  seedUser(database, { lineUserId: 'user-1', role: 'User' });
  seedUser(database, { lineUserId: 'user-2', role: 'User' });
};

const call = async (database, path, {
  role = 'User',
  method = 'GET',
  body,
  headers = {}
} = {}) => {
  const profile = profiles[role];
  const response = await handleFormalRequest(
    request(path, { method, token: profile.token, body, headers }),
    { DB: database },
    { fetchImpl: profileFetch(profile), now: NOW }
  );
  return {
    response,
    body: response.status === 204 ? null : await response.json()
  };
};

const seedAnnouncement = (database, {
  id,
  title = id,
  startDate = '2026-09-01',
  endDate = '2026-09-30',
  enabled = 1,
  eligibleAt = null,
  createdAt = '2026-09-01T00:00:00.000Z',
  sourceOrder = 0
}) => {
  database.run(`
    INSERT INTO announcements (
      announcement_id, title, content, start_date, end_date, enabled,
      source_order, image_urls_json, auto_popup_eligible_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
  `, id, title, `Content for ${title}`, startDate, endDate, enabled, sourceOrder,
  eligibleAt, createdAt, createdAt);
};

test('announcement inbox excludes invalid windows and never auto-pops legacy announcements', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedAnnouncement(database, { id: 'legacy', sourceOrder: 4 });
  seedAnnouncement(database, {
    id: 'newest',
    eligibleAt: '2026-09-07T12:00:00.000Z',
    createdAt: '2026-09-07T12:00:00.000Z',
    sourceOrder: 3
  });
  seedAnnouncement(database, {
    id: 'future',
    startDate: '2026-09-09',
    eligibleAt: '2026-09-07T12:00:00.000Z',
    sourceOrder: 2
  });
  seedAnnouncement(database, {
    id: 'expired',
    endDate: '2026-09-07',
    eligibleAt: '2026-09-07T12:00:00.000Z',
    sourceOrder: 1
  });
  seedAnnouncement(database, {
    id: 'draft',
    enabled: 0,
    eligibleAt: '2026-09-07T12:00:00.000Z',
    sourceOrder: 5
  });

  const result = await call(database, '/api/me/announcements');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.announcements.map(({ id }) => id), ['newest', 'legacy']);
  assert.equal(result.body.unreadCount, 2);
  assert.equal(result.body.announcements[0].shouldAutoPopup, true);
  assert.equal(result.body.announcements[1].shouldAutoPopup, false);
  assert.equal(result.body.announcements[1].readAt, null);
  assert.equal('userId' in result.body.announcements[0], false);
  assert.equal('lineUserId' in result.body, false);
});

test('read state and auto-popup dismissal persist independently per canonical user', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedAnnouncement(database, {
    id: 'eligible',
    eligibleAt: '2026-09-07T12:00:00.000Z'
  });

  const read = await call(database, '/api/me/announcements/eligible/read', {
    method: 'POST',
    body: { userId: 'user-2', role: 'Admin' }
  });
  assert.equal(read.response.status, 200);
  assert.equal(read.body.announcementId, 'eligible');
  assert.equal(typeof read.body.readAt, 'string');

  const afterRead = await call(database, '/api/me/announcements');
  assert.equal(afterRead.body.unreadCount, 0);
  assert.equal(afterRead.body.announcements[0].shouldAutoPopup, true);
  assert.equal(afterRead.body.announcements[0].dismissAutoPopupAt, null);

  const dismissed = await call(database, '/api/me/announcements/eligible/dismiss', {
    method: 'POST'
  });
  assert.equal(dismissed.response.status, 200);
  assert.equal(typeof dismissed.body.dismissAutoPopupAt, 'string');

  const afterDismiss = await call(database, '/api/me/announcements');
  assert.equal(afterDismiss.body.unreadCount, 0);
  assert.equal(afterDismiss.body.announcements[0].shouldAutoPopup, false);
  assert.equal(typeof afterDismiss.body.announcements[0].readAt, 'string');

  const proxyDismissOnly = await call(database, '/api/me/announcements/eligible/dismiss', {
    role: 'ProxyAdmin',
    method: 'POST'
  });
  assert.equal(proxyDismissOnly.response.status, 200);
  const proxyInbox = await call(database, '/api/me/announcements', { role: 'ProxyAdmin' });
  assert.equal(proxyInbox.body.unreadCount, 1);
  assert.equal(proxyInbox.body.announcements[0].readAt, null);
  assert.equal(proxyInbox.body.announcements[0].shouldAutoPopup, false);

  const otherUser = await call(database, '/api/me/announcements', { role: 'OtherUser' });
  assert.equal(otherUser.body.unreadCount, 1);
  assert.equal(otherUser.body.announcements[0].readAt, null);
  assert.equal(otherUser.body.announcements[0].dismissAutoPopupAt, null);
  assert.equal(otherUser.body.announcements[0].shouldAutoPopup, true);
});

test('LINE and employee-only sessions persist preferences on the same canonical user', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedAnnouncement(database, { id: 'shared-identity', eligibleAt: '2026-09-07T12:00:00.000Z' });

  const login = await call(database, '/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: 'employee-user-1' }
  });
  assert.equal(login.response.status, 201);
  assert.equal(login.body.user.userId, 'user-1');

  const employeeRead = await handleFormalRequest(
    request('/api/me/announcements/shared-identity/read', {
      method: 'POST',
      token: login.body.token
    }),
    { DB: database },
    { now: NOW }
  );
  assert.equal(employeeRead.status, 200);
  assert.equal(database.get(
    'SELECT user_id FROM announcement_user_preferences WHERE announcement_id = ?',
    'shared-identity'
  ).user_id, 'user-1');

  const lineInbox = await call(database, '/api/me/announcements');
  assert.equal(lineInbox.body.unreadCount, 0);
  assert.equal(typeof lineInbox.body.announcements[0].readAt, 'string');
  const otherUserInbox = await call(database, '/api/me/announcements', { role: 'OtherUser' });
  assert.equal(otherUserInbox.body.unreadCount, 1);
});

test('View As cannot read or write another canonical user announcement preferences', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedAnnouncement(database, {
    id: 'private-state',
    eligibleAt: '2026-09-07T12:00:00.000Z'
  });

  for (const [path, method] of [
    ['/api/me/announcements?viewAs=user-1', 'GET'],
    ['/api/me/announcements/private-state/read?viewAs=user-1', 'POST'],
    ['/api/me/announcements/private-state/dismiss?viewAs=user-1', 'POST']
  ]) {
    const result = await call(database, path, { role: 'Admin', method });
    assert.equal(result.response.status, 403, `${method} ${path}`);
    assert.deepEqual(result.body, { error: 'VIEW_AS_FORBIDDEN' });
  }
  assert.equal(database.get('SELECT COUNT(*) AS count FROM announcement_user_preferences').count, 0);
});

test('only active announcements accept read or auto-popup dismissal updates', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedAnnouncement(database, {
    id: 'old-no-popup',
    sourceOrder: 1
  });
  seedAnnouncement(database, {
    id: 'expired',
    endDate: '2026-09-07',
    eligibleAt: '2026-09-07T12:00:00.000Z',
    sourceOrder: 2
  });

  const attempts = [
    await call(database, '/api/me/announcements/expired/read', { method: 'POST' }),
    await call(database, '/api/me/announcements/old-no-popup/dismiss', { method: 'POST' }),
    await call(database, '/api/me/announcements/missing/read', { method: 'POST' })
  ];
  attempts.forEach(({ response, body }) => {
    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: 'ANNOUNCEMENT_NOT_FOUND' });
  });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM announcement_user_preferences').count, 0);
});

test('new admin announcements become eligible once and editing old announcements does not make them new', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedAnnouncement(database, { id: 'legacy-to-edit' });

  const created = await call(database, '/api/admin/announcements', {
    role: 'Admin',
    method: 'POST',
    body: {
      title: 'Future event',
      content: 'Check the schedule.',
      start_date: '2026-09-08',
      end_date: '2026-09-20',
      enabled: false
    }
  });
  assert.equal(created.response.status, 201);
  assert.equal(typeof database.get(
    'SELECT auto_popup_eligible_at FROM announcements WHERE announcement_id = ?',
    created.body.id
  ).auto_popup_eligible_at, 'string');

  const enabled = await call(database, '/api/admin/announcements/legacy-to-edit', {
    role: 'Admin',
    method: 'PATCH',
    body: { enabled: false }
  });
  assert.equal(enabled.response.status, 200);
  assert.equal(database.get(
    'SELECT auto_popup_eligible_at FROM announcements WHERE announcement_id = ?',
    'legacy-to-edit'
  ).auto_popup_eligible_at, null);
});
