import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SqliteD1 } from './helpers/formal-db.js';
import {
  getCaiTeacherDailyFlavor,
  getDailyFlavorSyncStatus,
  runCaiTeacherDailyFlavorSync
} from '../src/domain/dailyFlavors.js';
import { getCalendarEvents } from '../src/domain/calendar.js';

const html = (rows) => `<script>const menuData = [${rows}];</script>`;
const sourceRows = `
  { date: "2026/10/02", title: "已過去餐點", img: "E47.jpg" },
  { date: "2026/10/03", title: "今日餐點", img: "E05.jpg", note: "今日說明" },
  { date: "2026/10/04", title: "明日餐點", img: "E06.jpg" }
`;
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test('sync imports only current and future rows and records a successful diagnostic', async () => {
  const database = new SqliteD1();
  const calls = [];
  const result = await runCaiTeacherDailyFlavorSync(database, {
    now: new Date('2026-10-02T18:00:00.000Z'),
    fetchImpl: async (...args) => {
      calls.push(args);
      return response(html(sourceRows));
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://www.vegetsai.com.tw/products.html');
  assert.deepEqual(result, {
    status: 'SUCCESS',
    parsedCount: 3,
    consideredCount: 2,
    addedCount: 2,
    updatedCount: 0,
    unchangedCount: 0,
    errorCode: null
  });
  assert.deepEqual(database.database.prepare(`
    SELECT service_date, flavor_name, description, image_url
    FROM vendor_daily_flavors ORDER BY service_date
  `).all().map((row) => ({ ...row })), [
    {
      service_date: '2026-10-03',
      flavor_name: '今日餐點',
      description: '今日說明',
      image_url: 'https://www.vegetsai.com.tw/img/sp_meals_s/E05.jpg'
    },
    {
      service_date: '2026-10-04',
      flavor_name: '明日餐點',
      description: '',
      image_url: 'https://www.vegetsai.com.tw/img/sp_meals_s/E06.jpg'
    }
  ]);
  assert.equal(database.get(`
    SELECT status FROM vendor_daily_flavor_sync_runs
  `).status, 'SUCCESS');
});

test('identical sync leaves published rows untouched and reports unchanged count', async () => {
  const database = new SqliteD1();
  const fetchImpl = async () => response(html(sourceRows));
  await runCaiTeacherDailyFlavorSync(database, {
    now: new Date('2026-10-02T18:00:00.000Z'),
    fetchImpl
  });
  const before = database.get(`
    SELECT fetched_at, updated_at FROM vendor_daily_flavors
    WHERE service_date = '2026-10-03'
  `);

  const result = await runCaiTeacherDailyFlavorSync(database, {
    now: new Date('2026-10-02T18:05:00.000Z'),
    fetchImpl
  });
  const after = database.get(`
    SELECT fetched_at, updated_at FROM vendor_daily_flavors
    WHERE service_date = '2026-10-03'
  `);

  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.addedCount, 0);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.unchangedCount, 2);
  assert.deepEqual({ ...after }, { ...before });
});

test('changed published rows update, while fetch and parse failures preserve last-known-good rows', async () => {
  const database = new SqliteD1();
  const now = new Date('2026-10-02T18:00:00.000Z');
  await runCaiTeacherDailyFlavorSync(database, {
    now,
    fetchImpl: async () => response(html(sourceRows))
  });

  const changed = await runCaiTeacherDailyFlavorSync(database, {
    now: new Date('2026-10-02T18:10:00.000Z'),
    fetchImpl: async () => response(html(sourceRows.replace('今日餐點', '更新餐點')))
  });
  assert.equal(changed.updatedCount, 1);
  assert.equal(database.get(`
    SELECT flavor_name FROM vendor_daily_flavors WHERE service_date = '2026-10-03'
  `).flavor_name, '更新餐點');
  const beforeFailure = database.get(`
    SELECT flavor_name, source_hash, fetched_at, updated_at
    FROM vendor_daily_flavors WHERE service_date = '2026-10-03'
  `);

  for (const [fetchImpl, expectedCode] of [
    [async () => { throw new Error('network'); }, 'DAILY_FLAVOR_FETCH_FAILED'],
    [async () => response('<html>source changed</html>'), 'DAILY_FLAVOR_MENU_DATA_NOT_FOUND'],
    [async () => response(html(sourceRows.replace('明日餐點', ''))), 'DAILY_FLAVOR_NAME_MISSING']
  ]) {
    const failed = await runCaiTeacherDailyFlavorSync(database, { now, fetchImpl });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.errorCode, expectedCode);
    assert.deepEqual({ ...database.get(`
      SELECT flavor_name, source_hash, fetched_at, updated_at
      FROM vendor_daily_flavors WHERE service_date = '2026-10-03'
    `) }, { ...beforeFailure });
  }

  assert.equal(database.get(`
    SELECT COUNT(*) AS count FROM vendor_daily_flavor_sync_runs WHERE status = 'FAILED'
  `).count, 3);
});

test('daily projection is exact-date, canonical-vendor, and flavor-identity gated', async () => {
  const database = new SqliteD1();
  await runCaiTeacherDailyFlavorSync(database, {
    now: new Date('2026-10-02T18:00:00.000Z'),
    fetchImpl: async () => response(html(sourceRows))
  });
  const menu = [{ legacy_item_id: 'E' }, { legacy_item_id: 'E_PLUS' }];

  assert.deepEqual(await getCaiTeacherDailyFlavor(database, {
    vendor: '蔡老師', targetDate: '2026-10-04', menu
  }), {
    service_date: '2026-10-04',
    name: '明日餐點',
    description: '',
    image_url: 'https://www.vegetsai.com.tw/img/sp_meals_s/E06.jpg'
  });
  assert.equal(await getCaiTeacherDailyFlavor(database, {
    vendor: '其他店家', targetDate: '2026-10-04', menu
  }), null);
  assert.equal(await getCaiTeacherDailyFlavor(database, {
    vendor: '蔡老師', targetDate: '2026-10-05', menu
  }), null);
  assert.equal(await getCaiTeacherDailyFlavor(database, {
    vendor: '蔡老師', targetDate: '2026-10-04', menu: [{ legacy_item_id: 'AP' }]
  }), null);
  assert.equal(await getCaiTeacherDailyFlavor(database, {
    vendor: '蔡老師', targetDate: '2026-10-04', menu: []
  }), null);
});

test('admin sync status omits the source URL and exposes the latest summary only', async () => {
  const database = new SqliteD1();
  await runCaiTeacherDailyFlavorSync(database, {
    now: new Date('2026-10-02T18:00:00.000Z'),
    fetchImpl: async () => response(html(sourceRows))
  });

  const status = await getDailyFlavorSyncStatus(database);
  assert.equal(status.success, true);
  assert.equal(status.availableDateCount, 2);
  assert.equal(status.lastRun.status, 'SUCCESS');
  assert.equal(status.lastRun.addedCount, 2);
  assert.equal(JSON.stringify(status).includes('vegetsai.com.tw'), false);
});


test('calendar projection exposes daily flavor names for opened and unopened dates', async () => {
  const database = new SqliteD1();
  await runCaiTeacherDailyFlavorSync(database, {
    now: new Date('2026-10-02T18:00:00.000Z'),
    fetchImpl: async () => response(html(sourceRows))
  });
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES
      ('2026-10-03', '蔡老師', 'A'),
      ('2026-10-05', '禾拾', 'A')
  `);

  const events = await getCalendarEvents(database, {
    now: new Date('2026-10-02T18:00:00.000Z'),
    includeLikes: true,
    userId: 'user-1'
  });

  assert.equal(events['2026-10-03'].vendor, '蔡老師');
  assert.equal(events['2026-10-03'].dailyFlavorName, '今日餐點');
  assert.equal(events['2026-10-04'].vendor, '');
  assert.equal(events['2026-10-04'].dailyFlavorName, '明日餐點');
  assert.equal(events['2026-10-05'].vendor, '禾拾');
  assert.equal(events['2026-10-05'].dailyFlavorName, undefined);
});
