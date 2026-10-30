import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedChannelIds, assertTokenIssuedForChannel } from '../src/auth/lineChannel.js';

const verifyWith = (body, ok = true, status = ok ? 200 : 500) => async () => ({ ok, status, json: async () => body });
const good = { client_id: '111', expires_in: 900 };
const NOW = Date.now();

test('enforce mode accepts our channels and rejects others', async () => {
  await assertTokenIssuedForChannel('tok-a', '111', verifyWith(good), NOW, 'enforce');
  await assertTokenIssuedForChannel('tok-a2', '222, 111', verifyWith(good), NOW, 'enforce');
  await assert.rejects(
    assertTokenIssuedForChannel('tok-b', '111', verifyWith({ client_id: '999', expires_in: 900 }), NOW, 'enforce'),
    (e) => e.status === 401 && e.code === 'TOKEN_INVALID'
  );
});

test('enforce mode treats LINE outages as retryable 503 and token rejections as 401', async () => {
  await assert.rejects(
    assertTokenIssuedForChannel('tok-c', '111', verifyWith({}, false, 502), NOW, 'enforce'),
    (e) => e.status === 503 && e.code === 'LINE_VERIFY_UNAVAILABLE'
  );
  await assert.rejects(
    assertTokenIssuedForChannel('tok-c2', '111', verifyWith({}, false, 429), NOW, 'enforce'),
    (e) => e.status === 503
  );
  await assert.rejects(
    assertTokenIssuedForChannel('tok-c3', '111', async () => { throw new TypeError('network'); }, NOW, 'enforce'),
    (e) => e.status === 503
  );
  await assert.rejects(
    assertTokenIssuedForChannel('tok-c4', '111', verifyWith({}, false, 400), NOW, 'enforce'),
    (e) => e.status === 401
  );
});

test('report mode never blocks, even on mismatch or LINE failure', async () => {
  await assertTokenIssuedForChannel('tok-d', '111', verifyWith({ client_id: '999', expires_in: 900 }), NOW);
  await assertTokenIssuedForChannel('tok-d2', '111', verifyWith({}, false, 500), NOW, 'report');
  await assertTokenIssuedForChannel('tok-d3', '111', async () => { throw new Error('x'); }, NOW);
});

test('skips verification when no channel is configured and caches successes', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, json: async () => good }; };
  await assertTokenIssuedForChannel('tok-e', '', fetchImpl, NOW, 'enforce');
  assert.equal(calls, 0);
  await assertTokenIssuedForChannel('tok-f', '111', fetchImpl, NOW, 'enforce');
  await assertTokenIssuedForChannel('tok-f', '111', fetchImpl, NOW, 'enforce');
  assert.equal(calls, 1);
});

test('channel list parsing ignores blanks', () => {
  assert.deepEqual(allowedChannelIds(' 1, ,2 ,'), ['1', '2']);
  assert.deepEqual(allowedChannelIds(undefined), []);
});
