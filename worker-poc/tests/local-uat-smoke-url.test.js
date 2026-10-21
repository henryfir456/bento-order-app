import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeLocalUatApiBase } from '../src/localUatSmokeUrl.js';

test('local UAT smoke URL accepts only HTTP loopback hosts', () => {
  assert.equal(normalizeLocalUatApiBase('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(normalizeLocalUatApiBase('http://localhost:9000/'), 'http://localhost:9000');
  assert.equal(normalizeLocalUatApiBase('http://[::1]:8787'), 'http://[::1]:8787');
});

test('local UAT smoke URL rejects remote hosts and URL credential or routing overrides', () => {
  for (const value of [
    'https://attacker.example',
    'http://attacker.example:8787',
    'http://localhost.attacker.example:8787',
    'http://user:password@localhost:8787',
    'http://localhost:8787/api',
    'http://localhost:8787/?target=elsewhere',
    'not a URL'
  ]) {
    assert.throws(() => normalizeLocalUatApiBase(value), {
      message: 'LOCAL_UAT_API_URL_MUST_BE_LOOPBACK_HTTP'
    });
  }
});
