import assert from 'node:assert/strict';
import test from 'node:test';
import { getLineFriendship } from '../src/domain/lineFriendship.js';

const identity = { actor: { userId: 'u1', lineUserId: 'Uabc' } };
const env = { LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'tok' };
const reply = (status) => async () => ({ status });

test('friend when LINE returns 200', async () => {
  assert.equal((await getLineFriendship(env, identity, { fetchImpl: reply(200) })).status, 'FRIEND');
});

test('not friend only on 404', async () => {
  assert.equal((await getLineFriendship(env, identity, { fetchImpl: reply(404) })).status, 'NOT_FRIEND');
});

test('unknown on other statuses, errors, missing token or binding', async () => {
  for (const status of [401, 429, 500]) {
    assert.equal((await getLineFriendship(env, identity, { fetchImpl: reply(status) })).status, 'UNKNOWN');
  }
  const boom = async () => { throw new Error('timeout'); };
  assert.equal((await getLineFriendship(env, identity, { fetchImpl: boom })).status, 'UNKNOWN');
  assert.equal((await getLineFriendship({}, identity, { fetchImpl: reply(404) })).status, 'UNKNOWN');
  assert.equal((await getLineFriendship(env, { actor: { userId: 'u1' } }, { fetchImpl: reply(404) })).status, 'UNKNOWN');
});
