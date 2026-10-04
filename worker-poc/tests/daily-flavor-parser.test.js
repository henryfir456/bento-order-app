import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCaiTeacherDailyFlavorHtml } from '../src/domain/caiTeacherDailyFlavorParser.js';

const source = (menuData) => `<!doctype html><html><body><script>
const menuData = [
${menuData}
];
</script></body></html>`;

test('parses official full dates, meal names, image URLs, and optional descriptions', () => {
  const rows = parseCaiTeacherDailyFlavorHtml(source(`
    { date: "2026/10/01", title: "招牌油飯+關東煮", img: "E47.jpg", note: "溫暖燉煮，糯香黏口" },
    { date: "2026/10/02", title: "泰式打拋豆腐拌飯", img: "E05.jpg" },
    { date: "2026/10/05", title: "芋香菇菇竹筍炊飯", img: "NoPic.jpg", tag: "new" }
  `));

  assert.deepEqual(rows, [
    {
      service_date: '2026-10-01',
      flavor_name: '招牌油飯+關東煮',
      description: '溫暖燉煮，糯香黏口',
      image_url: 'https://www.vegetsai.com.tw/img/sp_meals_s/E47.jpg'
    },
    {
      service_date: '2026-10-02',
      flavor_name: '泰式打拋豆腐拌飯',
      description: '',
      image_url: 'https://www.vegetsai.com.tw/img/sp_meals_s/E05.jpg'
    },
    {
      service_date: '2026-10-05',
      flavor_name: '芋香菇菇竹筍炊飯',
      description: '',
      image_url: 'https://www.vegetsai.com.tw/img/sp_meals_s/NoPic.jpg'
    }
  ]);
});

test('fails closed when menuData is missing or malformed', () => {
  assert.throws(
    () => parseCaiTeacherDailyFlavorHtml('<html><body><main></main></body></html>'),
    (error) => error.code === 'DAILY_FLAVOR_MENU_DATA_NOT_FOUND'
  );
  assert.throws(
    () => parseCaiTeacherDailyFlavorHtml('<script>const menuData = [{ date: "2026/10/01"; </script>'),
    (error) => error.code === 'DAILY_FLAVOR_MENU_DATA_INVALID'
  );
  assert.throws(
    () => parseCaiTeacherDailyFlavorHtml(source(', { date: "2026/10/01", title: "餐點", img: "E47.jpg" }')),
    (error) => error.code === 'DAILY_FLAVOR_MENU_DATA_INVALID'
  );
  assert.throws(
    () => parseCaiTeacherDailyFlavorHtml(source('{ date: "2026/10/01", title: "餐點", img: "E47.jpg" },,')),
    (error) => error.code === 'DAILY_FLAVOR_MENU_DATA_INVALID'
  );
});

test('rejects rows without a reliable date, name, or official image filename', () => {
  const invalidRows = [
    ['{ date: "2026/10/01", title: "", img: "E47.jpg" }', 'DAILY_FLAVOR_NAME_MISSING'],
    ['{ date: "", title: "餐點", img: "E47.jpg" }', 'DAILY_FLAVOR_DATE_INVALID'],
    ['{ date: "2026/02/30", title: "餐點", img: "E47.jpg" }', 'DAILY_FLAVOR_DATE_INVALID'],
    ['{ date: "2026/10/01", title: "餐點", img: "../E47.jpg" }', 'DAILY_FLAVOR_IMAGE_INVALID']
  ];

  for (const [row, code] of invalidRows) {
    assert.throws(() => parseCaiTeacherDailyFlavorHtml(source(row)), (error) => error.code === code);
  }
});

test('rejects conflicting duplicate service dates instead of guessing which row is current', () => {
  assert.throws(
    () => parseCaiTeacherDailyFlavorHtml(source(`
      { date: "2026/10/01", title: "餐點 A", img: "E47.jpg" },
      { date: "2026/10/01", title: "餐點 B", img: "E05.jpg" }
    `)),
    (error) => error.code === 'DAILY_FLAVOR_DATE_DUPLICATE'
  );
});
