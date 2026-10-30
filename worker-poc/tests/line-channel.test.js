import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTokenIssuedForChannel } from '../src/auth/lineChannel.js';

const verifyWith = (body, ok = true, status = ok ? 200 : 400) => async () => ({ ok, status, json: async () => body });

test('accepts a token issued to our channel and rejects others', async () => {
  await assertTokenIssuedForChannel('tok-a', '111', verifyWith({ client_id: '111', expires_in: 900 }));
  await assert.rejects(
    assertTokenIssuedForChannel('tok-b', '111', verifyWith({ client_id: '999', expires_in: 900 })),
    (e) => e.status === 401 && e.code === 'TOKEN_INVALID'
  );
  await assert.rejects(
    assertTokenIssuedForChannel('tok-c', '111', verifyWith({}, false)),
    (e) => e.status === 401
  );
});

test('skips verification when no channel is configured and caches successes', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({ client_id: '111', expires_in: 900 }) }; };
  await assertTokenIssuedForChannel('tok-d', '', fetchImpl);
  assert.equal(calls, 0);
  await assertTokenIssuedForChannel('tok-e', '111', fetchImpl);
  await assertTokenIssuedForChannel('tok-e', '111', fetchImpl);
  assert.equal(calls, 1);
});

test('verify outages are retryable 503s, not token rejections', async () => {
  await assert.rejects(
    assertTokenIssuedForChannel('tok-f', '111', verifyWith({}, false, 503)),
    (e) => e.status === 503 && e.code === 'LINE_VERIFY_UNAVAILABLE'
  );
  await assert.rejects(
    assertTokenIssuedForChannel('tok-g', '111', async () => { throw new TypeError('network'); }),
    (e) => e.status === 503 && e.code === 'LINE_VERIFY_UNAVAILABLE'
  );
});
