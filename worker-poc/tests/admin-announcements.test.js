import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { PRODUCTION_FRONTEND_ORIGIN } from '../src/http/response.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const NOW = new Date('2026-09-08T00:00:00.000Z');

const profiles = {
  Admin: { token: 'admin-token', lineUserId: 'admin-1' },
  ProxyAdmin: { token: 'proxy-token', lineUserId: 'proxy-1' },
  User: { token: 'user-token', lineUserId: 'user-1' }
};

const seedUsers = (database) => {
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  seedUser(database, { lineUserId: 'proxy-1', role: 'ProxyAdmin' });
  seedUser(database, { lineUserId: 'user-1', role: 'User' });
};

const call = async (database, path, {
  role = 'Admin',
  method = 'GET',
  body,
  headers = {}
} = {}) => {
  const profile = profiles[role];
  const response = await handleFormalRequest(
    request(path, {
      method,
      token: profile.token,
      body,
      headers
    }),
    { DB: database },
    {
      fetchImpl: profileFetch(profile),
      now: NOW
    }
  );
  return {
    response,
    body: response.status === 204 ? null : await response.json()
  };
};

const rawCall = async (database, path, {
  role = 'Admin',
  method = 'POST',
  body = '',
  headers = {}
} = {}) => {
  const profile = profiles[role];
  const response = await handleFormalRequest(
    new Request('https://formal.test' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + profile.token,
        'Content-Type': 'application/json',
        ...headers
      },
      body
    }),
    { DB: database },
    {
      fetchImpl: profileFetch(profile),
      now: NOW
    }
  );
  return {
    response,
    body: response.status === 204 ? null : await response.json()
  };
};

const validAnnouncement = {
  title: 'Lunch notice',
  content: 'The menu is ready.',
  start_date: '2026-09-10',
  end_date: '2026-09-20'
};

const seedAnnouncement = (database, {
  id = 'announcement-1',
  title = 'Existing',
  content = 'Existing content',
  startDate = '2026-09-01',
  endDate = '2026-09-30',
  enabled = 1,
  sourceOrder = 0
} = {}) => {
  database.run(`
    INSERT INTO announcements (
      announcement_id, title, content, start_date, end_date, enabled, source_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, id, title, content, startDate, endDate, enabled, sourceOrder);
};

test('announcement management routes are Admin-only for every CRUD method', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedAnnouncement(database);
  const requests = [
    ['/api/admin/announcements', { method: 'GET' }],
    ['/api/admin/announcements', { method: 'POST', body: validAnnouncement }],
    ['/api/admin/announcements/announcement-1', {
      method: 'PATCH',
      body: { title: 'Changed' }
    }],
    ['/api/admin/announcements/announcement-1', { method: 'DELETE' }]
  ];

  for (const role of ['ProxyAdmin', 'User']) {
    for (const [path, options] of requests) {
      const result = await call(database, path, { role, ...options });
      assert.equal(result.response.status, 403, `${role} ${options.method} ${path}`);
      assert.deepEqual(result.body, { error: 'FORBIDDEN' });
    }
  }
});

test('announcement management does not permit an Admin View As identity', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  const result = await call(database, '/api/admin/announcements?viewAs=user-1');
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.body, { error: 'VIEW_AS_FORBIDDEN' });
});

test('trailing announcement mutation paths authenticate before returning missing-ID errors', async () => {
  const database = new SqliteD1();
  seedUsers(database);

  for (const method of ['PATCH', 'DELETE']) {
    const result = await call(database, '/api/admin/announcements/', {
      method,
      ...(method === 'PATCH' ? { body: { title: 'Ignored' } } : {})
    });
    assert.equal(result.response.status, 400, method);
    assert.deepEqual(result.body, { error: 'ANNOUNCEMENT_ID_REQUIRED' });
  }

  for (const method of ['PATCH', 'DELETE']) {
    const response = await handleFormalRequest(
      new Request('https://formal.test/api/admin/announcements/', { method }),
      { DB: database },
      {
        fetchImpl: profileFetch(profiles.Admin),
        now: NOW
      }
    );
    assert.equal(response.status, 401, method);
    assert.deepEqual(await response.json(), { error: 'AUTH_REQUIRED' });
  }
});

test('DELETE success and errors retain the formal CORS policy', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedAnnouncement(database, { id: 'delete-cors' });

  const deleted = await call(database, '/api/admin/announcements/delete-cors', {
    method: 'DELETE',
    headers: { Origin: PRODUCTION_FRONTEND_ORIGIN }
  });
  assert.equal(deleted.response.status, 204);
  assert.equal(
    deleted.response.headers.get('Access-Control-Allow-Origin'),
    PRODUCTION_FRONTEND_ORIGIN
  );
  assert.equal(deleted.response.headers.get('Vary'), 'Origin');

  const missing = await call(database, '/api/admin/announcements/', {
    method: 'DELETE',
    headers: { Origin: PRODUCTION_FRONTEND_ORIGIN }
  });
  assert.equal(missing.response.status, 400);
  assert.deepEqual(missing.body, { error: 'ANNOUNCEMENT_ID_REQUIRED' });
  assert.equal(
    missing.response.headers.get('Access-Control-Allow-Origin'),
    PRODUCTION_FRONTEND_ORIGIN
  );
  assert.equal(missing.response.headers.get('Vary'), 'Origin');
});

test('Admin can create, edit every field, toggle, and delete announcements atomically', async () => {
  const database = new SqliteD1();
  seedUsers(database);

  const created = await call(database, '/api/admin/announcements', {
    method: 'POST',
    body: validAnnouncement
  });
  assert.equal(created.response.status, 201);
  assert.match(created.body.id, /^announcement_/);
  assert.deepEqual(created.body, {
    id: created.body.id,
    title: 'Lunch notice',
    content: 'The menu is ready.',
    start_date: '2026-09-10',
    end_date: '2026-09-20',
    enabled: true
  });
  assert.equal(database.get(
    'SELECT source_order FROM announcements WHERE announcement_id = ?',
    created.body.id
  ).source_order, 0);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ANNOUNCEMENT_CREATED'"
  ).count, 1);

  const title = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'PATCH',
    body: { title: 'Updated title' }
  });
  assert.equal(title.response.status, 200);
  assert.equal(title.body.title, 'Updated title');

  const content = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'PATCH',
    body: { content: 'Updated content' }
  });
  assert.equal(content.body.content, 'Updated content');

  const startDate = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'PATCH',
    body: { start_date: '2026-09-11' }
  });
  assert.equal(startDate.body.start_date, '2026-09-11');

  const endDate = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'PATCH',
    body: { end_date: '2026-09-25' }
  });
  assert.equal(endDate.body.end_date, '2026-09-25');

  const disabled = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'PATCH',
    body: { enabled: false }
  });
  assert.equal(disabled.body.enabled, false);

  const enabled = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'PATCH',
    body: { enabled: true }
  });
  assert.equal(enabled.body.enabled, true);
  assert.equal(database.get(
    'SELECT source_order FROM announcements WHERE announcement_id = ?',
    created.body.id
  ).source_order, 0);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ANNOUNCEMENT_UPDATED'"
  ).count, 6);

  const deleted = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'DELETE'
  });
  assert.equal(deleted.response.status, 204);
  assert.equal(database.get(
    'SELECT COUNT(*) AS count FROM announcements WHERE announcement_id = ?',
    created.body.id
  ).count, 0);
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'ANNOUNCEMENT_DELETED'"
  ).count, 1);

  const deletedAgain = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'DELETE'
  });
  assert.equal(deletedAgain.response.status, 404);
  assert.deepEqual(deletedAgain.body, { error: 'ANNOUNCEMENT_NOT_FOUND' });
});

test('announcement CRUD rejects malformed, incomplete, unknown, and invalid payloads', async () => {
  const database = new SqliteD1();
  seedUsers(database);

  const malformed = await rawCall(database, '/api/admin/announcements', { body: '{' });
  assert.equal(malformed.response.status, 400);
  assert.deepEqual(malformed.body, { error: 'INVALID_JSON' });

  const empty = await call(database, '/api/admin/announcements', {
    method: 'POST',
    body: {}
  });
  assert.equal(empty.response.status, 400);
  assert.deepEqual(empty.body, { error: 'ANNOUNCEMENT_TITLE_REQUIRED' });

  for (const [field, expected] of [
    ['title', 'ANNOUNCEMENT_TITLE_REQUIRED'],
    ['content', 'ANNOUNCEMENT_CONTENT_REQUIRED']
  ]) {
    const result = await call(database, '/api/admin/announcements', {
      method: 'POST',
      body: { ...validAnnouncement, [field]: '   ' }
    });
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.body, { error: expected });
  }

  const invalidDate = await call(database, '/api/admin/announcements', {
    method: 'POST',
    body: { ...validAnnouncement, start_date: '2026-02-30' }
  });
  assert.equal(invalidDate.response.status, 400);
  assert.deepEqual(invalidDate.body, { error: 'INVALID_DATE' });

  const reversed = await call(database, '/api/admin/announcements', {
    method: 'POST',
    body: { ...validAnnouncement, start_date: '2026-09-20', end_date: '2026-09-10' }
  });
  assert.equal(reversed.response.status, 400);
  assert.deepEqual(reversed.body, { error: 'ANNOUNCEMENT_DATE_RANGE_INVALID' });

  const invalidBoolean = await call(database, '/api/admin/announcements', {
    method: 'POST',
    body: { ...validAnnouncement, enabled: 'true' }
  });
  assert.equal(invalidBoolean.response.status, 400);
  assert.deepEqual(invalidBoolean.body, { error: 'ANNOUNCEMENT_ENABLED_INVALID' });

  const unknownField = await call(database, '/api/admin/announcements', {
    method: 'POST',
    body: { ...validAnnouncement, source_order: 99 }
  });
  assert.equal(unknownField.response.status, 400);
  assert.deepEqual(unknownField.body, { error: 'ANNOUNCEMENT_UNKNOWN_FIELD' });

  const created = await call(database, '/api/admin/announcements', {
    method: 'POST',
    body: validAnnouncement
  });
  const emptyPatch = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'PATCH',
    body: {}
  });
  assert.equal(emptyPatch.response.status, 400);
  assert.deepEqual(emptyPatch.body, { error: 'ANNOUNCEMENT_PATCH_EMPTY' });

  const unknownPatchField = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'PATCH',
    body: { source_order: 2 }
  });
  assert.equal(unknownPatchField.response.status, 400);
  assert.deepEqual(unknownPatchField.body, { error: 'ANNOUNCEMENT_UNKNOWN_FIELD' });

  const invalidPatchRange = await call(database, `/api/admin/announcements/${created.body.id}`, {
    method: 'PATCH',
    body: { end_date: '2026-09-01' }
  });
  assert.equal(invalidPatchRange.response.status, 400);
  assert.deepEqual(invalidPatchRange.body, { error: 'ANNOUNCEMENT_DATE_RANGE_INVALID' });
});

test('Admin list includes every state and preserves source-order precedence', async () => {
  const database = new SqliteD1();
  seedUsers(database);
  seedAnnouncement(database, {
    id: 'imported-1',
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    sourceOrder: 1
  });
  seedAnnouncement(database, {
    id: 'imported-2',
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    sourceOrder: 2
  });
  seedAnnouncement(database, {
    id: 'imported-3',
    startDate: '2026-08-01',
    endDate: '2026-08-02',
    sourceOrder: 3
  });
  seedAnnouncement(database, {
    id: 'disabled',
    startDate: '2026-09-07',
    endDate: '2026-09-09',
    enabled: 0
  });
  seedAnnouncement(database, {
    id: 'future',
    startDate: '2026-09-20',
    endDate: '2026-09-21'
  });
  seedAnnouncement(database, {
    id: 'expired',
    startDate: '2026-08-10',
    endDate: '2026-08-11'
  });
  seedAnnouncement(database, {
    id: 'active',
    startDate: '2026-09-08',
    endDate: '2026-09-08'
  });

  const first = await call(database, '/api/admin/announcements');
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.body.announcements.map((item) => item.id), [
    'future',
    'active',
    'disabled',
    'expired',
    'imported-3',
    'imported-2',
    'imported-1'
  ]);
  assert.equal(first.body.announcements.find((item) => item.id === 'disabled').enabled, false);
  assert.equal(first.body.announcements.find((item) => item.id === 'future').enabled, true);
  assert.equal(first.body.announcements.find((item) => item.id === 'expired').enabled, true);
  assert.equal('source_order' in first.body.announcements[0], false);

  const createdA = await call(database, '/api/admin/announcements', {
    method: 'POST',
    body: {
      ...validAnnouncement,
      start_date: '2026-09-15',
      end_date: '2026-09-16',
      title: 'Created A'
    }
  });
  const createdB = await call(database, '/api/admin/announcements', {
    method: 'POST',
    body: {
      ...validAnnouncement,
      start_date: '2026-09-15',
      end_date: '2026-09-16',
      title: 'Created B'
    }
  });
  assert.equal(database.get(
    'SELECT source_order FROM announcements WHERE announcement_id = ?',
    createdA.body.id
  ).source_order, 0);
  assert.equal(database.get(
    'SELECT source_order FROM announcements WHERE announcement_id = ?',
    createdB.body.id
  ).source_order, 0);

  const listed = await call(database, '/api/admin/announcements');
  const createdIds = listed.body.announcements
    .filter((item) => [createdA.body.id, createdB.body.id].includes(item.id))
    .map((item) => item.id);
  assert.deepEqual(createdIds, [createdA.body.id, createdB.body.id].sort().reverse());

  const publicCalendar = await call(database, '/api/calendar', { role: 'User' });
  assert.equal(publicCalendar.response.status, 200);
  assert.deepEqual(publicCalendar.body.announcements.map((item) => item.id), ['active']);
});

