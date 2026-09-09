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

test('production CORS allows the Netlify origin and Authorization header', async () => {
  const database = new SqliteD1();
  const response = await handleFormalRequest(request('/api/me', {
    headers: {
      Origin: PRODUCTION_FRONTEND_ORIGIN,
      Authorization: 'Bearer test-token'
    }
  }), { DB: database }, {
    fetchImpl: profileFetch({ token: 'test-token', lineUserId: 'test-user' })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_FRONTEND_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), CORS_HEADERS['Access-Control-Allow-Headers']);
  assert.equal(response.headers.get('Vary'), 'Origin');
});

test('production CORS removes access for arbitrary origins', async () => {
  const database = new SqliteD1();
  const response = await handleFormalRequest(request('/api/me', {
    headers: {
      Origin: 'https://arbitrary.example',
      Authorization: 'Bearer test-token'
    }
  }), { DB: database }, {
    fetchImpl: profileFetch({ token: 'test-token', lineUserId: 'test-user' })
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), null);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), null);
  assert.equal(response.headers.get('Vary'), 'Origin');
});

test('OPTIONS preserves the production CORS preflight contract', async () => {
  const response = await handleFormalRequest(request('/api/me', {
    method: 'OPTIONS',
    headers: {
      Origin: PRODUCTION_FRONTEND_ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization, Content-Type'
    }
  }), {});

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), PRODUCTION_FRONTEND_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), CORS_HEADERS['Access-Control-Allow-Methods']);
  assert.equal(response.headers.get('Access-Control-Allow-Headers'), CORS_HEADERS['Access-Control-Allow-Headers']);
});