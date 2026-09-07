import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, test } from 'node:test';

const fixture = JSON.parse(fs.readFileSync(
  new URL('../contracts/bootstrap-contract.json', import.meta.url),
  'utf8'
));

let handleRequest;
let importError;

before(async () => {
  try {
    ({ handleRequest } = await import('../src/index.js'));
  } catch (error) {
    importError = error;
  }
});

class Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.parameters = [];
  }

  bind(...parameters) {
    this.parameters = parameters;
    return this;
  }

  first() {
    return this.database.first(this.sql, this.parameters);
  }

  all() {
    return this.database.all(this.sql, this.parameters);
  }
}

class ParityDb {
  constructor() {
    this.users = [{
      line_user_id: 'U-example',
      display_name: 'Example User',
      pickup_floor: '1F',
      balance: 120,
      role: 'User'
    }];
    this.orders = [{
      id: 1,
      order_id: 'order-001',
      order_date: '2026-09-10',
      vendor: 'Example Bento',
      line_user_id: 'U-example',
      item_id: 'A01',
      item_name: 'Chicken Bento',
      quantity: 1,
      unit_price: 80,
      subtotal: 80,
      pickup_floor: '1F',
      note: 'No onions',
      created_at: '2026-09-07 02:00:00',
      status: 'ACTIVE'
    }];
    this.calendarSettings = [{
      id: 1,
      order_date: '2026-09-10',
      vendor: 'Example Bento',
      mode: 'A'
    }];
    this.likes = [{
      id: 1,
      order_date: '2026-09-10',
      line_user_id: 'U-example',
      created_at: '2026-09-07 01:00:00'
    }];
    this.announcements = [
      {
        id: 'older',
        title: 'Older',
        content: 'Older content',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
        enabled: 1,
        source_order: 1
      },
      {
        id: 'latest',
        title: 'Latest',
        content: 'Latest content',
        start_date: '2026-09-03',
        end_date: '2026-09-30',
        enabled: 1,
        source_order: 2
      }
    ];
    this.menu = [
      {
        id: 1,
        menu_date: '2026-09-01',
        vendor: 'Example Bento',
        item_id: 'OLD',
        item_name: 'Old Bento',
        price: 70,
        note: '',
        image_url: ''
      },
      {
        id: 2,
        menu_date: '2026-09-08',
        vendor: 'Example Bento',
        item_id: 'A01',
        item_name: 'Chicken Bento',
        price: 80,
        note: 'Popular',
        image_url: ''
      }
    ];
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  first(sql, parameters) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from users')) {
      return this.users.find((user) => user.line_user_id === parameters[0]) || null;
    }
    if (normalized.includes('from calendar_settings')) {
      return this.calendarSettings.find((setting) => setting.order_date === parameters[0]) || null;
    }
    throw new Error(`Unexpected first query: ${normalized}`);
  }

  all(sql, parameters) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from calendar_settings')) return { results: this.calendarSettings };
    if (normalized.includes('from orders')) {
      return {
        results: this.orders.filter((order) => (
          order.line_user_id === parameters[0]
          && (!normalized.includes('and orders.order_date') || order.order_date === parameters[1])
        ))
      };
    }
    if (normalized.includes('from likes')) return { results: this.likes };
    if (normalized.includes('from announcements')) return { results: this.announcements };
    if (normalized.includes('from menu')) {
      const vendor = parameters[0];
      const targetDate = parameters[1];
      return {
        results: this.menu.filter((item) => (
          item.vendor === vendor && item.menu_date <= targetDate
        ))
      };
    }
    throw new Error(`Unexpected all query: ${normalized}`);
  }
}

const invoke = async (path, database = new ParityDb()) => {
  if (importError) throw importError;
  return handleRequest(
    new Request(`https://worker.test${path}`),
    { DB: database },
    { now: new Date('2026-09-07T04:00:00.000Z') }
  );
};

const json = (response) => response.json();

const frontendPrimaryProjection = (body) => ({
  success: body.success,
  registered: body.registered,
  user: body.user,
  calendar: body.calendar,
  ordersMap: body.ordersMap,
  targetDate: body.targetDate
});

test('primary bootstrap matches the canonical GAS frontend-observable semantics', async () => {
  const response = await invoke(
    '/api/bootstrap?userId=U-example&targetDate=2026-09-10&bootId=BOOT-20260907-parity1'
  );
  const body = await json(response);
  const primary = fixture.surfaces.primaryBootstrap;

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), [
    ...primary.requiredTopLevelKeys,
    ...primary.optionalTopLevelKeys
  ].sort());
  assert.deepEqual(frontendPrimaryProjection(body), {
    success: true,
    registered: true,
    user: {
      userId: 'U-example',
      name: 'Example User',
      floor: '1F',
      defaultFloor: '1F',
      balance: 120,
      role: 'User',
      lineUserId: 'U-example',
      displayName: 'Example User'
    },
    calendar: {
      events: {
        '2026-09-10': {
          order_date: '2026-09-10',
          vendor: 'Example Bento',
          mode: 'A',
          deadline: '2026-09-10T02:00:00.000Z',
          isExpired: false,
          lunarLabel: null
        }
      },
      announcements: [],
      announcement: null
    },
    ordersMap: { '2026-09-10': true },
    targetDate: '2026-09-10'
  });
  assert.equal(body.user.userId, body.user.lineUserId);
  assert.equal(typeof body.user.balance, 'number');
  assert.equal(typeof body.calendar.events['2026-09-10'].isExpired, 'boolean');
  assert.equal(body.calendar.events['2026-09-10'].lunarLabel, null);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'likes'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'menu'), false);
});

test('deferred bootstrap matches likes and active-announcement semantics', async () => {
  const response = await invoke(
    '/api/bootstrap/deferred?userId=U-example&bootId=BOOT-20260907-parity2'
  );
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.registered, true);
  assert.deepEqual(Object.keys(body.likes['2026-09-10']), fixture.surfaces.deferredBootstrap.likeRequiredKeys);
  assert.equal(body.likes['2026-09-10'].likeCount, 1);
  assert.equal(body.likes['2026-09-10'].isUserLiked, true);
  assert.deepEqual(body.announcements.map((announcement) => announcement.id), ['latest', 'older']);
  assert.deepEqual(body.announcement, body.announcements[0]);
});

test('order-page side contract selects the latest menu version and active order', async () => {
  const response = await invoke('/api/order-page?userId=U-example&targetDate=2026-09-10');
  const body = await json(response);

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), fixture.surfaces.orderPage.requiredTopLevelKeys.sort());
  assert.deepEqual(body.setting, {
    order_date: '2026-09-10',
    vendor: 'Example Bento',
    mode: 'A'
  });
  assert.equal(body.menu.length, 1);
  assert.equal(body.menu[0].item_id, 'A01');
  assert.equal(body.myOrder.orderId, 'order-001');
  assert.equal(body.myOrder.items[0].quantity, 1);
});

test('empty primary and deferred collections keep their canonical null/empty behavior', async () => {
  const database = new ParityDb();
  database.orders = [];
  database.calendarSettings = [];
  database.likes = [];
  database.announcements = [];

  const primary = await json(await invoke('/api/bootstrap?userId=U-example', database));
  const deferred = await json(await invoke('/api/bootstrap/deferred?userId=U-example', database));

  assert.deepEqual(primary.calendar.events, {});
  assert.deepEqual(primary.calendar.announcements, []);
  assert.equal(primary.calendar.announcement, null);
  assert.deepEqual(primary.ordersMap, {});
  assert.deepEqual(deferred.likes, {});
  assert.deepEqual(deferred.announcements, []);
  assert.equal(deferred.announcement, null);
});

test('representative error responses expose stable codes without database details', async () => {
  const missingUserId = await invoke('/api/bootstrap');
  assert.equal(missingUserId.status, 400);
  assert.deepEqual(await json(missingUserId), { error: 'USER_ID_REQUIRED' });

  const unknownUser = await invoke('/api/bootstrap?userId=U-missing');
  assert.equal(unknownUser.status, 404);
  assert.deepEqual(await json(unknownUser), { error: 'USER_NOT_FOUND' });

  const invalidOrderPageDate = await invoke('/api/order-page?userId=U-example&targetDate=2026-02-30');
  assert.equal(invalidOrderPageDate.status, 400);
  assert.deepEqual(await json(invalidOrderPageDate), { error: 'INVALID_DATE' });
});
