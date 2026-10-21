import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLocalUatApiBase } from '../src/localUatSmokeUrl.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDirectory = resolve(here, '..', '.local-uat');
const apiBase = normalizeLocalUatApiBase(process.argv[2] || 'http://127.0.0.1:8787');
const reportFile = resolve(dataDirectory, 'acceptance-report.json');
const FORMAL_FRONTEND_ORIGIN = 'https://stirring-pony-3571ac.netlify.app';
const VENDOR_ONE = `V${String(1).padStart(5, '0')}`;
const VENDOR_TWO = `V${String(2).padStart(5, '0')}`;
const readEnv = (source) => Object.fromEntries(source.split(/\r?\n/u)
  .filter((line) => line.trim() && !line.trim().startsWith('#'))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
const secrets = readEnv(readFileSync(resolve(dataDirectory, 'secrets.env'), 'utf8'));
const results = [];

const request = async (path, { method = 'GET', token = '', body, origin = 'http://localhost:5173' } = {}) => {
  const headers = { Accept: 'application/json', Origin: origin };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* Contract check reports non-JSON. */ }
  return {
    response,
    payload,
    requestId: response.headers.get('X-Request-Id') || null
  };
};

const record = (name, status, contract, requestId) => {
  const entry = { name, httpStatus: status, responseContract: contract, result: 'PASS', requestId };
  results.push(entry);
  process.stdout.write(`PASS [${status}] ${name} — ${contract}${requestId ? ` · request ${requestId}` : ''}\n`);
};

const check = (name, result, status, contract, predicate) => {
  assert.equal(result.response.status, status, `${name}: HTTP status`);
  assert.ok(predicate(result.payload), `${name}: response contract`);
  record(name, result.response.status, contract, result.requestId);
  return result.payload;
};

const fail = (name, result, expectedStatus, predicate, contract) => {
  assert.equal(result.response.status, expectedStatus, `${name}: expected HTTP ${expectedStatus}`);
  assert.ok(predicate(result.payload), `${name}: expected denial contract`);
  record(name, result.response.status, contract, result.requestId);
};

const login = async (role, passwordEnv) => {
  const result = await request('/__local-uat/session', {
    method: 'POST', body: { role, password: secrets[passwordEnv] }
  });
  const payload = check(`local synthetic login: ${role}`, result, 200,
    'success=true, short-lived accessToken', (value) => (
      value?.success === true && typeof value.accessToken === 'string' && value.accessToken.length > 20
    ));
  return payload.accessToken;
};

try {
  const health = await request('/api/health');
  check('isolated Worker and D1 health', health, 200, 'database=true', (body) => body?.ok === true && body.database === true);
  const productionCorsProbe = await request('/api/health', { origin: FORMAL_FRONTEND_ORIGIN });
  assert.equal(productionCorsProbe.response.status, 200);
  assert.equal(productionCorsProbe.response.headers.get('Access-Control-Allow-Origin'), null);
  record('local UAT does not grant the formal frontend CORS access', 200,
    'health response has no Access-Control-Allow-Origin for the formal origin', productionCorsProbe.requestId);

  const tokens = {
    admin: await login('admin', 'LOCAL_UAT_PASSWORD_ADMIN'),
    user: await login('user', 'LOCAL_UAT_PASSWORD_USER'),
    vendorOne: await login('vendor-one', 'LOCAL_UAT_PASSWORD_VENDOR_ONE'),
    vendorTwo: await login('vendor-two', 'LOCAL_UAT_PASSWORD_VENDOR_TWO')
  };

  const inbox = check('announcement inbox and unread count', await request('/api/me/announcements', { token: tokens.user }),
    200, 'unreadCount=1 and eligible synthetic announcement', (body) => (
      body?.unreadCount === 1 && body.announcements?.length === 1
        && body.announcements[0].id === 'local-uat-announcement-001'
        && body.announcements[0].readAt === null
        && body.announcements[0].shouldAutoPopup === true
    ));
  const read = check('announcement mark read', await request(
    `/api/me/announcements/${encodeURIComponent(inbox.announcements[0].id)}/read`,
    { method: 'POST', token: tokens.user }
  ), 200, 'success=true and readAt timestamp', (body) => body?.success === true && typeof body.readAt === 'string');
  const afterRead = check('announcement unread count after read', await request('/api/me/announcements', { token: tokens.user }),
    200, 'unreadCount=0; read state persists', (body) => body?.unreadCount === 0 && body.announcements?.[0]?.readAt === read.readAt);
  check('announcement auto-popup preference', await request(
    `/api/me/announcements/${encodeURIComponent(afterRead.announcements[0].id)}/dismiss`,
    { method: 'POST', token: tokens.user }
  ), 200, 'success=true and dismiss timestamp', (body) => body?.success === true && typeof body.dismissAutoPopupAt === 'string');
  check('announcement popup preference readback', await request('/api/me/announcements', { token: tokens.user }),
    200, 'shouldAutoPopup=false after dismissal', (body) => body?.unreadCount === 0 && body.announcements?.[0]?.shouldAutoPopup === false);

  const adminVendors = check('Admin vendor list', await request('/api/vendors', { token: tokens.admin }),
    200, 'synthetic ' + VENDOR_ONE + ' and isolation canary ' + VENDOR_TWO + ' are listed', (body) => (
      Array.isArray(body?.vendors)
        && body.vendors.some((vendor) => vendor.id === VENDOR_ONE)
        && body.vendors.some((vendor) => vendor.id === VENDOR_TWO)
    ));
  assert.equal(adminVendors.vendors.filter((vendor) => [VENDOR_ONE, VENDOR_TWO].includes(vendor.id)).length, 2);
  check('Admin menu vendor catalog', await request('/api/admin/menu/vendors', { token: tokens.admin }),
    200, 'success=true and vendors array', (body) => body?.success === true && Array.isArray(body.vendors));

  const vendorOne = check('Vendor ' + VENDOR_ONE + ' daily orders are scoped to its membership', await request(
    '/api/vendor/orders?month=2026-10', { token: tokens.vendorOne }
  ), 200, 'only ' + VENDOR_ONE + ' is returned with its synthetic orders', (body) => (
    body?.success === true && body.vendors?.length === 1
      && body.vendors[0].id === VENDOR_ONE
      && body.days?.some((day) => day.vendorId === VENDOR_ONE && day.orderCount > 0)
  ));
  assert.equal(vendorOne.vendors.some((vendor) => vendor.id === VENDOR_TWO), false);
  fail('Vendor ' + VENDOR_ONE + ' cannot request another vendor scope', await request(
    `/api/vendor/orders?month=2026-10&vendorId=${encodeURIComponent(VENDOR_TWO)}`,
    { token: tokens.vendorOne }
  ), 403, (body) => body?.error === 'VENDOR_SCOPE_FORBIDDEN', '403 VENDOR_SCOPE_FORBIDDEN');
  const vendorTwo = check('Vendor ' + VENDOR_TWO + ' isolation canary sees only its own data', await request(
    '/api/vendor/orders?month=2026-10', { token: tokens.vendorTwo }
  ), 200, 'only ' + VENDOR_TWO + ' is returned with its synthetic orders', (body) => (
    body?.success === true && body.vendors?.length === 1
      && body.vendors[0].id === VENDOR_TWO
      && body.days?.some((day) => day.vendorId === VENDOR_TWO && day.orderCount > 0)
  ));
  assert.equal(vendorTwo.vendors.some((vendor) => vendor.id === VENDOR_ONE), false);

  const adminSettlement = check('Admin settlement query for ' + VENDOR_ONE, await request(
    `/api/admin/vendor-operations?month=2026-10&vendorId=${encodeURIComponent(VENDOR_ONE)}`,
    { token: tokens.admin }
  ), 200, 'synthetic receivable and seeded transfer are returned', (body) => (
    body?.success === true && body.vendor?.id === VENDOR_ONE
      && body.days?.some((day) => day.serviceDate === '2026-10-20'
        && day.settlement?.transfers?.some((transfer) => transfer.paymentId === 'SYNTHETIC-UAT-PAYMENT-ONE'))
  ));
  const vendorDay = adminSettlement.days.find((day) => day.serviceDate === '2026-10-20');
  assert.equal(vendorDay.settlement.transfers[0].allocatedAmountTwd, 100);
  check('Vendor cannot access Admin settlement query', await request(
    `/api/admin/vendor-operations?month=2026-10&vendorId=${encodeURIComponent(VENDOR_TWO)}`,
    { token: tokens.vendorOne }
  ), 403, 'Admin-only settlement route is denied', (body) => typeof body?.error === 'string');

  const statisticResults = [];
  for (const period of ['all', 'year', 'month']) {
    const body = check(`meal statistics (${period})`, await request(
      `/api/orders/statistics?period=${period}`, { token: tokens.user }
    ), 200, 'canonical portions, meal identities and labels', (value) => (
      value?.success === true && value.totalPortions === 21 && value.totalMealTypes === 4
        && value.items?.length === 4
    ));
    const codeFor = (item) => {
      try { return JSON.parse(item.identityKey)?.[2]; } catch { return null; }
    };
    const flavor = body.items.find((item) => codeFor(item) === 'FR');
    const waterCooked = body.items.find((item) => codeFor(item) === 'B');
    const dailySpecial = body.items.find((item) => codeFor(item) === 'C');
    const sameNameDifferentIdentity = body.items.find((item) => codeFor(item) === 'ALT');
    assert.equal(flavor?.name, 'A.風味便當');
    assert.equal(flavor?.portions, 6);
    assert.equal(waterCooked?.name, '水煮低醣健康餐');
    assert.equal(waterCooked?.portions, 3);
    assert.equal(dailySpecial?.name, 'C.特餐');
    assert.equal(dailySpecial?.portions, 4);
    assert.equal(sameNameDifferentIdentity?.name, flavor?.name);
    assert.notEqual(sameNameDifferentIdentity?.identityKey, flavor?.identityKey);
    assert.equal(sameNameDifferentIdentity?.portions, 8);
    statisticResults.push(body);
  }
  assert.deepEqual(statisticResults.map(({ totalPortions, totalMealTypes }) => [totalPortions, totalMealTypes]), [
    [21, 4], [21, 4], [21, 4]
  ]);

  const report = {
    environment: 'local Wrangler Worker + local D1; all records synthetic',
    apiBase,
    sourceSha: process.env.LOCAL_UAT_SOURCE_SHA || null,
    testedAt: new Date().toISOString(),
    checks: results,
    paymentWriteCalls: 0,
    formalEnvironmentTouched: false
  };
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`PASS ${results.length} real HTTP/API acceptance checks\nReport: ${reportFile}\n`);
} catch (error) {
  process.stderr.write(`FAIL local UAT HTTP acceptance: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
}
