import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORS_SMOKE_ALLOWED_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://cors-smoke-session.run.pinggy-free.link'
]);
export const CORS_SMOKE_REJECTED_ORIGIN = 'https://cors-smoke.invalid';
export const CORS_SMOKE_PINGGY_ORIGIN = CORS_SMOKE_ALLOWED_ORIGINS[2];

const responseOrigin = (response) => response.headers.get('Access-Control-Allow-Origin');

const assertAllowedResponse = (response, origin, phase) => {
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin, `${phase} ACAO`);
  assert.equal(response.headers.get('Vary'), 'Origin', `${phase} Vary`);
};

const headerTokens = (response, name) => String(response.headers.get(name) || '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const endpointFor = (baseUrl) => {
  const url = new URL(baseUrl);
  return new URL('/api/me', url).href;
};

export const runCorsSmoke = async ({
  baseUrl,
  pinggyOrigin = CORS_SMOKE_PINGGY_ORIGIN,
  fetchImpl = globalThis.fetch
} = {}) => {
  if (!String(baseUrl || '').trim()) {
    throw new Error('BENTO_WORKER_BASE_URL is required.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable.');

  const endpoint = endpointFor(baseUrl);
  const allowedOrigins = [
    CORS_SMOKE_ALLOWED_ORIGINS[0],
    CORS_SMOKE_ALLOWED_ORIGINS[1],
    pinggyOrigin
  ];
  for (const origin of allowedOrigins) {
    const preflight = await fetchImpl(endpoint, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization'
      }
    });
    assert.equal(preflight.status, 204, `OPTIONS ${origin} status`);
    assertAllowedResponse(preflight, origin, `OPTIONS ${origin}`);
    assert.ok(headerTokens(preflight, 'Access-Control-Allow-Methods').includes('get'), `OPTIONS ${origin} Allow-Methods`);
    assert.ok(headerTokens(preflight, 'Access-Control-Allow-Headers').includes('authorization'), `OPTIONS ${origin} Allow-Headers`);

    const actual = await fetchImpl(endpoint, {
      headers: { Origin: origin }
    });
    assert.equal(actual.status, 401, `GET ${origin} status`);
    assertAllowedResponse(actual, origin, `GET ${origin}`);
    assert.deepEqual(await actual.json(), { error: 'AUTH_REQUIRED' });
  }

  const rejected = await fetchImpl(endpoint, {
    headers: { Origin: CORS_SMOKE_REJECTED_ORIGIN }
  });
  assert.equal(rejected.status, 401, 'rejected origin status');
  assert.equal(responseOrigin(rejected), null, 'rejected origin ACAO');
  assert.equal(rejected.headers.get('Vary'), 'Origin', 'rejected origin Vary');
  assert.deepEqual(await rejected.json(), { error: 'AUTH_REQUIRED' });

  return {
    endpoint,
    allowedOrigins,
    pinggyOrigin,
    rejectedOrigin: CORS_SMOKE_REJECTED_ORIGIN,
    preflight: 'PASS',
    actualUnauthenticated: 'PASS'
  };
};

const main = async () => {
  const result = await runCorsSmoke({
    baseUrl: process.env.BENTO_WORKER_BASE_URL || process.argv[2],
    pinggyOrigin: process.env.BENTO_PINGGY_ORIGIN || process.argv[3] || CORS_SMOKE_PINGGY_ORIGIN
  });
  console.log(JSON.stringify({ CORS_SMOKE: 'PASS', ...result }));
};

const scriptPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = resolve(fileURLToPath(import.meta.url));
if (scriptPath === modulePath) {
  main().catch((error) => {
    console.error(`CORS_SMOKE=FAIL ${error.message}`);
    process.exitCode = 1;
  });
}
