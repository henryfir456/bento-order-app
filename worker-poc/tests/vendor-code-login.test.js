import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteD1 } from './helpers/formal-db.js';
import {
  handleFormalRequest,
  profileFetch,
  request,
  seedUser,
  seedVendor
} from './helpers/formal-fixtures.js';

// Synthetic vendor alias in the V + five digits shape.
const CODE = `V${String(7).padStart(5, '0')}`;
const NOW = new Date('2026-10-20T00:00:00.000Z');
const ENABLED = { VENDOR_CODE_LOGIN_ENABLED: 'true' };

const seedCodeVendor = (database, {
  userId = 'synthetic-code-vendor',
  vendorId = 'synthetic-code-vendor-shop',
  code = CODE,
  principalStatus = 'ACTIVE',
  enabled = 1
} = {}) => {
  seedVendor(database, { vendorId, name: '合成代號廠商', enabled });
  seedUser(database, {
    userId,
    lineUserId: 'synthetic-line-code-vendor',
    employeeId: null,
    role: 'User'
  });
  database.run(`
    INSERT INTO vendor_principals (user_id, principal_role, status, vendor_login_id)
    VALUES (?, 'Vendor', ?, ?)
  `, userId, principalStatus, code);
  database.run(`
    INSERT INTO vendor_memberships (user_id, vendor_id, status)
    VALUES (?, ?, 'ACTIVE')
  `, userId, vendorId);
};

const call = async (database, path, { env = ENABLED, token, method = 'GET', body } = {}) => {
  const response = await handleFormalRequest(
    request(path, { method, token, body }),
    { DB: database, ...env },
    { fetchImpl: profileFetch({ token, lineUserId: 'unused-line', displayName: 'unused' }), now: NOW }
  );
  return { response, body: await response.json() };
};

const login = (database, employeeId, env = ENABLED) => call(database, '/api/auth/employee-guest', {
  env, method: 'POST', token: 'unused', body: { employeeId }
});

test('vendor code login stays rejected while the switch is off', async () => {
  const database = new SqliteD1();
  seedCodeVendor(database);
  for (const env of [{}, { VENDOR_CODE_LOGIN_ENABLED: 'false' }, { VENDOR_CODE_LOGIN_ENABLED: '1' }]) {
    const result = await login(database, CODE, env);
    assert.equal(result.response.status, 403, JSON.stringify(env));
    assert.equal(result.body.error, 'VENDOR_EMPLOYEE_GUEST_FORBIDDEN');
  }
  assert.equal(database.get('SELECT COUNT(*) AS count FROM employee_guest_sessions').count, 0);
});

test('with the switch on, the vendor code signs in as the read-only Vendor principal', async () => {
  const database = new SqliteD1();
  seedCodeVendor(database);
  const signedIn = await login(database, CODE.toLowerCase());
  assert.equal(signedIn.response.status, 201, JSON.stringify(signedIn.body));
  assert.equal(signedIn.body.authMode, 'vendor_code');
  assert.match(signedIn.body.token, /^eg_/);
  const token = signedIn.body.token;

  const me = await call(database, '/api/me', { token });
  assert.equal(me.response.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.authMode, 'vendor_code');
  assert.equal(me.body.registered, true);
  assert.equal(me.body.user.role, 'Vendor');
  assert.equal(me.body.lineUserId, '');
  assert.deepEqual(me.body.capabilities, ['READ_VENDOR_CONTEXT', 'VENDOR_READ_OPERATIONS']);

  const orders = await call(database, '/api/vendor/orders?month=2026-10', { token });
  assert.equal(orders.response.status, 200, JSON.stringify(orders.body));
  assert.deepEqual(orders.body.vendors.map((vendor) => vendor.id), ['synthetic-code-vendor-shop']);

  for (const action of ['acknowledgement', 'disputes']) {
    const write = await call(database, `/api/vendor/payments/synthetic-payment/${action}`, {
      token, method: 'POST', body: { reason: '合成理由' }
    });
    assert.equal(write.response.status, 403, action);
    assert.equal(write.body.error, 'VENDOR_CODE_LOGIN_READ_ONLY');
  }

  const viewAs = await call(database, '/api/me?viewAs=someone', { token });
  assert.equal(viewAs.response.status, 403);
});

test('turning the switch off invalidates existing vendor code sessions', async () => {
  const database = new SqliteD1();
  seedCodeVendor(database);
  const { token } = (await login(database, CODE)).body;
  const locked = await call(database, '/api/me', { token, env: {} });
  assert.equal(locked.response.status, 401);
  assert.equal(locked.body.error, 'GUEST_SESSION_INVALID');
});

test('vendor code login refuses inactive vendors and unknown codes', async () => {
  const suspended = new SqliteD1();
  seedCodeVendor(suspended, { principalStatus: 'SUSPENDED' });
  assert.equal((await login(suspended, CODE)).response.status, 403);

  const disabled = new SqliteD1();
  seedCodeVendor(disabled, { enabled: 0 });
  assert.equal((await login(disabled, CODE)).response.status, 403);

  const unknown = new SqliteD1();
  seedCodeVendor(unknown);
  const result = await login(unknown, `V${String(8).padStart(5, '0')}`);
  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, 'VENDOR_SCOPE_FORBIDDEN');
  assert.equal(unknown.get('SELECT COUNT(*) AS count FROM employee_guest_sessions').count, 0);
});

test('a session stops working once the vendor is suspended', async () => {
  const database = new SqliteD1();
  seedCodeVendor(database);
  const { token } = (await login(database, CODE)).body;
  database.run("UPDATE vendor_principals SET status = 'SUSPENDED' WHERE vendor_login_id = ?", CODE);
  const result = await call(database, '/api/vendor/orders?month=2026-10', { token });
  assert.equal(result.response.status, 401);
});
