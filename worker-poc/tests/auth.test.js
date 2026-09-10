import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchLineProfile } from '../src/auth/lineProfile.js';
import { resolveCanonicalIdentity } from '../src/auth/identity.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

test('LINE profile verification uses Bearer token and canonical userId', async () => {
  const profile = await fetchLineProfile(
    'token-user',
    profileFetch({ lineUserId: 'line-user-1', displayName: 'Profile Name' })
  );
  assert.deepEqual(profile, {
    lineUserId: 'line-user-1',
    displayName: 'Profile Name'
  });
});

test('missing and rejected tokens return stable TOKEN_INVALID', async () => {
  await assert.rejects(
    () => fetchLineProfile('', profileFetch()),
    (error) => error.code === 'TOKEN_INVALID' && error.status === 401
  );
  await assert.rejects(
    () => fetchLineProfile('wrong-token', profileFetch()),
    (error) => error.code === 'TOKEN_INVALID' && error.status === 401
  );
});

test('identity resolution ignores forged userId and preserves unregistered state', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    lineUserId: 'canonical-user',
    displayName: 'Canonical User'
  });
  const identity = await resolveCanonicalIdentity(
    request('/api/me?userId=forged-user', { token: 'token-user' }),
    { DB: database },
    profileFetch({
      token: 'token-user',
      lineUserId: 'canonical-user',
      displayName: 'Profile Display Name'
    })
  );

  assert.equal(identity.actor.lineUserId, 'canonical-user');
  assert.equal(identity.actor.displayName, 'Canonical User');
  assert.equal(identity.authorizationActor.lineUserId, 'canonical-user');
  assert.equal(identity.effectiveSubject.lineUserId, 'canonical-user');
  assert.equal(identity.viewAs, null);

  const unregistered = await resolveCanonicalIdentity(
    request('/api/me?userId=canonical-user', { token: 'token-new' }),
    { DB: database },
    profileFetch({
      token: 'token-new',
      lineUserId: 'new-user',
      displayName: 'New User'
    })
  );
  assert.equal(unregistered.actor.lineUserId, 'new-user');
  assert.equal(unregistered.actor.registered, false);
  assert.equal(unregistered.effectiveSubject.lineUserId, 'new-user');
});

test('View As is admin-only and keeps authorization actor separate', async () => {
  const database = new SqliteD1();
  seedUser(database, {
    lineUserId: 'admin-1',
    displayName: 'Admin',
    role: 'Admin'
  });
  seedUser(database, {
    lineUserId: 'subject-1',
    displayName: 'Subject'
  });

  const identity = await resolveCanonicalIdentity(
    request('/api/orders/map?viewAs=subject-1&userId=forged-user', {
      token: 'token-admin'
    }),
    { DB: database },
    profileFetch({
      token: 'token-admin',
      lineUserId: 'admin-1',
      displayName: 'Profile Admin'
    }),
    { allowViewAs: true }
  );
  assert.equal(identity.authorizationActor.lineUserId, 'admin-1');
  assert.equal(identity.authorizationActor.role, 'Admin');
  assert.equal(identity.effectiveSubject.lineUserId, 'subject-1');
  assert.deepEqual(identity.viewAs, {
    targetUserId: 'subject-1',
    actorUserId: 'admin-1'
  });

  await assert.rejects(
    () => resolveCanonicalIdentity(
      request('/api/orders/map?viewAs=subject-1', { token: 'token-user' }),
      { DB: database },
      profileFetch({ token: 'token-user', lineUserId: 'subject-1' }),
      { allowViewAs: true }
    ),
    (error) => error.code === 'VIEW_AS_FORBIDDEN' && error.status === 403
  );
});
