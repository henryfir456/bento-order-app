import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, test } from 'node:test';

const migrationUrl = new URL('../migrations/0000_initial_schema.sql', import.meta.url);
const parityMigrationUrl = new URL('../migrations/0001_bootstrap_parity.sql', import.meta.url);
const configUrl = new URL('../wrangler-poc.jsonc', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const deployGuardUrl = new URL('../scripts/require-database-id.mjs', import.meta.url);
const migrationSql = fs.readFileSync(migrationUrl, 'utf8');
const parityMigrationSql = fs.readFileSync(parityMigrationUrl, 'utf8');
const wranglerConfig = JSON.parse(fs.readFileSync(configUrl, 'utf8'));
const packageConfig = JSON.parse(fs.readFileSync(packageUrl, 'utf8'));
const deployGuard = fs.readFileSync(deployGuardUrl, 'utf8');

let handleRequest;
let importError;

before(async () => {
  try {
    ({ handleRequest } = await import('../src/index.js'));
  } catch (error) {
    importError = error;
  }
});

class FakeStatement {
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

class FakeDb {
  constructor() {
    this.queries = [];
    this.users = [{
      line_user_id: 'U-example',
      display_name: 'Example User',
      pickup_floor: '1F',
      balance: '120',
      role: 'User'
    }];
    this.orders = [
      {
        id: 1,
        order_id: 'order-new',
        order_date: '2026-09-10',
        vendor: 'Example Bento',
        line_user_id: 'U-example',
        item_id: 'A01',
        item_name: 'Chicken Bento',
        quantity: '2',
        unit_price: '80',
        subtotal: '160',
        pickup_floor: '1F',
        note: 'No onions',
        created_at: '2026-09-07 02:00:00',
        status: 'ACTIVE'
      },
      {
        id: 2,
        order_id: 'order-old',
        order_date: '2026-09-09',
        vendor: 'Example Bento',
        line_user_id: 'U-example',
        item_id: 'B01',
        item_name: 'Tofu Bento',
        quantity: 1,
        unit_price: 70,
        subtotal: 70,
        pickup_floor: '9F',
        note: '',
        created_at: '2026-09-06 02:00:00',
        status: 'ACTIVE'
      }
    ];
    this.calendarSettings = [
      { id: 1, order_date: '2026-09-10', vendor: 'Example Bento', mode: 'A' },
      { id: 2, order_date: '2026-09-11', vendor: '', mode: 'A' }
    ];
    this.likes = [
      { id: 1, order_date: '2026-09-10', line_user_id: 'U-example', created_at: '2026-09-07 01:00:00' },
      { id: 2, order_date: '2026-09-10', line_user_id: 'U-other', created_at: '2026-09-07 01:01:00' }
    ];
    this.announcements = [
      {
        id: 'announcement-active',
        title: 'Open',
        content: 'Ordering is open.',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
        enabled: 1,
        source_order: 1
      },
      {
        id: 'announcement-disabled',
        title: 'Disabled',
        content: 'Do not show.',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
        enabled: 0,
        source_order: 2
      },
      {
        id: 'announcement-future',
        title: 'Future',
        content: 'Not yet.',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        enabled: 1,
        source_order: 3
      }
    ];
    this.menu = [{
      id: 1,
      menu_date: '2026-09-08',
      vendor: 'Example Bento',
      item_id: 'A01',
      item_name: 'Chicken Bento',
      price: '80',
      note: 'Popular',
      image_url: ''
    }];
  }

  prepare(sql) {
    this.queries.push(sql);
    return new FakeStatement(this, sql);
  }

  first(sql, parameters) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('count(*)') && normalized.includes('from users')) {
      return { users: this.users.length };
    }
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
    if (normalized.includes('from orders')) {
      return {
        results: this.orders.filter((order) => (
          order.line_user_id === parameters[0]
          && (!normalized.includes('and orders.order_date') || order.order_date === parameters[1])
        ))
      };
    }
    if (normalized.includes('from calendar_settings')) return { results: this.calendarSettings };
    if (normalized.includes('from likes')) return { results: this.likes };
    if (normalized.includes('from announcements')) return { results: this.announcements };
    if (normalized.includes('from menu')) {
      const vendor = parameters[0];
      const targetDate = parameters[1];
      return {
        results: this.menu.filter((item) => (
          (!vendor || item.vendor === vendor) && (!targetDate || item.menu_date <= targetDate)
        ))
      };
    }
    throw new Error(`Unexpected all query: ${normalized}`);
  }
}

const request = (path, options = {}) => new Request(`https://worker.test${path}`, options);

const json = async (response) => response.json();

const invoke = async (path, database = new FakeDb(), options = {}) => {
  if (importError) throw importError;
  return handleRequest(request(path), { DB: database }, {
    now: new Date('2026-09-07T04:00:00.000Z'),
    ...options
  });
};

test('health returns database status and user count', async () => {
  const database = new FakeDb();
  const response = await invoke('/api/health', database);

  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    ok: true,
    database: true,
    users: 1
  });
  assert.match(database.queries[0], /COUNT\(\*\)/i);
});

test('user lookup returns the verified public fields', async () => {
  const response = await invoke('/api/users/U-example');

  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    line_user_id: 'U-example',
    display_name: 'Example User',
    pickup_floor: '1F',
    balance: 120,
    role: 'User'
  });
});

test('missing user returns USER_NOT_FOUND', async () => {
  const response = await invoke('/api/users/U-missing');

  assert.equal(response.status, 404);
  assert.deepEqual(await json(response), { error: 'USER_NOT_FOUND' });
});

test('orders requires userId', async () => {
  const response = await invoke('/api/orders');

  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { error: 'USER_ID_REQUIRED' });
});

test('orders returns numeric order fields', async () => {
  const response = await invoke('/api/orders?userId=U-example');

  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    orders: [
      {
        order_id: 'order-new',
        order_date: '2026-09-10',
        vendor: 'Example Bento',
        line_user_id: 'U-example',
        item_id: 'A01',
        item_name: 'Chicken Bento',
        quantity: 2,
        unit_price: 80,
        subtotal: 160,
        pickup_floor: '1F',
        note: 'No onions',
        created_at: '2026-09-07 02:00:00'
      },
      {
        order_id: 'order-old',
        order_date: '2026-09-09',
        vendor: 'Example Bento',
        line_user_id: 'U-example',
        item_id: 'B01',
        item_name: 'Tofu Bento',
        quantity: 1,
        unit_price: 70,
        subtotal: 70,
        pickup_floor: '9F',
        note: '',
        created_at: '2026-09-06 02:00:00'
      }
    ]
  });
});

test('primary bootstrap returns the GAS frontend-observable shape', async () => {
  const response = await invoke('/api/bootstrap?userId=U-example&targetDate=2026-09-10&bootId=BOOT-20260907-primary1');

  assert.equal(response.status, 200);
  const body = await json(response);
  assert.deepEqual(Object.keys(body), [
    'success',
    'registered',
    'user',
    'calendar',
    'ordersMap',
    'targetDate',
    'bootId',
    'observability'
  ]);
  assert.equal(body.success, true);
  assert.equal(body.registered, true);
  assert.deepEqual(body.user, {
    userId: 'U-example',
    name: 'Example User',
    floor: '1F',
    defaultFloor: '1F',
    balance: 120,
    role: 'User',
    lineUserId: 'U-example',
    displayName: 'Example User'
  });
  assert.deepEqual(body.calendar.events['2026-09-10'], {
    order_date: '2026-09-10',
    vendor: 'Example Bento',
    mode: 'A',
    deadline: '2026-09-10T02:00:00.000Z',
    isExpired: false,
    lunarLabel: body.calendar.events['2026-09-10'].lunarLabel
  });
  assert.deepEqual(body.calendar.announcements, []);
  assert.equal(body.calendar.announcement, null);
  assert.deepEqual(body.ordersMap, {
    '2026-09-10': true,
    '2026-09-09': true
  });
  assert.equal(body.targetDate, '2026-09-10');
  assert.equal(body.bootId, 'BOOT-20260907-primary1');
  assert.equal(body.observability.timing.status, 'success');
  assert.ok(response.headers.get('Server-Timing').includes('d1-queries'));
});

test('deferred bootstrap keeps likes and announcements outside primary', async () => {
  const response = await invoke('/api/bootstrap/deferred?userId=U-example&bootId=BOOT-20260907-defer1');

  assert.equal(response.status, 200);
  const body = await json(response);
  assert.deepEqual(body.likes['2026-09-10'], {
    likeCount: 2,
    isUserLiked: true,
    calendarEvent: {
      order_date: '2026-09-10',
      vendor: '',
      mode: 'A',
      deadline: '2026-09-10T02:00:00.000Z',
      isExpired: false,
      lunarLabel: body.likes['2026-09-10'].calendarEvent.lunarLabel
    }
  });
  assert.deepEqual(body.announcements, [{
    id: 'announcement-active',
    title: 'Open',
    content: 'Ordering is open.',
    start_date: '2026-09-01',
    end_date: '2026-09-30'
  }]);
  assert.equal(body.announcement.id, 'announcement-active');
  assert.equal(body.bootId, 'BOOT-20260907-defer1');
});

test('order page keeps menu and deadline outside primary', async () => {
  const response = await invoke('/api/order-page?userId=U-example&targetDate=2026-09-10');

  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    success: true,
    setting: {
      order_date: '2026-09-10',
      vendor: 'Example Bento',
      mode: 'A'
    },
    deadline: {
      now: '2026-09-07T04:00:00.000Z',
      deadline: '2026-09-10T02:00:00.000Z',
      isExpired: false
    },
    menu: [{
      item_id: 'A01',
      item_name: 'Chicken Bento',
      price: 80,
      note: 'Popular',
      image_url: ''
    }],
    myOrder: {
      orderId: 'order-new',
      items: [{
        order_id: 'order-new',
        item_id: 'A01',
        item_name: 'Chicken Bento',
        quantity: 2,
        unit_price: 80,
        subtotal: 160
      }],
      note: 'No onions'
    }
  });
});

test('bootstrap and order-page representative errors are stable', async () => {
  const missingId = await invoke('/api/bootstrap');
  assert.equal(missingId.status, 400);
  assert.deepEqual(await json(missingId), { error: 'USER_ID_REQUIRED' });

  const unknownUser = await invoke('/api/bootstrap?userId=U-missing');
  assert.equal(unknownUser.status, 404);
  assert.deepEqual(await json(unknownUser), { error: 'USER_NOT_FOUND' });

  const invalidDate = await invoke('/api/order-page?userId=U-example&targetDate=bad-date');
  assert.equal(invalidDate.status, 400);
  assert.deepEqual(await json(invalidDate), { error: 'INVALID_DATE' });
});

test('unknown routes return a stable not-found error', async () => {
  const response = await invoke('/api/unknown');

  assert.equal(response.status, 404);
  assert.deepEqual(await json(response), { error: 'NOT_FOUND' });
});

test('migration creates every table and index idempotently', () => {
  for (const table of ['users', 'orders', 'settings', 'announcements', 'menu']) {
    assert.match(migrationSql, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}`, 'i'));
  }
  for (const index of [
    'idx_orders_line_user_id',
    'idx_orders_user_order_date',
    'idx_announcements_active_window',
    'idx_menu_vendor_date'
  ]) {
    assert.match(migrationSql, new RegExp(`CREATE INDEX IF NOT EXISTS\\s+${index}`, 'i'));
  }
});

test('bootstrap parity migration is append-only and guarded', () => {
  for (const table of ['calendar_settings', 'likes', 'order_status']) {
    assert.match(parityMigrationSql, new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${table}`, 'i'));
  }
  for (const index of [
    'idx_calendar_settings_order_date',
    'idx_likes_order_date',
    'idx_likes_user_order_date',
    'idx_order_status_status'
  ]) {
    assert.match(parityMigrationSql, new RegExp(`CREATE INDEX IF NOT EXISTS\\s+${index}`, 'i'));
  }
  assert.doesNotMatch(parityMigrationSql, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.match(parityMigrationSql, /UNIQUE\s*\(order_date,\s*line_user_id\)/i);
  assert.match(parityMigrationSql, /REFERENCES\s+orders\(id\)/i);
});

test('POC inspection Wrangler config is local-only and formal remote writes remain guarded', () => {
  assert.equal(wranglerConfig.name, 'bento-api-poc-legacy');
  assert.equal(wranglerConfig.d1_databases.length, 1);
  assert.deepEqual(wranglerConfig.d1_databases[0].binding, 'DB');
  assert.deepEqual(wranglerConfig.d1_databases[0].database_name, 'bento-poc-legacy-local');
  assert.equal(wranglerConfig.d1_databases[0].database_id, undefined);
  assert.equal(wranglerConfig.d1_databases[0].migrations_dir, 'migrations');
  assert.match(packageConfig.scripts['db:migrations:remote'], /require-database-id\.mjs/);
  assert.match(packageConfig.scripts.deploy, /require-database-id\.mjs/);
  assert.match(deployGuard, /database_id/);
  assert.match(deployGuard, /databaseIdPattern/);

  const trackedWorkerFiles = [
    new URL('../.gitignore', import.meta.url),
    configUrl,
    packageUrl,
    new URL('../README.md', import.meta.url),
    migrationUrl,
    new URL('./index.test.js', import.meta.url),
    deployGuardUrl
  ];
  const credentialValuePattern = /Bearer\s+[A-Za-z0-9._-]{12,}|(?:sk|ghp|glpat)-[A-Za-z0-9_-]{12,}/i;
  for (const fileUrl of trackedWorkerFiles) {
    assert.doesNotMatch(fs.readFileSync(fileUrl, 'utf8'), credentialValuePattern, fileUrl.pathname);
  }
});
