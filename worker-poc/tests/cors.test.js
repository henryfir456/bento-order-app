import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import {
  CORS_HEADERS,
  PRODUCTION_FRONTEND_ORIGIN
} from '../src/http/response.js';
import {
  CORS_SMOKE_ALLOWED_ORIGINS,
  CORS_SMOKE_PINGGY_ORIGIN,
  CORS_SMOKE_REJECTED_ORIGIN,
  runCorsSmoke
} from '../scripts/remote-cors-smoke.mjs';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, seedUser } from './helpers/formal-fixtures.js';

const LOCAL_DEVELOPMENT_ORIGIN = 'http://localhost:5173';

const request = (url, options = {}) => new Request(`https://worker.test${url}`, options);

const localEnv = (origins) => ({
  CORS_MODE: 'local',
  DEV_ALLOWED_ORIGINS: origins
});

const remoteTestEnv = (origins = '') => ({
  CORS_MODE: 'remote-test',
  DEV_ALLOWED_ORIGINS: origins
});

const remoteTestPinggyOrigin = 'https://abc-123.run.pinggy-free.link';
const currentRunPinggyOrigin = 'https://current-session.run.pinggy.link';

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

const callFormal = async (
  path,
  {
    method = 'GET',
    headers = {},
    body,
    database = new SqliteD1(),
    env = {},
    fetchImpl = profileFetch()
  } = {}
) => {
  const requestHeaders = {
    Origin: LOCAL_DEVELOPMENT_ORIGIN,
    ...headers
  };
  const requestOptions = {
    method,
    headers: requestHeaders
  };
  if (body !== undefined) {
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
    requestOptions.body = JSON.stringify(body);
  }
  return handleFormalRequest(
    request(path, requestOptions),
    { DB: database, ...env },
    { fetchImpl }
  );
};

const assertCorsAllowed = (response, origin) => {
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), CORS_HEADERS['Access-Control-Allow-Headers']);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), CORS_HEADERS['Access-Control-Allow-Methods']);
  assert.equal(response.headers.get('Vary'), 'Origin');
  const allowedHeaders = new Set(
    CORS_HEADERS['Access-Control-Allow-Headers'].split(',').map((header) => header.trim().toLowerCase())
  );
  for (const requiredHeader of ['Authorization', 'Content-Type', 'X-Employee-Guest-Session']) {
    assert.equal(allowedHeaders.has(requiredHeader.toLowerCase()), true, requiredHeader);
  }
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

test('remote-test CORS retains the Netlify origin', async () => {
  const response = await callMe(PRODUCTION_FRONTEND_ORIGIN, remoteTestEnv());

  assert.equal(response.status, 200);
  assertCorsAllowed(response, PRODUCTION_FRONTEND_ORIGIN);
});

test('localhost is allowed without CORS runtime configuration', async () => {
  const response = await callMe('http://localhost:5173');

  assert.equal(response.status, 200);
  assertCorsAllowed(response, 'http://localhost:5173');
});

test('127.0.0.1 is allowed without CORS runtime configuration', async () => {
  const origin = 'http://127.0.0.1:5173';
  const response = await callMe(origin);

  assert.equal(response.status, 200);
  assertCorsAllowed(response, origin);
});

test('dynamic Pinggy origins are allowed without remote-test CORS mode', async () => {
  for (const origin of [
    remoteTestPinggyOrigin,
    'https://generated-session-123.run.pinggy-free.link',
    'https://another-generated-session-456.run.pinggy-free.link',
    'https://fwmud-2001-b400-e253-5bd1-40d1-f2d3-c356-1708.run.pinggy-free.link'
  ]) {
    const response = await callMe(origin);

    assert.equal(response.status, 200);
    assertCorsAllowed(response, origin);
  }
});

test('dynamic Pinggy OPTIONS is allowed without remote-test CORS mode', async () => {
  const response = await handleFormalRequest(request('/api/me', {
    method: 'OPTIONS',
    headers: {
      Origin: remoteTestPinggyOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization'
    }
  }), {});

  assert.equal(response.status, 204);
  assertCorsAllowed(response, remoteTestPinggyOrigin);
});

test('dynamic Pinggy unauthenticated GET /api/me keeps CORS without remote-test mode', async () => {
  const response = await handleFormalRequest(request('/api/me', {
    headers: { Origin: remoteTestPinggyOrigin }
  }), {});

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'AUTH_REQUIRED' });
  assertCorsAllowed(response, remoteTestPinggyOrigin);
});

test('remote-test CORS allows a dynamic Pinggy subdomain without exact configuration', async () => {
  for (const origin of [
    'https://current-session.pinggy-free.link',
    'https://current-session.run.pinggy-free.link',
    currentRunPinggyOrigin
  ]) {
    const response = await callMe(origin, remoteTestEnv());

    assert.equal(response.status, 200);
    assertCorsAllowed(response, origin);
  }
});

test('remote-test CORS allows an exact configured Pinggy origin', async () => {
  const origin = remoteTestPinggyOrigin;
  const response = await callMe(origin, remoteTestEnv(origin));

  assert.equal(response.status, 200);
  assertCorsAllowed(response, origin);
});

test('remote-test CORS rejects nonconforming Pinggy origins', async () => {
  const invalidOrigins = [
    'https://pinggy-free.link',
    'https://run.pinggy-free.link',
    'https://foo_bar.pinggy-free.link',
    'https://foo.bar.run.pinggy-free.link',
    'http://foo.run.pinggy-free.link',
    'https://foo.run.pinggy-free.link:443',
    'https://foo.run.pinggy-free.link/path',
    'https://*.run.pinggy-free.link',
    'http://current-session.run.pinggy.link',
    'https://current-session.run.pinggy.link:443',
    'https://current-session.run.pinggy.link/path',
    'https://*.run.pinggy.link',
    'https://foo.bar.run.pinggy.link',
    'https://pinggy.link',
    'https://foo.pinggy.link',
    'https://run.pinggy.link'
  ];

  for (const origin of invalidOrigins) {
    const response = await callMe(origin, remoteTestEnv());

    assert.equal(response.status, 200, origin);
    assertCorsDenied(response);
  }
});

test('invalid Pinggy origins remain rejected without remote-test CORS mode', async () => {
  for (const origin of [
    'http://generated-session.run.pinggy-free.link',
    'https://generated-session.run.pinggy.example',
    'https://generated-session.run.pinggy-free.link/path',
    'https://generated-session.run.pinggy-free.link:443',
    'https://generated-session.run.pinggy-free.link:80',
    'https://generated-session.run.pinggy-free.link:8443',
    'https://generated.session.run.pinggy-free.link',
    'https://*.run.pinggy-free.link'
  ]) {
    const response = await callMe(origin);

    assert.equal(response.status, 200, origin);
    assertCorsDenied(response);
  }
});

test('remote-test CORS rejects arbitrary origins', async () => {
  const response = await callMe('https://arbitrary.example', remoteTestEnv());

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('unknown arbitrary origin is rejected without remote-test CORS mode', async () => {
  const response = await callMe('https://arbitrary.example');

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('remote-test wildcard configuration does not grant access', async () => {
  const response = await callMe(
    'https://arbitrary.example',
    remoteTestEnv('https://*.run.pinggy-free.link')
  );

  assert.equal(response.status, 200);
  assertCorsDenied(response);
});

test('localhost is allowed when explicitly configured in local mode', async () => {
  const origin = LOCAL_DEVELOPMENT_ORIGIN;
  const response = await callMe(origin, localEnv(` ${origin} `));

  assert.equal(response.status, 200);
  assertCorsAllowed(response, origin);
});

test('localhost is allowed in explicit local and remote-test modes', async () => {
  for (const env of [localEnv(''), remoteTestEnv()]) {
    const response = await callMe(LOCAL_DEVELOPMENT_ORIGIN, env);

    assert.equal(response.status, 200);
    assertCorsAllowed(response, LOCAL_DEVELOPMENT_ORIGIN);
  }
});

test('127.0.0.1 remains allowed when explicitly configured', async () => {
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

test('a different valid Pinggy origin remains allowed', async () => {
  const configuredOrigin = 'https://bento-local-123.run.pinggy-free.link';
  const origin = 'https://different-local-123.run.pinggy-free.link';
  const response = await callMe(
    origin,
    localEnv(configuredOrigin)
  );

  assert.equal(response.status, 200);
  assertCorsAllowed(response, origin);
});

test('wildcard Pinggy configuration does not grant access to malformed hosts', async () => {
  const origin = 'https://bento.local-123.run.pinggy-free.link';
  const response = await callMe(
    origin,
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

test('localhost remains allowed even when CORS_MODE is omitted', async () => {
  const response = await callMe('http://localhost:5173', {
    DEV_ALLOWED_ORIGINS: 'http://localhost:5173'
  });

  assert.equal(response.status, 200);
  assertCorsAllowed(response, 'http://localhost:5173');
});

test('unsafe and malformed local entries are ignored', async () => {
  const response = await callMe(
    'http://localhost:5174',
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

test('OPTIONS allows both stable localhost origins without CORS runtime configuration', async () => {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
    const response = await handleFormalRequest(request('/api/me', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization'
      }
    }), {});

    assert.equal(response.status, 204);
    assertCorsAllowed(response, origin);
  }
});

test('unauthenticated GET /api/me keeps CORS for both stable localhost origins', async () => {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
    const response = await handleFormalRequest(request('/api/me', {
      headers: { Origin: origin }
    }), {});

    assert.equal(response.status, 401);
    assertCorsAllowed(response, origin);
  }
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
  }), remoteTestEnv(origin));

  assert.equal(response.status, 204);
  assertCorsAllowed(response, origin);
});

test('current run.pinggy.link OPTIONS preserves the CORS preflight contract', async () => {
  const response = await handleFormalRequest(request('/api/me', {
    method: 'OPTIONS',
    headers: {
      Origin: currentRunPinggyOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization, Content-Type'
    }
  }), remoteTestEnv());

  assert.equal(response.status, 204);
  assertCorsAllowed(response, currentRunPinggyOrigin);
});

test('employee guest OPTIONS allows localhost and required authenticated headers', async () => {
  const response = await handleFormalRequest(request('/api/auth/employee-guest', {
    method: 'OPTIONS',
    headers: {
      Origin: LOCAL_DEVELOPMENT_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Authorization, Content-Type, X-Employee-Guest-Session'
    }
  }), remoteTestEnv());

  assert.equal(response.status, 204);
  assertCorsAllowed(response, LOCAL_DEVELOPMENT_ORIGIN);
  assert.match(response.headers.get('Access-Control-Allow-Methods'), /(^|, )POST(,|$)/);
  for (const header of ['Authorization', 'Content-Type', 'X-Employee-Guest-Session']) {
    assert.match(
      response.headers.get('Access-Control-Allow-Headers'),
      new RegExp(`(^|, )${header}(,|$)`, 'i')
    );
  }
});

test('employee guest OPTIONS allows the current run.pinggy.link origin', async () => {
  const response = await handleFormalRequest(request('/api/auth/employee-guest', {
    method: 'OPTIONS',
    headers: {
      Origin: currentRunPinggyOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type'
    }
  }), remoteTestEnv());

  assert.equal(response.status, 204);
  assertCorsAllowed(response, currentRunPinggyOrigin);
});

test('employee guest OPTIONS denies unknown remote-test origins', async () => {
  const response = await handleFormalRequest(request('/api/auth/employee-guest', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://arbitrary.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type'
    }
  }), remoteTestEnv());

  assert.equal(response.status, 204);
  assertCorsDenied(response);
});

test('OPTIONS advertises DELETE for formal announcement preflight', async () => {
  const response = await handleFormalRequest(request('/api/admin/announcements/announcement-1', {
    method: 'OPTIONS',
    headers: {
      Origin: PRODUCTION_FRONTEND_ORIGIN,
      'Access-Control-Request-Method': 'DELETE',
      'Access-Control-Request-Headers': 'Authorization, Content-Type'
    }
  }), {});

  assert.equal(response.status, 204);
  assertCorsAllowed(response, PRODUCTION_FRONTEND_ORIGIN);
  assert.match(response.headers.get('Access-Control-Allow-Methods'), /(^|, )DELETE(,|$)/);
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
  }), remoteTestEnv(remoteTestPinggyOrigin));

  assert.equal(remoteTest.status, 401);
  assertCorsAllowed(remoteTest, remoteTestPinggyOrigin);
});

test('uncaught runtime errors keep CORS for an allowed origin', async () => {
  const response = await handleFormalRequest(request('/api/me', {
    headers: {
      Origin: 'http://localhost:5173',
      Authorization: 'Bearer test-token'
    }
  }), {
    DB: {
      prepare() {
        throw new Error('synthetic runtime failure');
      }
    }
  }, {
    fetchImpl: profileFetch({ token: 'test-token', lineUserId: 'test-user' })
  });

  assert.equal(response.status, 500);
  assertCorsAllowed(response, 'http://localhost:5173');
});

test('read-only CORS smoke requires preflight and actual unauthenticated ACAO', async () => {
  const calls = [];
  const result = await runCorsSmoke({
    baseUrl: 'https://worker.test',
    fetchImpl: async (url, init = {}) => {
      const origin = init.headers?.Origin;
      calls.push([url, init.method || 'GET', origin]);
      const isPreflight = init.method === 'OPTIONS';
      const headers = origin && CORS_SMOKE_ALLOWED_ORIGINS.includes(origin)
        ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization',
          Vary: 'Origin'
        }
        : { Vary: 'Origin' };
      return new Response(
        isPreflight ? null : JSON.stringify({ error: 'AUTH_REQUIRED' }),
        { status: isPreflight ? 204 : 401, headers }
      );
    }
  });

  assert.equal(result.preflight, 'PASS');
  assert.equal(result.actualUnauthenticated, 'PASS');
  assert.equal(CORS_SMOKE_ALLOWED_ORIGINS.includes(CORS_SMOKE_PINGGY_ORIGIN), true);
  assert.deepEqual(calls.map(([, method, origin]) => [method, origin]), [
    ...CORS_SMOKE_ALLOWED_ORIGINS.flatMap((origin) => [['OPTIONS', origin], ['GET', origin]]),
    ['GET', CORS_SMOKE_REJECTED_ORIGIN]
  ]);
});

test('read-only CORS smoke fails when actual 401 loses ACAO', async () => {
  let pinggyActual = false;
  await assert.rejects(
    runCorsSmoke({
      baseUrl: 'https://worker.test',
      fetchImpl: async (_url, init = {}) => {
        const origin = init.headers.Origin;
        if (init.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': origin,
              'Access-Control-Allow-Methods': 'GET, OPTIONS',
              'Access-Control-Allow-Headers': 'Authorization',
              Vary: 'Origin'
            }
          });
        }
        if (origin === CORS_SMOKE_PINGGY_ORIGIN) pinggyActual = true;
        return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), {
          status: 401,
          headers: origin === CORS_SMOKE_PINGGY_ORIGIN
            ? { Vary: 'Origin' }
            : {
              'Access-Control-Allow-Origin': origin,
              Vary: 'Origin'
            }
        });
      }
    }),
    /GET https:\/\/cors-smoke-session\.run\.pinggy-free\.link ACAO/
  );
  assert.equal(pinggyActual, true);
});

test('success and 400/401/403/404/409 responses retain the allowed CORS boundary', async () => {
  const successDatabase = new SqliteD1();
  seedUser(successDatabase, {
    userId: 'cors-guest-user',
    employeeId: '001234',
    lineUserId: null,
    displayName: 'CORS Guest'
  });
  const success = await callFormal('/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '001234' },
    database: successDatabase
  });
  assert.equal(success.status, 201);
  assertCorsAllowed(success, LOCAL_DEVELOPMENT_ORIGIN);

  const badRequest = await callFormal('/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: 1234 }
  });
  assert.equal(badRequest.status, 400);
  assertCorsAllowed(badRequest, LOCAL_DEVELOPMENT_ORIGIN);

  const unauthorizedResponse = await callFormal('/api/me');
  assert.equal(unauthorizedResponse.status, 401);
  assertCorsAllowed(unauthorizedResponse, LOCAL_DEVELOPMENT_ORIGIN);

  const forbiddenDatabase = new SqliteD1();
  seedUser(forbiddenDatabase, {
    userId: 'cors-forbidden-user',
    lineUserId: 'cors-forbidden-line',
    role: 'User'
  });
  const forbiddenResponse = await callFormal('/api/admin/balances/top-up', {
    method: 'POST',
    headers: { Authorization: 'Bearer cors-forbidden-token' },
    body: {
      targetUserId: 'cors-forbidden-user',
      amount: 1
    },
    database: forbiddenDatabase,
    fetchImpl: profileFetch({
      token: 'cors-forbidden-token',
      lineUserId: 'cors-forbidden-line'
    })
  });
  assert.equal(forbiddenResponse.status, 403);
  assertCorsAllowed(forbiddenResponse, LOCAL_DEVELOPMENT_ORIGIN);

  const notFoundDatabase = new SqliteD1();
  seedUser(notFoundDatabase, {
    userId: 'cors-not-found-user',
    lineUserId: 'cors-not-found-line'
  });
  const notFoundResponse = await callFormal('/api/not-found', {
    headers: { Authorization: 'Bearer cors-not-found-token' },
    database: notFoundDatabase,
    fetchImpl: profileFetch({
      token: 'cors-not-found-token',
      lineUserId: 'cors-not-found-line'
    })
  });
  assert.equal(notFoundResponse.status, 404);
  assertCorsAllowed(notFoundResponse, LOCAL_DEVELOPMENT_ORIGIN);

  const conflictDatabase = new SqliteD1();
  seedUser(conflictDatabase, {
    userId: 'cors-conflict-guest',
    employeeId: '001234',
    lineUserId: null,
    displayName: 'CORS Conflict Guest'
  });
  seedUser(conflictDatabase, {
    userId: 'cors-conflict-bound',
    employeeId: '009999',
    lineUserId: 'line-taken'
  });
  const guestLogin = await callFormal('/api/auth/employee-guest', {
    method: 'POST',
    body: { employeeId: '001234' },
    database: conflictDatabase
  });
  const guestLoginBody = await guestLogin.json();
  const conflictResponse = await callFormal('/api/auth/line-bind', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer cors-line-token',
      'X-Employee-Guest-Session': guestLoginBody.token
    },
    database: conflictDatabase,
    fetchImpl: profileFetch({
      token: 'cors-line-token',
      lineUserId: 'line-taken'
    })
  });
  assert.equal(conflictResponse.status, 409);
  assertCorsAllowed(conflictResponse, LOCAL_DEVELOPMENT_ORIGIN);
});
