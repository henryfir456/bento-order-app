import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchLineProfile } from '../src/auth/lineProfile.js';

for (const phase of ['fetch', 'body']) {
  test(`LINE profile ${phase} timeout fails closed; retry can recover`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal;
    const result = fetchLineProfile('token', async (_url, options) => {
      signal = options.signal;
      if (phase === 'fetch') return new Promise(() => {});
      return { ok: true, json: () => new Promise(() => {}) };
    });
    const rejected = assert.rejects(result, (e) => e.code === 'LINE_PROFILE_TIMEOUT' && e.status === 503);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    t.mock.timers.tick(10000);
    await rejected;
    assert.equal(signal.aborted, true);
    const fresh = await fetchLineProfile('token', async () => ({ ok: true, json: async () => ({ userId: 'verified' }) }));
    assert.equal(fresh.lineUserId, 'verified');
  });
}
