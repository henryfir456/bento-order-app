import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, test } from 'node:test';

const migrationUrl = new URL('../migrations/0000_initial_schema.sql', import.meta.url);
const configUrl = new URL('../wrangler.jsonc', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);
const deployGuardUrl = new URL('../scripts/require-database-id.mjs', import.meta.url);
const migrationSql = fs.readFileSync(migrationUrl, 'utf8');
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
    ];
    this.settings = [
      { setting_key: 'mode', setting_value: 'A' },
      { setting_key: 'order_date', setting_value: '2026-09-10' }
    ];
    this.announcements = [
      {
        id: 'announcement-active',
        title: 'Open',
        content: 'Ordering is open.',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
        enabled: 1
      },
      {
        id: 'announcement-disabled',
        title: 'Disabled',
        content: 'Do not show.',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
        enabled: 0
      },
      {
        id: 'announcement-future',
        title: 'Future',
        content: 'Not yet.',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
        enabled: 1
      }
    ];
    this.menu = [{
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
    throw new Error(`Unexpected first query: ${normalized}`);
  }

  all(sql, parameters) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from orders')) {
      return {
        results: this.orders.filter((order) => order.line_user_id === parameters[0])
      };
    }
    if (normalized.includes('from settings')) return { results: this.settings };
    if (normalized.includes('from announcements')) return { results: this.announcements };
    if (normalized.includes('from menu')) return { results: this.menu };
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

test('bootstrap returns user orders settings announcements and menu', async () => {
  const response = await invoke('/api/bootstrap?userId=U-example');

  assert.equal(response.status, 200);
  const body = await json(response);
  assert.deepEqual(Object.keys(body).sort(), [
    'announcements',
    'menu',
    'orders',
    'settings',
    'user'
  ]);
  assert.equal(body.user.line_user_id, 'U-example');
  assert.equal(body.orders.length, 2);
  assert.deepEqual(body.settings, {
    mode: 'A',
    order_date: '2026-09-10'
  });
  assert.deepEqual(body.announcements, [{
    id: 'announcement-active',
    title: 'Open',
    content: 'Ordering is open.',
    start_date: '2026-09-01',
    end_date: '2026-09-30'
  }]);
  assert.deepEqual(body.menu, [{
    menu_date: '2026-09-08',
    vendor: 'Example Bento',
    item_id: 'A01',
    item_name: 'Chicken Bento',
    price: 80,
    note: 'Popular',
    image_url: ''
  }]);
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

test('Wrangler binds DB to bento-poc and remote writes require an explicit database ID', () => {
  assert.equal(wranglerConfig.name, 'bento-api-poc');
  assert.equal(wranglerConfig.d1_databases.length, 1);
  assert.deepEqual(wranglerConfig.d1_databases[0].binding, 'DB');
  assert.deepEqual(wranglerConfig.d1_databases[0].database_name, 'bento-poc');
  assert.match(
    wranglerConfig.d1_databases[0].database_id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
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
