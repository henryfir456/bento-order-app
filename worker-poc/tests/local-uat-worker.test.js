import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createLocalUatProfileFetch,
  handleLocalUatRequest
} from '../src/localUatWorker.js';

const env = {
  LOCAL_UAT_MODE: '1',
  LOCAL_UAT_TOKEN_SECRET: 'synthetic-only-secret-for-unit-test',
  LOCAL_UAT_PASSWORD_ADMIN: 'synthetic-admin-passphrase',
  LOCAL_UAT_PASSWORD_USER: 'synthetic-user-passphrase',
  LOCAL_UAT_PASSWORD_VENDOR_ONE: 'synthetic-vendor-passphrase',
  LOCAL_UAT_PASSWORD_VENDOR_TWO: 'synthetic-vendor-two-passphrase',
  DEV_ALLOWED_ORIGINS: 'http://localhost:5173',
  CORS_MODE: 'local'
};
const syntheticVendorOne = 'V' + String(1).padStart(5, '0');

const login = (payload, runtime = env) => handleLocalUatRequest(
  new Request('http://localhost:8787/__local-uat/session', {
    method: 'POST',
    headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }),
  runtime
);

test('synthetic local UAT login issues an expiring token accepted only by the LINE profile adapter', async () => {
  const response = await login({ role: 'admin', password: env.LOCAL_UAT_PASSWORD_ADMIN });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.match(body.accessToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal('password' in body, false);

  const fetchImpl = createLocalUatProfileFetch(env);
  const profile = await fetchImpl('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${body.accessToken}` }
  });
  assert.equal(profile.status, 200);
  assert.deepEqual(await profile.json(), {
    userId: 'local-uat-line-admin',
    displayName: '合成 Admin'
  });
  assert.equal((await fetchImpl('https://example.invalid/', {})).status, 503);
});

test('synthetic Vendor ' + syntheticVendorOne + ' login is bound to its local identity', async () => {
  const response = await login({ role: 'vendor-one', password: env.LOCAL_UAT_PASSWORD_VENDOR_ONE });
  assert.equal(response.status, 200);
  const body = await response.json();
  const profile = await createLocalUatProfileFetch(env)('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${body.accessToken}` }
  });
  assert.deepEqual(await profile.json(), {
    userId: 'local-uat-line-vendor-one',
    displayName: `合成 Vendor V${String(1).padStart(5, '0')}`
  });
});

test('local UAT login rejects unknown roles, invalid passwords, and disabled mode', async () => {
  const unknownRole = await login({ role: 'root', password: 'anything' });
  assert.equal(unknownRole.status, 401);
  assert.equal((await unknownRole.json()).error, 'LOCAL_UAT_LOGIN_REJECTED');

  const badPassword = await login({ role: 'admin', password: 'wrong' });
  assert.equal(badPassword.status, 401);
  assert.equal((await badPassword.json()).error, 'LOCAL_UAT_LOGIN_REJECTED');

  const disabled = await login({
    role: 'admin', password: env.LOCAL_UAT_PASSWORD_ADMIN
  }, { ...env, LOCAL_UAT_MODE: '0' });
  assert.equal(disabled.status, 404);
});
