import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest, profileFetch, request, seedUser } from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const NOW = new Date('2026-09-08T04:00:00.000Z');

const call = async (database, path, who, options = {}) => {
  const response = await handleFormalRequest(
    request(path, { ...options, token: `${who}-token` }),
    { DB: database },
    { fetchImpl: profileFetch({ token: `${who}-token`, lineUserId: who, displayName: who }), now: NOW }
  );
  return { response, body: await response.json() };
};

const seed = () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1' });
  seedUser(database, { lineUserId: 'user-2' });
  seedUser(database, { lineUserId: 'admin-1', role: 'Admin' });
  return database;
};

const submit = (database, who, body) => call(database, '/api/me/feedback', who, { method: 'POST', body });

test('submit feedback; only the submitter and Admin can read it', async () => {
  const database = seed();
  const created = await submit(database, 'user-1', {
    category: 'MENU', targetName: '禾拾', rating: 4, message: '菜色很好'
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.body.feedback.rating, 4);
  assert.equal(created.body.feedback.status, 'NEW');

  const mine = await call(database, '/api/me/feedback', 'user-1');
  assert.equal(mine.body.feedback.length, 1);
  const other = await call(database, '/api/me/feedback', 'user-2');
  assert.equal(other.body.feedback.length, 0);

  const denied = await call(database, '/api/admin/feedback', 'user-2');
  assert.equal(denied.response.status, 403);
  const admin = await call(database, '/api/admin/feedback', 'admin-1');
  assert.equal(admin.body.feedback.length, 1);
  assert.equal(admin.body.feedback[0].submitterName, 'user-1');
  assert.equal(admin.body.summary.newCount, 1);
  assert.equal(admin.body.summary.averageRating, 4);
});

test('anonymous feedback hides the submitter name from Admin', async () => {
  const database = seed();
  await submit(database, 'user-1', { category: 'SYSTEM', message: '希望有深色模式', isAnonymous: true });
  const admin = await call(database, '/api/admin/feedback', 'admin-1');
  assert.equal(admin.body.feedback[0].submitterName, null);
  assert.equal(admin.body.feedback[0].isAnonymous, true);
  assert.doesNotMatch(JSON.stringify(admin.body), /user-1/);
});

test('validation and daily limit', async () => {
  const database = seed();
  assert.equal((await submit(database, 'user-1', { category: 'X', message: 'a' })).response.status, 400);
  assert.equal((await submit(database, 'user-1', { category: 'OTHER', message: '  ' })).response.status, 400);
  assert.equal((await submit(database, 'user-1', { category: 'OTHER', message: 'a', rating: 6 })).response.status, 400);
  assert.equal((await submit(database, 'user-1', { category: 'OTHER', message: 'a'.repeat(1001) })).response.status, 400);
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await submit(database, 'user-1', { category: 'OTHER', message: `m${i}` })).response.status, 200);
  }
  assert.equal((await submit(database, 'user-1', { category: 'OTHER', message: 'm6' })).response.status, 429);
  assert.equal((await submit(database, 'user-2', { category: 'OTHER', message: 'ok' })).response.status, 200);
});

test('Admin marks feedback handled; non-admin cannot', async () => {
  const database = seed();
  const created = await submit(database, 'user-1', { category: 'VENDOR', message: '太鹹' });
  const id = created.body.feedback.feedbackId;
  const denied = await call(database, `/api/admin/feedback/${id}/status`, 'user-1', {
    method: 'POST', body: { status: 'DONE' }
  });
  assert.equal(denied.response.status, 403);
  const done = await call(database, `/api/admin/feedback/${id}/status`, 'admin-1', {
    method: 'POST', body: { status: 'DONE', note: '已轉知廠商' }
  });
  assert.equal(done.response.status, 200);
  assert.equal(done.body.feedback.status, 'DONE');
  const mine = await call(database, '/api/me/feedback', 'user-1');
  assert.equal(mine.body.feedback[0].adminNote, '已轉知廠商');
  assert.equal(database.get("SELECT COUNT(*) AS c FROM admin_audit_log WHERE action = 'FEEDBACK_STATUS_UPDATED'").c, 1);
  const bad = await call(database, `/api/admin/feedback/${id}/status`, 'admin-1', {
    method: 'POST', body: { status: 'NOPE' }
  });
  assert.equal(bad.response.status, 400);
  const missing = await call(database, '/api/admin/feedback/nope/status', 'admin-1', {
    method: 'POST', body: { status: 'DONE' }
  });
  assert.equal(missing.response.status, 404);
});
