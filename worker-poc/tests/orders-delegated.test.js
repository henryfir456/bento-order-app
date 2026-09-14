import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import {
  callOrderRoute,
  ORDER_DATE,
  ORDER_NOW,
  seedOrderDatabase,
  userProfile
} from './helpers/order-fixtures.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

const TODAY = '2026-09-07';
const YESTERDAY = '2026-09-06';
const FUTURE = '2026-09-10';
const AFTER_TODAY_CUTOFF = new Date('2026-09-07T02:00:00.001Z');
const AFTER_ORDER_CUTOFF = new Date('2026-09-08T02:00:00.001Z');

const orderBody = (targetDate, overrides = {}) => ({
  targetDate,
  pickupFloor: '1樓',
  items: [{ menu_item_id: 'menu-a', quantity: 1 }],
  ...overrides
});

const addOrderDates = (database) => {
  for (const date of [TODAY, YESTERDAY, FUTURE]) {
    database.run(`
      INSERT INTO calendar_settings (order_date, vendor, mode)
      VALUES (?, 'Vendor A', 'A')
    `, date);
  }
};

const delegatedDatabase = ({ targetBalance = 100, actorBalance = 500 } = {}) => {
  const database = seedOrderDatabase({ balance: 100 });
  database.run('UPDATE users SET balance = ? WHERE user_id = ?', actorBalance, 'admin-1');
  seedUser(database, {
    lineUserId: 'proxy-1',
    displayName: 'Proxy Admin',
    role: 'ProxyAdmin',
    balance: actorBalance
  });
  database.run('UPDATE users SET balance = ? WHERE user_id = ?', targetBalance, 'user-2');
  addOrderDates(database);
  return database;
};

const create = (database, body, key, profile = userProfile(), now = ORDER_NOW) => callOrderRoute(
  database,
  '/api/orders',
  {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': key },
    now
  },
  profile
);

const cancel = (
  database,
  orderId,
  key,
  profile,
  body = {},
  now = ORDER_NOW
) => callOrderRoute(
  database,
  `/api/orders/${encodeURIComponent(orderId)}/cancel`,
  {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': key },
    now
  },
  profile
);

const profileFor = (lineUserId, token = `${lineUserId}-token`) => userProfile(lineUserId, token);

test('User cannot delegate by forging targetUserId', async () => {
  const database = delegatedDatabase();
  const result = await create(
    database,
    orderBody(TODAY, { targetUserId: 'user-2' }),
    'user-forged-target'
  );

  assert.equal(result.response.status, 403);
  assert.equal(result.body.error, 'DELEGATED_ORDER_FORBIDDEN');
  assert.equal(database.get("SELECT COUNT(*) AS count FROM orders WHERE user_id = 'user-2'").count, 0);
});

test('delegated ordering rejects inactive and historical provisional targets', async () => {
  const database = delegatedDatabase();
  seedUser(database, {
    userId: 'inactive-target',
    displayName: 'Inactive Target',
    active: 0,
    lineUserId: null,
    employeeId: 'retired-001'
  });
  seedUser(database, {
    userId: 'historical-provisional',
    displayName: 'Historical Provisional',
    active: 0,
    lineUserId: null,
    employeeId: null,
    verificationStatus: 'UNVERIFIED'
  });

  for (const [targetUserId, key] of [
    ['inactive-target', 'inactive-target'],
    ['historical-provisional', 'historical-provisional']
  ]) {
    const result = await create(
      database,
      orderBody(TODAY, { targetUserId }),
      key,
      profileFor('admin-1', 'admin-token')
    );
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error, 'ORDER_TARGET_INELIGIBLE');
  }
});

test('delegated target discovery is role-gated and returns only eligible targets', async () => {
  const database = delegatedDatabase();
  seedUser(database, {
    userId: 'incomplete-target',
    displayName: 'Incomplete Target',
    pickupFloor: null,
    lineUserId: null,
    employeeId: 'incomplete-001'
  });

  const adminResponse = await handleFormalRequest(
    request('/api/orders/targets', { token: 'admin-token' }),
    { DB: database },
    { fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-1' }), now: ORDER_NOW }
  );
  const adminBody = await adminResponse.json();
  assert.equal(adminResponse.status, 200);
  assert.deepEqual(adminBody.targets.map((target) => target.userId), ['proxy-1', 'user-1', 'user-2']);

  const userResponse = await handleFormalRequest(
    request('/api/orders/targets', { token: 'user-token' }),
    { DB: database },
    { fetchImpl: profileFetch({ token: 'user-token', lineUserId: 'user-1' }), now: ORDER_NOW }
  );
  const userBody = await userResponse.json();
  assert.equal(userResponse.status, 403);
  assert.equal(userBody.error, 'FORBIDDEN');
});

test('User self-order remains subject to the ordinary cutoff', async () => {
  const result = await create(
    delegatedDatabase(),
    orderBody(ORDER_DATE),
    'user-self-after-cutoff',
    profileFor('user-1'),
    AFTER_ORDER_CUTOFF
  );

  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, 'DEADLINE_CLOSED');
});

test('ProxyAdmin self-order remains subject to the ordinary cutoff', async () => {
  const result = await create(
    delegatedDatabase(),
    orderBody(ORDER_DATE),
    'proxy-self-after-cutoff',
    profileFor('proxy-1'),
    AFTER_ORDER_CUTOFF
  );

  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, 'DEADLINE_CLOSED');
});

test('ProxyAdmin delegated ordering is allowed today before and after cutoff', async () => {
  const before = await create(
    delegatedDatabase(),
    orderBody(TODAY, { targetUserId: 'user-2' }),
    'proxy-delegated-before',
    profileFor('proxy-1'),
    ORDER_NOW
  );
  const after = await create(
    delegatedDatabase(),
    orderBody(TODAY, { targetUserId: 'user-2' }),
    'proxy-delegated-after',
    profileFor('proxy-1'),
    AFTER_TODAY_CUTOFF
  );

  assert.equal(before.response.status, 200);
  assert.equal(after.response.status, 200);
});

test('ProxyAdmin delegated ordering rejects yesterday and tomorrow', async () => {
  for (const [targetDate, key] of [[YESTERDAY, 'proxy-yesterday'], [ORDER_DATE, 'proxy-tomorrow']]) {
    const result = await create(
      delegatedDatabase(),
      orderBody(targetDate, { targetUserId: 'user-2' }),
      key,
      profileFor('proxy-1'),
      AFTER_TODAY_CUTOFF
    );
    assert.equal(result.response.status, 403);
    assert.equal(result.body.error, 'DELEGATED_ORDER_TODAY_ONLY');
  }
});

test('Admin self-order bypasses cutoff and supports another valid order date', async () => {
  const database = delegatedDatabase({ actorBalance: 0 });
  const afterCutoff = await create(
    database,
    orderBody(ORDER_DATE),
    'admin-self-after-cutoff',
    profileFor('admin-1', 'admin-token'),
    AFTER_ORDER_CUTOFF
  );
  const otherDate = await create(
    database,
    orderBody(FUTURE),
    'admin-self-future',
    profileFor('admin-1', 'admin-token'),
    AFTER_ORDER_CUTOFF
  );

  assert.equal(afterCutoff.response.status, 200);
  assert.equal(otherDate.response.status, 200);
});

test('Admin delegated ordering bypasses cutoff for today and future dates', async () => {
  const today = await create(
    delegatedDatabase(),
    orderBody(TODAY, { targetUserId: 'user-2' }),
    'admin-delegated-today',
    profileFor('admin-1', 'admin-token'),
    AFTER_TODAY_CUTOFF
  );
  const future = await create(
    delegatedDatabase(),
    orderBody(FUTURE, { targetUserId: 'user-2' }),
    'admin-delegated-future',
    profileFor('admin-1', 'admin-token'),
    AFTER_ORDER_CUTOFF
  );

  assert.equal(today.response.status, 200);
  assert.equal(future.response.status, 200);
});

test('delegated create and replacement preserve target ownership and target-only balance changes', async () => {
  const database = delegatedDatabase({ targetBalance: 100, actorBalance: 500 });
  const first = await create(
    database,
    orderBody(TODAY, { targetUserId: 'user-2' }),
    'delegated-create',
    profileFor('admin-1', 'admin-token')
  );
  const replacement = await create(
    database,
    orderBody(TODAY, {
      targetUserId: 'user-2',
      items: [{ menu_item_id: 'menu-b', quantity: 1 }]
    }),
    'delegated-replace',
    profileFor('admin-1', 'admin-token')
  );

  assert.equal(first.response.status, 200);
  assert.equal(replacement.response.status, 200);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-2'").balance, 70);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'admin-1'").balance, 500);
  const orders = database.database.prepare(`
    SELECT user_id, status, created_by_user_id
    FROM orders
    WHERE user_id = 'user-2'
  `).all();
  assert.deepEqual(
    orders.map((order) => [order.user_id, order.status, order.created_by_user_id]).sort(),
    [
      ['user-2', 'ACTIVE', 'admin-1'],
      ['user-2', 'CANCELLED', 'admin-1']
    ].sort()
  );
  const audit = database.get(`
    SELECT actor_user_id, target_user_id, action
    FROM admin_audit_log
    WHERE action = 'ORDER_UPDATE'
    LIMIT 1
  `);
  assert.equal(audit.actor_user_id, 'admin-1');
  assert.equal(audit.target_user_id, 'user-2');
  assert.equal(audit.action, 'ORDER_UPDATE');
});

test('delegated cancellation refunds target balance and leaves actor balance unchanged', async () => {
  const database = delegatedDatabase({ targetBalance: 100, actorBalance: 500 });
  const created = await create(
    database,
    orderBody(TODAY, { targetUserId: 'user-2' }),
    'delegated-cancel-create',
    profileFor('admin-1', 'admin-token')
  );
  const cancelled = await cancel(
    database,
    created.body.orderId,
    'delegated-cancel',
    profileFor('admin-1', 'admin-token'),
    { targetUserId: 'user-2' },
    AFTER_TODAY_CUTOFF
  );

  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.newBalance, 100);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-2'").balance, 100);
  assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'admin-1'").balance, 500);
  const audit = database.get(`
    SELECT actor_user_id, target_user_id, action
    FROM admin_audit_log
    WHERE action = 'ORDER_CANCEL'
  `);
  assert.equal(audit.actor_user_id, 'admin-1');
  assert.equal(audit.target_user_id, 'user-2');
  assert.equal(audit.action, 'ORDER_CANCEL');
});

test('ProxyAdmin and Admin cannot cancel a completed delegated order', async () => {
  for (const [profile, key] of [
    [profileFor('proxy-1'), 'proxy-completed-cancel'],
    [profileFor('admin-1', 'admin-token'), 'admin-completed-cancel']
  ]) {
    const database = delegatedDatabase();
    const created = await create(
      database,
      orderBody(TODAY, { targetUserId: 'user-2' }),
      `${key}-create`,
      profile
    );
    database.run("UPDATE orders SET status = 'COMPLETED', created_auth_mode = 'legacy_import' WHERE order_id = ?", created.body.orderId);
    const result = await cancel(
      database,
      created.body.orderId,
      key,
      profile,
      { targetUserId: 'user-2' },
      AFTER_TODAY_CUTOFF
    );

    assert.equal(result.response.status, 409);
    assert.equal(result.body.error, 'ORDER_ALREADY_CANCELLED');
    assert.equal(database.get("SELECT balance FROM users WHERE user_id = 'user-2'").balance, 20);
    assert.equal(database.get("SELECT COUNT(*) AS count FROM balance_ledger WHERE type = 'REFUND'").count, 0);
  }
});

test('delegated order reads keep the authenticated actor and return target order context', async () => {
  const database = delegatedDatabase();
  const created = await create(
    database,
    orderBody(TODAY, { targetUserId: 'user-2' }),
    'delegated-read-create',
    profileFor('admin-1', 'admin-token')
  );
  const response = await handleFormalRequest(
    request(`/api/order-page?targetDate=${TODAY}&targetUserId=user-2`, {
      token: 'admin-token'
    }),
    { DB: database },
    {
      fetchImpl: profileFetch({ token: 'admin-token', lineUserId: 'admin-1' }),
      now: AFTER_TODAY_CUTOFF
    }
  );
  const body = await response.json();

  assert.equal(created.response.status, 200);
  assert.equal(response.status, 200);
  assert.equal(body.targetUser.userId, 'user-2');
  assert.equal(body.targetUser.balance, 20);
  assert.equal(body.myOrder.orderId, created.body.orderId);
  assert.equal(body.orderPolicy.actorUserId, 'admin-1');
  assert.equal(body.orderPolicy.targetUserId, 'user-2');
});

test('ProxyAdmin can read target context outside the delegated ordering date without gaining mutation access', async () => {
  const database = delegatedDatabase();
  const response = await handleFormalRequest(
    request(`/api/order-page?targetDate=${YESTERDAY}&targetUserId=user-2`, {
      token: 'proxy-token'
    }),
    { DB: database },
    {
      fetchImpl: profileFetch({ token: 'proxy-token', lineUserId: 'proxy-1' }),
      now: AFTER_TODAY_CUTOFF
    }
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.targetUser.userId, 'user-2');
  assert.equal(body.orderPolicy.actorUserId, 'proxy-1');
  assert.equal(body.orderPolicy.targetUserId, 'user-2');
  assert.equal(body.orderPolicy.delegated, true);
  assert.equal(body.orderPolicy.canMutate, false);
});
