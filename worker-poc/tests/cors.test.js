import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import {
  CORS_HEADERS,
  PRODUCTION_FRONTEND_ORIGIN
} from '../src/http/response.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch } from './helpers/formal-fixtures.js';

const request = (url, options = {}) => new Request(`https://worker.test${url}`, options);

const localEnv = (origins) => ({
  CORS_MODE: 'local',
  DEV_ALLOWED_ORIGINS: origins
});

const remoteTestEnv = () => ({
  CORS_MODE: 'remote-test'
});

const remoteTestPinggyOrigin = 'https://abc-123.run.pinggy-free.link';

const callMe = async (origin, env = {}, options = {}) => {
  const database = new SqliteD1();
  return handleFormalRequest(request('/api/me', {
    headers: {
      Origin: origin,
      Authorization: 'Bearer test-token',
      ...(options.headers || {})
    }
  }), { DB: database, ...env }, {
    fetchImpl: profileFetch({ token: 'test-token', lineUserId: 'test-user' }),
    ...options
  });
};

const assertCorsAllowed = (response, origin) => {
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), CORS_HEADERS['Access-Control-Allow-Headers']);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), CORS_HEADERS['Access-Control-Allow-Methods']);
  assert.equal(response.headers.get('Vary'), 'Origin');
};

const assertCorsDenied = (response) => {
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), null);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), null);
  assert.equal(response.headers.get('Vary'), 'Origin');
};

test('production CORS allows the Netlify origin and Authorization header', async () => {
  const response = await callMe(PRODUCTION_FRONTEND_ORIGIN);

  assert.equal(response.status, 200);
  assertCorsAllowed(response, PRODUCTION_FRONTEND_ORIGIN);
});

test('localhost is rejected without local CORS config', async () => {
  const response = await callMe('http://localhost:5173');

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('Pinggy is rejected without remote-test CORS mode', async () => {
  const response = await callMe(remoteTestPinggyOrigin);

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('remote-test CORS allows a single-label Pinggy origin', async () => {
  const origin = remoteTestPinggyOrigin;
  const response = await callMe(origin, remoteTestEnv());

  assert.equal(response.status, 200);
  assertCorsAllowed(response, origin);
});

test('remote-test CORS rejects nonconforming Pinggy origins', async () => {
  const invalidOrigins = [
    'https://pinggy-free.link',
    'https://run.pinggy-free.link',
    'https://foo.pinggy-free.link',
    'https://foo.bar.run.pinggy-free.link',
    'http://foo.run.pinggy-free.link',
    'https://foo.run.pinggy-free.link:443',
    'https://foo.run.pinggy-free.link/path',
    'https://*.run.pinggy-free.link'
  ];

  for (const origin of invalidOrigins) {
    const response = await callMe(origin, remoteTestEnv());

    assert.equal(response.status, 200, origin);
    assertCorsDenied(response);
  }
});

test('localhost is allowed when explicitly configured in local mode', async () => {
  const origin = 'http://localhost:5173';
  const response = await callMe(origin, localEnv(` ${origin} `));

  assert.equal(response.status, 200);
  assertCorsAllowed(response, origin);
});

test('127.0.0.1 is allowed only when explicitly configured', async () => {
  const origin = 'http://127.0.0.1:5173';
  const response = await callMe(origin, localEnv(origin));

  assert.equal(response.status, 200);
  assertCorsAllowed(response, origin);
});

test('the exact configured Pinggy frontend origin is allowed', async () => {
  const origin = 'https://bento-local-123.run.pinggy-free.link';
  const response = await callMe(origin, localEnv(origin));

  assert.equal(response.status, 200);
  assertCorsAllowed(response, origin);
});

test('a different Pinggy origin is rejected', async () => {
  const configuredOrigin = 'https://bento-local-123.run.pinggy-free.link';
  const response = await callMe(
    'https://different-local-123.run.pinggy-free.link',
    localEnv(configuredOrigin)
  );

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('wildcard Pinggy configuration does not grant access', async () => {
  const response = await callMe(
    'https://bento-local-123.run.pinggy-free.link',
    localEnv('https://*.run.pinggy-free.link')
  );

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('arbitrary origins remain rejected in local mode', async () => {
  const response = await callMe(
    'https://arbitrary.example',
    localEnv('http://localhost:5173')
  );

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('local allowlist is ignored unless CORS_MODE is local', async () => {
  const response = await callMe('http://localhost:5173', {
    DEV_ALLOWED_ORIGINS: 'http://localhost:5173'
  });

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('unsafe and malformed local entries are ignored', async () => {
  const response = await callMe(
    'http://localhost:5173',
    localEnv('*,https://*.run.pinggy-free.link,not-an-origin,http://localhost:5173/path')
  );

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('OPTIONS preserves the production CORS preflight contract without local config', async () => {
  const response = await handleFormalRequest(request('/api/me', {
    method: 'OPTIONS',
    headers: {
      Origin: PRODUCTION_FRONTEND_ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization, Content-Type, Idempotency-Key'
    }
  }), {});

  assert.equal(response.status, 204);
  assertCorsAllowed(response, PRODUCTION_FRONTEND_ORIGIN);
});

test('OPTIONS preserves the CORS preflight contract in local mode', async () => {
  const origin = 'http://localhost:5173';
  const response = await handleFormalRequest(request('/api/me', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization, Content-Type, Idempotency-Key'
    }
  }), localEnv(origin));

  assert.equal(response.status, 204);
  assertCorsAllowed(response, origin);
});

test('OPTIONS preserves the CORS preflight contract in remote-test mode', async () => {
  const origin = remoteTestPinggyOrigin;
  const response = await handleFormalRequest(request('/api/me', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization, Content-Type, Idempotency-Key'
    }
  }), remoteTestEnv());

  assert.equal(response.status, 204);
  assertCorsAllowed(response, origin);
});

test('error responses use the same CORS policy', async () => {
  const allowed = await handleFormalRequest(request('/api/me', {
    headers: { Origin: 'http://localhost:5173' }
  }), localEnv('http://localhost:5173'));

  assert.equal(allowed.status, 401);
  assertCorsAllowed(allowed, 'http://localhost:5173');

  const denied = await handleFormalRequest(request('/api/me', {
    headers: { Origin: 'https://arbitrary.example' }
  }), localEnv('http://localhost:5173'));

  assert.equal(denied.status, 401);
  assertCorsDenied(denied);

  const remoteTest = await handleFormalRequest(request('/api/me', {
    headers: { Origin: remoteTestPinggyOrigin }
  }), remoteTestEnv());

  assert.equal(remoteTest.status, 401);
  assertCorsAllowed(remoteTest, remoteTestPinggyOrigin);
});
