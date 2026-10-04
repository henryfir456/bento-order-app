import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import formalWorker, { handleScheduled } from '../src/formalWorker.js';
import { getCustomerMenu } from '../src/domain/menu.js';
import {
  scheduledBusinessDates,
  secondFollowingBusinessDay
} from '../src/domain/businessDays.js';
import { runAutomaticDailyOpening } from '../src/domain/automaticOpening.js';
import { syncTaiwanGovernmentHolidays } from '../src/domain/taiwanHolidays.js';
import { SqliteD1 } from './helpers/formal-db.js';

const taipeiMidnight = (dateOnly) => {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return Date.UTC(year, month - 1, day) - (8 * 60 * 60 * 1000);
};

test('second following business day mappings', () => {
  assert.equal(secondFollowingBusinessDay('2026-09-14'), '2026-09-16');
  assert.equal(secondFollowingBusinessDay('2026-09-15'), '2026-09-17');
  assert.equal(secondFollowingBusinessDay('2026-09-16'), '2026-09-18');
  assert.equal(secondFollowingBusinessDay('2026-09-17'), '2026-09-21');
  assert.equal(secondFollowingBusinessDay('2026-09-18'), '2026-09-22');
  assert.equal(secondFollowingBusinessDay('2026-09-19'), null);
  assert.equal(secondFollowingBusinessDay('2026-09-20'), null);
});

test('holiday-aware business-day calculation skips observed holidays', () => {
  const holidays = new Set(['2026-10-09']);
  assert.equal(secondFollowingBusinessDay('2026-10-07', holidays), '2026-10-12');
  assert.equal(secondFollowingBusinessDay('2026-10-09', holidays), null);
});

test('scheduled time is converted to the explicit Taipei calendar date', () => {
  assert.deepEqual(
    scheduledBusinessDates(new Date('2026-09-07T15:59:59.999Z')),
    { businessDate: '2026-09-07', targetDate: '2026-09-09' }
  );
  assert.deepEqual(
    scheduledBusinessDates(new Date('2026-09-07T16:00:00.000Z')),
    { businessDate: '2026-09-08', targetDate: '2026-09-10' }
  );
});

test('business-day calculation crosses month and year boundaries', () => {
  assert.equal(secondFollowingBusinessDay('2026-12-31'), '2027-01-04');
  assert.equal(secondFollowingBusinessDay('2027-01-29'), '2027-02-02');
});

test('Saturday and Sunday scheduled runs are no-ops', async () => {
  for (const dateOnly of ['2026-09-19', '2026-09-20']) {
    const database = new SqliteD1();
    const result = await runAutomaticDailyOpening(database, taipeiMidnight(dateOnly));
    assert.deepEqual(result, {
      status: 'SKIP_NON_BUSINESS_DAY',
      businessDate: dateOnly,
      targetDate: null
    });
    assert.equal(database.get('SELECT COUNT(*) AS count FROM calendar_settings').count, 0);
  }
});

test('missing target group creates canonical 禾拾 exactly once with mode B', async () => {
  const database = new SqliteD1();
  const scheduledTime = taipeiMidnight('2026-09-14');

  const first = await runAutomaticDailyOpening(database, scheduledTime);
  const second = await runAutomaticDailyOpening(database, scheduledTime);

  assert.deepEqual(first, {
    status: 'OPENED',
    businessDate: '2026-09-14',
    targetDate: '2026-09-16',
    vendor: '禾拾'
  });
  assert.deepEqual(second, {
    status: 'SKIP_ALREADY_OPEN',
    businessDate: '2026-09-14',
    targetDate: '2026-09-16',
    vendor: '禾拾'
  });
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM calendar_settings WHERE order_date = '2026-09-16'"
  ).count, 1);
  assert.deepEqual({ ...database.get(
    "SELECT vendor, mode, vendor_source, updated_by_user_id, updated_by_auth_mode FROM calendar_settings WHERE order_date = '2026-09-16'"
  ) }, {
    vendor: '禾拾',
    mode: 'B',
    vendor_source: 'CONFIGURED',
    updated_by_user_id: null,
    updated_by_auth_mode: null
  });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM admin_audit_log').count, 0);
});

test('automatic opening skips an official Taiwan observed holiday', async () => {
  const database = new SqliteD1();
  const result = await runAutomaticDailyOpening(database, taipeiMidnight('2026-10-09'));

  assert.deepEqual(result, {
    status: 'SKIP_NON_BUSINESS_DAY',
    businessDate: '2026-10-09',
    targetDate: null
  });
  assert.equal(database.get('SELECT COUNT(*) AS count FROM calendar_settings').count, 0);
});

test('automatic opening skips official holidays while calculating the second following business day', async () => {
  const database = new SqliteD1();
  const result = await runAutomaticDailyOpening(database, taipeiMidnight('2026-10-07'));

  assert.deepEqual(result, {
    status: 'OPENED',
    businessDate: '2026-10-07',
    targetDate: '2026-10-12',
    vendor: '禾拾'
  });
  assert.equal(database.get(
    "SELECT vendor FROM calendar_settings WHERE order_date = '2026-10-12'"
  ).vendor, '禾拾');
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM calendar_settings WHERE order_date = '2026-10-09'"
  ).count, 0);
});

test('Cai Teacher holiday wording is a fail-closed fallback for auto opening', async () => {
  const database = new SqliteD1();
  const timestamp = '2026-10-29T00:00:00.000Z';
  database.run(`
    INSERT INTO vendor_daily_flavors (
      vendor, service_date, flavor_name, description, image_url,
      source_url, source_hash, fetched_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    '蔡老師', '2026-11-02', '臨時補假', '',
    'https://www.vegetsai.com.tw/img/sp_meals_s/holiday.jpg',
    'https://www.vegetsai.com.tw/products.html#specials',
    'b'.repeat(64), timestamp, timestamp, timestamp
  );

  const result = await runAutomaticDailyOpening(database, taipeiMidnight('2026-10-29'));

  assert.equal(result.status, 'OPENED');
  assert.equal(result.targetDate, '2026-11-03');
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM calendar_settings WHERE order_date = '2026-11-02'"
  ).count, 0);
});

test('existing manual assignment is never overwritten', async () => {
  const database = new SqliteD1();
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-09-16', 'Manual Vendor', 'A')
  `);

  const result = await runAutomaticDailyOpening(database, taipeiMidnight('2026-09-14'));

  assert.deepEqual(result, {
    status: 'SKIP_ALREADY_OPEN',
    businessDate: '2026-09-14',
    targetDate: '2026-09-16',
    vendor: 'Manual Vendor'
  });
  assert.deepEqual({ ...database.get(
    "SELECT vendor, mode, vendor_source FROM calendar_settings WHERE order_date = '2026-09-16'"
  ) }, { vendor: 'Manual Vendor', mode: 'A', vendor_source: 'CONFIGURED' });
});

test('a blank setting is filled atomically without creating a second row', async () => {
  const database = new SqliteD1();
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode, vendor_source)
    VALUES ('2026-09-16', '', 'A', 'LIKE_DEFAULT')
  `);

  const result = await runAutomaticDailyOpening(database, taipeiMidnight('2026-09-14'));

  assert.equal(result.status, 'OPENED');
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM calendar_settings WHERE order_date = '2026-09-16'"
  ).count, 1);
  assert.deepEqual({ ...database.get(
    "SELECT vendor, mode, vendor_source FROM calendar_settings WHERE order_date = '2026-09-16'"
  ) }, { vendor: '禾拾', mode: 'B', vendor_source: 'CONFIGURED' });
});

test('concurrent scheduled invocations create only one group', async () => {
  const database = new SqliteD1();
  const results = await Promise.all([
    runAutomaticDailyOpening(database, taipeiMidnight('2026-09-14')),
    runAutomaticDailyOpening(database, taipeiMidnight('2026-09-14'))
  ]);

  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ['OPENED', 'SKIP_ALREADY_OPEN']
  );
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM calendar_settings WHERE order_date = '2026-09-16'"
  ).count, 1);
  assert.equal(database.get(
    "SELECT vendor FROM calendar_settings WHERE order_date = '2026-09-16'"
  ).vendor, '禾拾');
});

test('automatic opening does not write or replace menu/version/image data', async () => {
  const database = new SqliteD1();
  database.run(`
    INSERT INTO menu_versions (menu_version_id, vendor, effective_date)
    VALUES ('he-shi-version', '禾拾', '2026-09-01')
  `);
  database.run(`
    INSERT INTO menu_items (
      menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, note, image_url, source_order
    ) VALUES ('he-shi-item', 'he-shi-version', 'H1', '便當', 100, 1, 'note', 'image', 1)
  `);
  const before = { ...database.get(`
    SELECT menu_version_id, vendor, effective_date
    FROM menu_versions
    WHERE menu_version_id = 'he-shi-version'
  `) };

  await runAutomaticDailyOpening(database, taipeiMidnight('2026-09-14'));

  assert.deepEqual({ ...database.get(`
    SELECT menu_version_id, vendor, effective_date
    FROM menu_versions
    WHERE menu_version_id = 'he-shi-version'
  `) }, before);
  assert.deepEqual(await getCustomerMenu(database, {
    vendor: '禾拾',
    targetDate: '2026-09-16'
  }), [{
    menu_item_id: 'he-shi-item',
    item_id: 'H1',
    legacy_item_id: 'H1',
    variant_key: '',
    selection_key: 'he-shi-item',
    item_name: '便當',
    price: 100,
    enabled: true,
    note: 'note',
    image_url: 'image'
  }]);
});

test('scheduled handler logs structured automatic-opening outcomes', async () => {
  const database = new SqliteD1();
  const lines = [];
  const result = await handleScheduled(
    { scheduledTime: taipeiMidnight('2026-09-14') },
    { DB: database },
    { logger: { log: (line) => lines.push(line) } }
  );

  assert.equal(result.status, 'OPENED');
  assert.deepEqual(JSON.parse(lines[0]), {
    event: 'automatic_daily_group_opening',
    source: 'automatic_daily_cron',
    status: 'OPENED',
    businessDate: '2026-09-14',
    targetDate: '2026-09-16',
    vendor: '禾拾'
  });
});

test('daily flavor cron runs at Taipei 16:00 without replacing the midnight group opener', async () => {
  const database = new SqliteD1();
  const lines = [];
  const result = await handleScheduled(
    { cron: '0 8 * * *', scheduledTime: new Date('2026-10-02T08:00:00.000Z') },
    { DB: database },
    {
      logger: { log: (line) => lines.push(line) },
      fetchImpl: async (url) => {
        assert.equal(url, 'https://www.vegetsai.com.tw/products.html');
        return new Response(`<script>const menuData = [
          { date: "2026/10/03", title: "明日風味餐", img: "E05.jpg" }
        ];</script>`, { status: 200 });
      }
    }
  );

  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.addedCount, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM calendar_settings').count, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_daily_flavors').count, 1);
  assert.equal(JSON.parse(lines[0]).event, 'cai_teacher_daily_flavor_sync');
  assert.equal(JSON.stringify(JSON.parse(lines[0])).includes('vegetsai.com.tw'), false);
});

test('government holiday preload imports official CSV data', async () => {
  const database = new SqliteD1();
  const datasetHtml = `
    <a href="https://www.dgpa.gov.tw/files/115-calendar.csv">CSV</a>
    檢視資料115年中華民國政府行政機關辦公日曆表
  `;
  const csv = [
    '西元日期,星期,是否放假,備註',
    '20261008,四,0,上班日',
    '20261009,五,2,國慶日補假'
  ].join('\n');

  const result = await syncTaiwanGovernmentHolidays(database, {
    now: new Date('2026-07-15T00:30:00.000Z'),
    fetchImpl: async (url) => {
      if (url === 'https://data.gov.tw/dataset/14718') return new Response(datasetHtml, { status: 200 });
      if (url === 'https://www.dgpa.gov.tw/files/115-calendar.csv') return new Response(csv, { status: 200 });
      throw new Error(`Unexpected holiday URL: ${url}`);
    }
  });

  assert.equal(result.status, 'SUCCESS');
  assert.deepEqual(result.importedYears, [2026]);
  assert.equal(database.get(
    "SELECT holiday_name FROM taiwan_government_holidays WHERE holiday_date = '2026-10-09'"
  ).holiday_name, '國慶日補假');
  assert.equal(database.get(
    "SELECT COUNT(*) AS count FROM taiwan_government_holidays WHERE holiday_date = '2026-10-08'"
  ).count, 0);
});

test('holiday preload cron runs in the annual publication window', async () => {
  const database = new SqliteD1();
  const lines = [];
  const datasetHtml = `
    <a href="https://www.dgpa.gov.tw/files/115-calendar.csv">CSV</a>
    檢視資料115年中華民國政府行政機關辦公日曆表
  `;
  const csv = '西元日期,星期,是否放假,備註\n20261009,五,2,國慶日補假';

  const result = await handleScheduled(
    { cron: '30 0 15 6-12 *', scheduledTime: new Date('2026-07-15T00:30:00.000Z') },
    { DB: database },
    {
      logger: { log: (line) => lines.push(line) },
      fetchImpl: async (url) => {
        if (url === 'https://data.gov.tw/dataset/14718') return new Response(datasetHtml, { status: 200 });
        if (url === 'https://www.dgpa.gov.tw/files/115-calendar.csv') return new Response(csv, { status: 200 });
        throw new Error(`Unexpected holiday URL: ${url}`);
      }
    }
  );

  assert.equal(result.status, 'SUCCESS');
  assert.equal(JSON.parse(lines[0]).event, 'taiwan_government_holiday_sync');
});

test('formal Worker exposes the scheduled entry point', () => {
  assert.equal(typeof formalWorker.fetch, 'function');
  assert.equal(typeof formalWorker.scheduled, 'function');
});

test('formal Wrangler config schedules the Worker at Taipei midnight', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.triggers?.crons, [
    '0 16 * * *',
    '0 8 * * *',
    '30 0 15 6-12 *'
  ]);
});
