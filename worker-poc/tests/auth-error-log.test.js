import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { SqliteD1 } from './helpers/formal-db.js';
import { handleFormalRequest, request } from './helpers/formal-fixtures.js';
import {
  AUTH_ERROR_RETENTION_DAYS,
  purgeOldAuthErrors,
  resetAuthErrorThrottle,
  sanitizeClientReport,
  scrubDetail,
  summarizeUserAgent
} from '../src/auth/authErrorLog.js';
import { buildQueries, formatReport, parseArgs } from '../scripts/auth-error-report.mjs';

const NOW = new Date('2026-10-30T00:00:00.000Z');
const rows = (database) => database.database.prepare('SELECT * FROM auth_error_log ORDER BY id').all();

beforeEach(() => resetAuthErrorThrottle());

const send = (database, req, fetchImpl) => handleFormalRequest(
  req, { DB: database }, { fetchImpl, now: NOW }
);

test('frontend report is stored sanitized, without tokens or long ids', async () => {
  const database = new SqliteD1();
  const response = await send(database, request('/api/client-errors', {
    method: 'POST',
    token: '',
    headers: {
      Authorization: '',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel) Chrome/120 Safari/537.36 Line/14.2.0',
      'CF-Connecting-IP': '203.0.113.7'
    },
    body: {
      stage: 'BACKEND_IDENTITY_VERIFY_FAILED',
      errorCode: 'TOKEN_INVALID',
      httpStatus: 401,
      inLine: true,
      appVersion: '0.19.25',
      detail: 'Bearer abc123 for E1234567 U0123456789abcdef0123456789abcdef x@y.z',
      lineUserId: 'Uleak'
    }
  }));
  assert.equal(response.status, 202);
  const [row] = rows(database);
  assert.equal(row.source, 'frontend');
  assert.equal(row.http_status, 401);
  assert.equal(row.in_line, 1);
  assert.equal(row.ua_summary, 'Android 14 / LINE 14.2.0');
  assert.match(row.client_ref, /^[0-9a-f]{8}$/);
  assert.doesNotMatch(row.detail, /abc123|1234567|0123456789abcdef|x@y/);
  assert.equal(JSON.stringify(row).includes('Uleak'), false);
});

test('invalid or oversized reports are rejected without writing', async () => {
  const database = new SqliteD1();
  const post = (body) => send(database, request('/api/client-errors', {
    method: 'POST', token: '', headers: { Authorization: '' }, body
  }));
  assert.equal((await post({ stage: 'bad stage!', errorCode: 'X' })).status, 400);
  assert.equal((await post({ stage: 'S' })).status, 400);
  assert.equal((await post({ stage: 'S', errorCode: 'E', detail: 'x'.repeat(5000) })).status, 400);
  assert.equal(rows(database).length, 0);
});

test('repeated identical reports from one caller are written once per minute', async () => {
  const database = new SqliteD1();
  const post = () => send(database, request('/api/client-errors', {
    method: 'POST', token: '', headers: { Authorization: '' },
    body: { stage: 'S', errorCode: 'E' }
  }));
  for (let i = 0; i < 5; i += 1) assert.equal((await post()).status, 202);
  assert.equal(rows(database).length, 1);
});

test('a rejected LINE token is logged by the backend with LINE status and class', async () => {
  const database = new SqliteD1();
  const fetchImpl = async () => new Response('{}', { status: 401 });
  const response = await send(database, request('/api/me/bootstrap', { token: 'secret-token' }), fetchImpl);
  assert.equal(response.status, 401);
  const [row] = rows(database);
  assert.equal(row.source, 'backend');
  assert.equal(row.error_code, 'TOKEN_INVALID');
  assert.equal(row.line_profile_status, 401);
  assert.equal(row.error_class, 'LINE_PROFILE_HTTP');
  assert.ok(row.duration_ms >= 0);
  assert.equal(JSON.stringify(row).includes('secret-token'), false);
});

test('a LINE network failure is logged as LINE_NETWORK', async () => {
  const database = new SqliteD1();
  const fetchImpl = async () => { throw new Error('boom'); };
  await send(database, request('/api/me/bootstrap', { token: 't' }), fetchImpl);
  const [row] = rows(database);
  assert.equal(row.line_profile_status, 0);
  assert.equal(row.error_class, 'LINE_NETWORK');
});

test('ordinary unauthenticated or business errors are not logged', async () => {
  const database = new SqliteD1();
  await send(database, request('/api/me/bootstrap', { token: '', headers: { Authorization: '' } }));
  assert.equal(rows(database).length, 0);
});

test('purge removes only rows older than the retention period', async () => {
  const database = new SqliteD1();
  const insert = (at) => database.run(
    "INSERT INTO auth_error_log (occurred_at, source, stage, error_code) VALUES (?, 'backend', 'S', 'E')", at
  );
  insert(new Date(NOW.getTime() - (AUTH_ERROR_RETENTION_DAYS * 86400000 + 1000)).toISOString());
  insert(new Date(NOW.getTime() - 86400000).toISOString());
  assert.equal(await purgeOldAuthErrors(database, NOW), 1);
  assert.equal(rows(database).length, 1);
});

test('helpers sanitize input and the report formats bounded queries', () => {
  assert.equal(sanitizeClientReport({ stage: 'S' }), null);
  assert.equal(sanitizeClientReport({ stage: 'S', errorCode: 'E', httpStatus: 9999 }).httpStatus, null);
  assert.equal(scrubDetail('id 12345678'), 'id #');
  assert.equal(summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1'), 'iOS / Safari');
  assert.throws(() => parseArgs(['--hours', '9999']));
  const { summary, recent } = buildQueries({ hours: 24, limit: 10 }, NOW);
  assert.match(summary, /LIMIT 500/);
  assert.match(recent, /LIMIT 10$/);
  const database = new SqliteD1();
  database.run("INSERT INTO auth_error_log (occurred_at, source, stage, error_code, http_status) VALUES (?, 'frontend', 'S', 'E', 401)", NOW.toISOString());
  const text = formatReport({
    summary: database.database.prepare(summary.replace(/\s+/g, ' ').replace(/occurred_at >= '[^']+'/, "occurred_at >= '2000-01-01'")).all(),
    recent: database.database.prepare(recent.replace(/occurred_at >= '[^']+'/, "occurred_at >= '2000-01-01'")).all()
  }, { hours: 24 });
  assert.match(text, /\| 1 \| frontend \| S \| E \| 401/);
});
