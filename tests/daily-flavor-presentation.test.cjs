const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const presentation = import('../src/features/orders/dailyFlavorPresentation.js');

test('daily flavor card is bound to Cai Teacher, the selected date, and normalized flavor identities', async () => {
  const { buildDailyFlavorCardModel } = await presentation;
  const menu = [
    { item_id: 'e-base', menu_item_id: 'menu-e', legacy_item_id: 'E', variant_key: 'BASE', price: 105 },
    { item_id: 'e-plus', menu_item_id: 'menu-e-plus', legacy_item_id: 'E', variant_key: 'PLUS', price: 130 },
    { item_id: 'a-base', menu_item_id: 'menu-a', legacy_item_id: 'A', variant_key: 'BASE', price: 115 },
    { item_id: 'am-base', menu_item_id: 'menu-am', legacy_item_id: 'AM', variant_key: 'BASE', price: 125 },
    { item_id: 'regular', menu_item_id: 'menu-regular', legacy_item_id: 'FR', price: 90 }
  ];
  const dailyFlavor = {
    service_date: '2026-10-04',
    name: '香菇栗子油飯',
    description: '每日介紹',
    image_url: 'https://www.vegetsai.com.tw/img/sp_meals_s/E06.jpg'
  };

  const model = buildDailyFlavorCardModel({
    vendor: '蔡老師', targetDate: '2026-10-04', dailyFlavor, menu
  });
  assert.equal(model.name, '香菇栗子油飯');
  assert.equal(model.description, '每日介紹');
  assert.deepEqual(model.items.map(({ item_id, menu_item_id, dailyFlavorLabel, price }) => ({
    item_id, menu_item_id, dailyFlavorLabel, price
  })), [
    { item_id: 'e-base', menu_item_id: 'menu-e', dailyFlavorLabel: '風味餐', price: 105 },
    { item_id: 'e-plus', menu_item_id: 'menu-e-plus', dailyFlavorLabel: '風味餐（加量）', price: 130 },
    { item_id: 'a-base', menu_item_id: 'menu-a', dailyFlavorLabel: '風味便當', price: 115 },
    { item_id: 'am-base', menu_item_id: 'menu-am', dailyFlavorLabel: '風味會議便當', price: 125 }
  ]);
  assert.equal(model.items.some((item) => item.item_id === 'regular'), false);
});

test('daily flavor card stays absent for other vendors, dates, or unrelated menu identities', async () => {
  const { buildDailyFlavorCardModel } = await presentation;
  const dailyFlavor = {
    service_date: '2026-10-04', name: '香菇栗子油飯', description: '',
    image_url: 'https://www.vegetsai.com.tw/img/sp_meals_s/E06.jpg'
  };
  const menu = [{ item_id: 'regular', legacy_item_id: 'FR' }];

  assert.equal(buildDailyFlavorCardModel({
    vendor: '禾拾', targetDate: '2026-10-04', dailyFlavor, menu
  }), null);
  assert.equal(buildDailyFlavorCardModel({
    vendor: '蔡老師', targetDate: '2026-10-05', dailyFlavor, menu
  }), null);
  assert.equal(buildDailyFlavorCardModel({
    vendor: '蔡老師', targetDate: '2026-10-04', dailyFlavor, menu
  }), null);
});

test('calendar flavor image requires the exact date, Cai Teacher event, and mapped flavor data', async () => {
  const { getCalendarDailyFlavorImage } = await presentation;
  const event = {
    order_date: '2026-10-06',
    vendor: '蔡老師',
    dailyFlavorName: '泰式打拋豆腐拌飯',
    dailyFlavorImageUrl: 'https://www.vegetsai.com.tw/img/sp_meals_s/E06.jpg'
  };

  assert.equal(getCalendarDailyFlavorImage(event, '2026-10-06'), event.dailyFlavorImageUrl);
  assert.equal(getCalendarDailyFlavorImage({ ...event, vendor: '' }, '2026-10-06'), '');
  assert.equal(getCalendarDailyFlavorImage({ ...event, vendor: '禾拾' }, '2026-10-06'), '');
  assert.equal(getCalendarDailyFlavorImage(event, '2026-10-07'), '');
  assert.equal(getCalendarDailyFlavorImage({ ...event, dailyFlavorName: '' }, '2026-10-06'), '');
  assert.equal(getCalendarDailyFlavorImage({ ...event, dailyFlavorImageUrl: '' }, '2026-10-06'), '');
});

test('calendar thumbnail is absent on missing image and hides on image load error', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const calendar = app.match(/const renderCalendarDays = \(\) => \{[\s\S]*?const renderWeekendEvents = \(\) => \{/)?.[0] || '';

  assert.match(calendar, /showDailyFlavorImage &&/);
  assert.match(calendar, /&& dailyFlavorImageUrl/);
  assert.match(calendar, /onError=\{\(\) => setCalendarFlavorImageErrors/);
  assert.match(calendar, /type="button"[\s\S]*?aria-label=\{`放大檢視/);
  assert.match(calendar, /h-11 w-full rounded-md object-cover/);
  assert.match(calendar, /min-h-\[132px\] min-w-0/);
  assert.doesNotMatch(calendar, /無圖片/);
});

test('order and admin screens render the independent projection and drop the item-name suffix instructions', () => {
  const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  const orderPage = read('src/features/orders/OrderPage.jsx');
  const app = read('src/App.jsx');
  const adminMenu = read('src/features/admin/MenuItemChangesManagement.jsx');

  assert.match(orderPage, /data-testid="daily-flavor-card"/);
  assert.match(orderPage, /\{dailyFlavorCard\.name\}/);
  assert.match(orderPage, /\{dailyFlavorCard\.description &&/);
  assert.match(orderPage, /onIncreaseItem\(item\.item_id, qty\)/);
  assert.match(app, /setDailyFlavor\(workerOrderMode \? \(data\.dailyFlavor \|\| null\) : null\)/);
  assert.match(app, /!dailyFlavorItemIds\.has\(item\.item_id\)/);
  assert.doesNotMatch(adminMenu, /當日主餐名/);
  assert.match(adminMenu, /data-testid="daily-flavor-sync-panel"/);
});
