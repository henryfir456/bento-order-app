const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

class MockRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) => (
      Array.from({ length: this.columnCount }, (_, columnOffset) => (
        this.sheet.getCell(this.row + rowOffset, this.column + columnOffset)
      ))
    ));
  }

  getValue() {
    return this.sheet.getCell(this.row, this.column);
  }

  setValue(value) {
    this.sheet.setCell(this.row, this.column, value);
    return this;
  }

  setValues(values) {
    values.forEach((row, rowOffset) => {
      row.forEach((value, columnOffset) => {
        this.sheet.setCell(this.row + rowOffset, this.column + columnOffset, value);
      });
    });
    return this;
  }

  setNumberFormat(format) {
    this.sheet.setNumberFormat(this.row, this.column, format);
    return this;
  }

  getNumberFormat() {
    return this.sheet.getNumberFormat(this.row, this.column);
  }
}

class MockSheet {
  constructor(rows) {
    this.rows = rows.map(row => row.slice());
    this.numberFormats = new Map();
  }

  getDataRange() {
    return new MockRange(this, 1, 1, Math.max(this.rows.length, 1), Math.max(this.getLastColumn(), 1));
  }

  getRange(row, column, rowCount = 1, columnCount = 1) {
    return new MockRange(this, row, column, rowCount, columnCount);
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  appendRow(row) {
    this.rows.push(row.slice());
  }

  getCell(row, column) {
    return this.rows[row - 1]?.[column - 1] ?? '';
  }

  setCell(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
    this.rows[row - 1][column - 1] = value;
  }

  setNumberFormat(row, column, format) {
    this.numberFormats.set(`${row}:${column}`, format);
  }

  getNumberFormat(row, column) {
    return this.numberFormats.get(`${row}:${column}`) || '';
  }
}

class TrackingSheet extends MockSheet {
  constructor(rows) {
    super(rows);
    this.dataRangeReads = 0;
  }

  getDataRange() {
    this.dataRangeReads += 1;
    return super.getDataRange();
  }
}

class MockSpreadsheet {
  constructor(sheets) {
    this.sheets = sheets;
  }

  getSheetByName(name) {
    return this.sheets[name] || null;
  }

  insertSheet(name) {
    this.sheets[name] = new MockSheet([]);
    return this.sheets[name];
  }
}

function loadGas(spreadsheet, lineProfile = {}, lineProfileStatus = 200, fetchBehavior = {}) {
  let uuid = 0;
  const fetchCalls = [];
  const logs = [];
  let contentReads = 0;
  const logger = fetchBehavior.logger || {
    warn: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' '))
  };
  const responseBody = Object.prototype.hasOwnProperty.call(fetchBehavior, 'responseBody')
    ? fetchBehavior.responseBody
    : JSON.stringify(lineProfile);
  const context = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {},
        releaseLock() {}
      })
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        fetchCalls.push({ url, options });
        if (fetchBehavior.throwError) throw fetchBehavior.throwError;
        return {
          getResponseCode: () => lineProfileStatus,
          getContentText: () => {
            contentReads++;
            return responseBody;
          }
        };
      }
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        text,
        setMimeType() {
          return this;
        }
      })
    },
    Utilities: {
      formatDate: (date, _timezone, format) => {
        if (format === 'yyyy-MM-dd') return date.toISOString().slice(0, 10);
        return date.toISOString().replace('T', ' ').slice(0, 19);
      },
      getUuid: () => `uuid-${++uuid}`
    },
    console: logger,
    __fetchCalls: fetchCalls,
    __contentReads: () => contentReads,
    __logs: logs
  };
  vm.createContext(context);
  const sourceFiles = [
    'Utils.gs',
    'Permissions.gs',
    'Auth.gs',
    'Users.gs',
    'Orders.gs',
    'Balances.gs',
    'Announcements.gs',
    'Calendar.gs',
    'Admin.gs',
    'Code.gs'
  ];
  sourceFiles.forEach((fileName) => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'gas', fileName), 'utf8');
    vm.runInContext(source, context, { filename: fileName });
  });
  return context;
}

function usersSheet() {
  return new MockSheet([
    ['LINE_UserID', '姓名', '樓層', 'Balance', 'Role'],
    ['admin-id', 'Admin User', '9樓', 100, 'Admin'],
    ['user-id', 'Leo Wu Leo', '9樓', -80, 'User']
  ]);
}

function usersWithProxySheet() {
  const sheet = usersSheet();
  sheet.rows.push(['proxy-id', 'Proxy Admin', '1樓', -20, 'ProxyAdmin']);
  return sheet;
}

test('getUserInfo sends the accessToken to the LINE Profile endpoint', () => {
  const gas = loadGas(new MockSpreadsheet({ Users: usersSheet() }), {
    userId: 'unknown-id',
    displayName: 'LINE Profile Name'
  });

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({ action: 'getUserInfo', accessToken: 'access-token' })
    }
  });
  const result = JSON.parse(output.text);
  const request = gas.__fetchCalls[0];

  assert.equal(result.success, true);
  assert.equal(result.registered, false);
  assert.equal(request.url, 'https://api.line.me/v2/profile');
  assert.equal(request.options.method, 'get');
  assert.equal(request.options.headers.Authorization, 'Bearer access-token');
  assert.equal(request.options.muteHttpExceptions, true);
});

for (const [status, code] of [
  [401, 'LINE_PROFILE_401'],
  [403, 'LINE_PROFILE_403'],
  [429, 'LINE_PROFILE_429'],
  [500, 'LINE_PROFILE_HTTP_500']
]) {
  test(`LINE Profile HTTP ${status} returns ${code}`, () => {
    const gas = loadGas(new MockSpreadsheet({ Users: usersSheet() }), {}, status);
    const result = gas.getLineProfile('access-token');

    assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: false, code, message: code });
    assert.equal(gas.__contentReads(), 0);
  });
}

test('missing accessToken returns TOKEN_MISSING without calling LINE', () => {
  const gas = loadGas(new MockSpreadsheet({ Users: usersSheet() }));

  const result = gas.getLineProfile(null);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    code: 'TOKEN_MISSING',
    message: 'TOKEN_MISSING'
  });
  assert.equal(gas.__fetchCalls.length, 0);
});

test('UrlFetchApp errors return a safe code and do not log the accessToken', () => {
  const gas = loadGas(
    new MockSpreadsheet({ Users: usersSheet() }),
    {},
    200,
    { throwError: new Error('request failed secret-token') }
  );

  const result = gas.getLineProfile('secret-token');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    code: 'LINE_PROFILE_NETWORK_OR_AUTH_ERROR',
    message: 'LINE_PROFILE_NETWORK_OR_AUTH_ERROR'
  });
  assert.doesNotMatch(gas.__logs.join('\n'), /secret-token/);
});

test('HTTP 200 with invalid JSON returns PROFILE_RESPONSE_INVALID_JSON', () => {
  const gas = loadGas(
    new MockSpreadsheet({ Users: usersSheet() }),
    {},
    200,
    { responseBody: '{not-json' }
  );

  const result = gas.getLineProfile('access-token');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    code: 'PROFILE_RESPONSE_INVALID_JSON',
    message: 'PROFILE_RESPONSE_INVALID_JSON'
  });
});

for (const profile of [{ displayName: 'Name' }, { userId: 'profile-user-id' }]) {
  test('HTTP 200 with an incomplete profile returns PROFILE_RESPONSE_INVALID', () => {
    const gas = loadGas(new MockSpreadsheet({ Users: usersSheet() }), profile);

    const result = gas.getLineProfile('access-token');

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      success: false,
      code: 'PROFILE_RESPONSE_INVALID',
      message: 'PROFILE_RESPONSE_INVALID'
    });
  });
}

test('Users lookup failures return a safe identity diagnostic code', () => {
  const gas = loadGas(new MockSpreadsheet({ Users: usersSheet() }), {
    userId: 'unknown-id',
    displayName: 'LINE Profile Name'
  });
  gas.getRegisteredUser = () => {
    throw new Error('Users lookup failed accessToken=secret-token');
  };

  const result = gas.getUserInfo('access-token');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    code: 'USER_LOOKUP_FAILED',
    message: 'USER_LOOKUP_FAILED'
  });
  assert.doesNotMatch(gas.__logs.join('\n'), /secret-token/);
});

test('doPost keeps identity backend exceptions on the safe error-code contract', () => {
  const gas = loadGas(new MockSpreadsheet({ Users: usersSheet() }), {
    userId: 'unknown-id',
    displayName: 'LINE Profile Name'
  });
  gas.getRegisteredUser = () => {
    throw new Error('identity internal failure accessToken=secret-token');
  };

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({ action: 'getUserInfo', accessToken: 'secret-token' })
    }
  });
  const result = JSON.parse(output.text);

  assert.deepEqual(result, {
    success: false,
    code: 'USER_LOOKUP_FAILED',
    message: 'USER_LOOKUP_FAILED'
  });
  assert.doesNotMatch(gas.__logs.join('\n'), /secret-token/);
});

test('registration backend exceptions return a safe error code', () => {
  const gas = loadGas(new MockSpreadsheet({ Users: usersSheet() }), {
    userId: 'unknown-id',
    displayName: 'LINE Profile Name'
  });
  gas.LockService.getScriptLock = () => ({
    waitLock() {
      throw new Error('registration internal failure accessToken=secret-token');
    },
    releaseLock() {}
  });

  const result = gas.registerUser({ accessToken: 'secret-token', pickupFloor: '1樓' });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    code: 'REGISTRATION_BACKEND_ERROR',
    message: 'REGISTRATION_BACKEND_ERROR'
  });
  assert.doesNotMatch(gas.__logs.join('\n'), /secret-token/);
});

test('doPost does not expose raw malformed-request exceptions', () => {
  const gas = loadGas(new MockSpreadsheet({ Users: usersSheet() }));

  const output = gas.doPost({ postData: { contents: '{not-json' } });

  assert.deepEqual(JSON.parse(output.text), {
    success: false,
    code: 'REQUEST_FAILED',
    message: 'REQUEST_FAILED'
  });
});

function orderSpreadsheet() {
  return new MockSpreadsheet({
    Users: usersSheet(),
    Settings: new MockSheet([
      ['Date', 'Vendor', 'Mode'],
      ['2026-09-10', '蔡老師', 'A']
    ]),
    Menu: new MockSheet([
      ['Date', 'Vendor', 'item_id', 'item_name', 'price', 'unused', 'note', 'image_url'],
      ['2026-09-09', '蔡老師', 'A01', '小而美', 80, '', '', '']
    ]),
    Orders: new MockSheet([
      ['OrderID', 'Date', 'Vendor', 'Name', 'PickupFloor', 'item_id', 'item_name', 'quantity', 'unit_price', 'subtotal', 'CreatedAt', 'UpdatedAt', 'Status', 'LINE_UserID', 'Balance', 'Note']
    ])
  });
}

function announcementSpreadsheet(rows) {
  const spreadsheet = orderSpreadsheet();
  spreadsheet.sheets.Announcements = new MockSheet([
    ['id', 'title', 'content', 'start_date', 'end_date', 'enabled'],
    ...rows
  ]);
  return spreadsheet;
}

const announcementAsOfDate = new Date('2026-09-04T04:00:00.000Z');

test('active announcements select latest start date and later sheet row for ties', () => {
  const gas = loadGas(announcementSpreadsheet([
    ['old', '舊公告', '舊內容', '2020-09-01', '2100-12-31', true],
    ['same-day-first', '同日公告一', '內容一', '2020-09-03', '2100-12-31', true],
    ['same-day-latest', '同日公告二', '內容二', '2020-09-03', '2100-12-31', true]
  ]));

  const expected = [
    {
      id: 'same-day-latest',
      title: '同日公告二',
      content: '內容二',
      start_date: '2020-09-03',
      end_date: '2100-12-31'
    },
    {
      id: 'same-day-first',
      title: '同日公告一',
      content: '內容一',
      start_date: '2020-09-03',
      end_date: '2100-12-31'
    },
    {
      id: 'old',
      title: '舊公告',
      content: '舊內容',
      start_date: '2020-09-01',
      end_date: '2100-12-31'
    }
  ];

  const calendarResult = gas.getCalendarEvents('admin-id');

  assert.deepEqual(JSON.parse(JSON.stringify(gas.getActiveAnnouncements(announcementAsOfDate))), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(gas.getLatestAnnouncement(announcementAsOfDate))), expected[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(calendarResult.announcements)), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(calendarResult.announcement)), expected[0]);
});

test('announcement filtering ignores disabled, future, and expired rows', () => {
  const gas = loadGas(announcementSpreadsheet([
    ['disabled', '停用公告', '不應顯示', '2026-09-01', '2026-09-30', false],
    ['future', '尚未開始', '不應顯示', '2026-09-05', '2026-09-30', true],
    ['expired', '已結束', '不應顯示', '2026-08-01', '2026-09-03', true]
  ]));

  assert.deepEqual(JSON.parse(JSON.stringify(gas.getActiveAnnouncements(announcementAsOfDate))), []);
});

test('announcement start and end dates are inclusive boundaries', () => {
  const gas = loadGas(announcementSpreadsheet([
    ['boundary', '邊界公告', '首尾日都有效', '2026-09-04', '2026-09-04', true]
  ]));

  assert.equal(gas.getActiveAnnouncements(announcementAsOfDate)[0].id, 'boundary');
});

test('announcement parser accepts Google Sheets Date values', () => {
  const spreadsheet = announcementSpreadsheet([
    ['date-object', '日期物件公告', 'Date object 可正常解析', '', '', true]
  ]);
  const gas = loadGas(spreadsheet);
  const startDate = vm.runInContext("new Date('2026-09-04T00:00:00.000Z')", gas);
  const endDate = vm.runInContext("new Date('2026-09-04T00:00:00.000Z')", gas);
  spreadsheet.sheets.Announcements.rows[1][3] = startDate;
  spreadsheet.sheets.Announcements.rows[1][4] = endDate;

  assert.deepEqual(JSON.parse(JSON.stringify(gas.getActiveAnnouncements(announcementAsOfDate))), [
    {
      id: 'date-object',
      title: '日期物件公告',
      content: 'Date object 可正常解析',
      start_date: '2026-09-04',
      end_date: '2026-09-04'
    }
  ]);
});

test('malformed announcement rows are ignored with warnings without hiding valid rows', () => {
  const spreadsheet = announcementSpreadsheet([
    ['', '缺少 id', '不應顯示', '2026-09-01', '2026-09-30', true],
    ['reversed', '日期顛倒', '不應顯示', '2026-09-30', '2026-09-01', true],
    ['valid', '有效公告', '應正常回傳', '2020-09-01', '2100-12-31', true]
  ]);
  const gas = loadGas(spreadsheet);

  const result = gas.getCalendarEvents('admin-id');

  assert.equal(result.success, true);
  assert.equal(result.announcements.length, 1);
  assert.equal(result.announcement.id, 'valid');
  assert.equal(gas.__logs.length, 2);
  assert.match(gas.__logs[0], /malformed row 2/);
  assert.match(gas.__logs[1], /malformed row 3/);
});

test('missing Announcements sheet returns null and keeps calendar initialization successful', () => {
  const gas = loadGas(orderSpreadsheet());

  const result = gas.getCalendarEvents('admin-id');

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.announcements)), []);
  assert.equal(result.announcement, null);
  assert.ok(result.events['2026-09-10']);
  assert.match(gas.__logs[0], /Announcements sheet not found/);
});

test('calendar page data includes the effective announcement without another frontend request', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const barSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AnnouncementBar.jsx'), 'utf8');
  const modalSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'AnnouncementModal.jsx'), 'utf8');
  const calendarSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'calendar', 'CalendarManagement.jsx'), 'utf8');
  const orderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'orders', 'OrderPage.jsx'), 'utf8');
  const gasCalendarSource = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Calendar.gs'), 'utf8');

  assert.match(appSource, /import AnnouncementBar from ['"]\.\/components\/AnnouncementBar['"]/);
  assert.match(appSource, /import AnnouncementModal from ['"]\.\/components\/AnnouncementModal['"]/);
  assert.match(appSource, /const \[announcements, setAnnouncements\] = useState\(\[\]\)/);
  assert.match(appSource, /Array\.isArray\(data\.announcements\)/);
  assert.match(appSource, /setAnnouncements\(nextAnnouncements\)/);
  assert.match(appSource, /announcements is canonical/);
  assert.match(appSource, /onClick=\{\(\) => setShowAnnouncementModal\(true\)\}/);
  assert.match(appSource, /<AnnouncementBar[\s\S]*announcement=\{announcements\[0\] \?\? null\}/);
  assert.match(appSource, /<AnnouncementModal[\s\S]*announcements=\{announcements\}/);
  assert.match(barSource, /truncate/);
  assert.match(barSource, /onClick/);
  assert.match(modalSource, /announcements\.map/);
  assert.match(modalSource, /announcement\.title/);
  assert.match(modalSource, /announcement\.content/);
  assert.match(gasCalendarSource, /announcements: announcements/);
  assert.match(gasCalendarSource, /Transitional compatibility/);
  assert.match(calendarSource, /w-full min-w-0 bg-white/);
  assert.match(calendarSource, /grid grid-cols-5/);
  assert.match(appSource, /w-full max-w-xl min-w-0 mx-auto flex-1 p-4/);
  assert.doesNotMatch(appSource, /bg-amber-50 border-amber-200 text-amber-900/);
  assert.doesNotMatch(appSource, /bg-amber-100 text-amber-800/);
  assert.match(appSource, /bg-slate-300 border border-slate-400 text-slate-700/);
  assert.match(appSource, /bg-slate-500 text-white/);
  assert.match(orderSource, /isExpired \?/);
  assert.match(orderSource, /bg-slate-500 text-white text-xs px-2\.5 py-1 rounded-full font-bold/);
  assert.match(orderSource, /bg-slate-100 text-slate-700 border border-slate-300/);
  assert.doesNotMatch(orderSource, /bg-amber-100 text-amber-800/);
  assert.doesNotMatch(orderSource, /bg-amber-50 text-amber-800 border border-amber-200/);
});

test('getOrderPageData returns menu and the matching active user order together', () => {
  const spreadsheet = orderSpreadsheet();
  spreadsheet.sheets.Orders.rows.push(
    ['ORD-USER', '2026-09-10', '蔡老師', 'Leo Wu Leo', '9樓', 'A01', '小而美', 2, 80, 160, '2026-09-03 08:00:00', '2026-09-03 08:00:00', 'ACTIVE', 'user-id', -240, '不要菇'],
    ['ORD-OTHER-USER', '2026-09-10', '蔡老師', 'Admin User', '9樓', 'A01', '小而美', 3, 80, 240, '2026-09-03 08:00:00', '2026-09-03 08:00:00', 'ACTIVE', 'admin-id', -140, ''],
    ['ORD-OTHER-DATE', '2026-09-11', '蔡老師', 'Leo Wu Leo', '9樓', 'A01', '小而美', 4, 80, 320, '2026-09-03 08:00:00', '2026-09-03 08:00:00', 'ACTIVE', 'user-id', -400, ''],
    ['ORD-CANCELLED', '2026-09-10', '蔡老師', 'Leo Wu Leo', '9樓', 'A01', '小而美', 5, 80, 400, '2026-09-03 08:00:00', '2026-09-03 08:00:00', 'CANCELLED', 'user-id', -640, '']
  );
  const gas = loadGas(spreadsheet);

  const result = JSON.parse(gas.doGet({
    parameter: {
      action: 'getOrderPageData',
      targetDate: '2026-09-10',
      userId: 'user-id'
    }
  }).text);

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.menu)), [{
    item_id: 'A01',
    item_name: '小而美',
    price: 80,
    note: '',
    image_url: ''
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.myOrder)), {
    orderId: 'ORD-USER',
    items: [{
      order_id: 'ORD-USER',
      item_id: 'A01',
      item_name: '小而美',
      quantity: 2,
      unit_price: 80,
      subtotal: 160
    }],
    note: '不要菇'
  });
});

test('getOrderPageData returns an empty order when the registered user has none', () => {
  const gas = loadGas(orderSpreadsheet());

  const result = gas.getOrderPageData('2026-09-10', 'admin-id');

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.myOrder)), {
    orderId: '',
    items: [],
    note: ''
  });
});

test('getOrderPageData rejects an unregistered user before returning personal order data', () => {
  const gas = loadGas(orderSpreadsheet());

  const result = gas.getOrderPageData('unknown-id', '2026-09-10');

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    message: '此 LINE 帳號尚未註冊，請聯絡管理員。'
  });
});

test('strict identity does not fallback to client name or floor', () => {
  const spreadsheet = new MockSpreadsheet({ Users: usersSheet() });
  const gas = loadGas(spreadsheet, {
    userId: 'unknown-id',
    displayName: 'LINE Profile Name'
  });

  assert.equal(gas.getRegisteredUser('unknown-id'), null);
  const identityResult = gas.getUserInfo('access-token');
  assert.equal(identityResult.success, true);
  assert.equal(identityResult.registered, false);
  assert.equal(identityResult.lineUserId, 'unknown-id');
  assert.equal(identityResult.displayName, 'LINE Profile Name');
  assert.equal(gas.isValidPickupFloor('1樓'), true);
  assert.equal(gas.isValidPickupFloor('2樓'), false);
});

test('first registration uses only LINE Profile identity and is idempotent', () => {
  const spreadsheet = new MockSpreadsheet({
    Users: new MockSheet([
      ['LINE_UserID', '姓名', '樓層', 'Balance', 'Role']
    ])
  });
  const gas = loadGas(spreadsheet, {
    userId: 'profile-user-id',
    displayName: '=HYPERLINK("https://example.com", "Name")'
  });

  const first = gas.registerUser({
    accessToken: 'access-token',
    pickupFloor: '9樓',
    userId: 'client-forged-id',
    displayName: 'Client Name',
    balance: 999,
    role: 'Admin',
    targetUserId: 'another-user'
  });

  assert.equal(first.success, true);
  assert.equal(first.registered, true);
  assert.deepEqual(spreadsheet.sheets.Users.rows[1], [
    'profile-user-id',
    '=HYPERLINK("https://example.com", "Name")',
    '9樓',
    0,
    'User'
  ]);
  assert.equal(spreadsheet.sheets.Users.getRange(2, 2).getNumberFormat(), '@');

  const duplicate = gas.registerUser({
    accessToken: 'access-token',
    pickupFloor: '1樓'
  });
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.alreadyRegistered, true);
  assert.equal(spreadsheet.sheets.Users.rows.length, 2);
  assert.equal(spreadsheet.sheets.Users.getCell(2, 3), '9樓');
});

test('token-authenticated pickup floor update changes only the canonical Users row', () => {
  const spreadsheet = orderSpreadsheet();
  const ordersBefore = spreadsheet.sheets.Orders.rows.map(row => row.slice());
  const gas = loadGas(spreadsheet, {
    userId: 'user-id',
    displayName: 'Leo Wu Leo'
  });

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'updateMyPickupFloor',
        accessToken: 'access-token',
        userId: 'admin-id',
        pickupFloor: '1樓'
      })
    }
  });
  const result = JSON.parse(output.text);

  assert.equal(result.success, true);
  assert.equal(result.user.userId, 'user-id');
  assert.equal(result.user.defaultFloor, '1樓');
  assert.equal(spreadsheet.sheets.Users.getCell(2, 3), '9樓');
  assert.equal(spreadsheet.sheets.Users.getCell(3, 3), '1樓');
  assert.deepEqual(spreadsheet.sheets.Orders.rows, ordersBefore);
});

test('pickup floor update rejects invalid floors and unregistered identities', () => {
  const spreadsheet = orderSpreadsheet();
  const before = spreadsheet.sheets.Users.rows.map(row => row.slice());
  const gas = loadGas(spreadsheet, {
    userId: 'user-id',
    displayName: 'Leo Wu Leo'
  });

  const invalid = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'updateMyPickupFloor',
        accessToken: 'access-token',
        pickupFloor: '2樓'
      })
    }
  });
  assert.equal(JSON.parse(invalid.text).success, false);
  assert.deepEqual(spreadsheet.sheets.Users.rows, before);

  const unregisteredGas = loadGas(spreadsheet, {
    userId: 'unknown-id',
    displayName: 'Unknown User'
  });
  const unregistered = unregisteredGas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'updateMyPickupFloor',
        accessToken: 'access-token',
        pickupFloor: '1樓'
      })
    }
  });
  assert.equal(JSON.parse(unregistered.text).success, false);
  assert.deepEqual(spreadsheet.sheets.Users.rows, before);
});

test('registration rejects invalid floor and failed LINE Profile API validation', () => {
  const spreadsheet = new MockSpreadsheet({ Users: new MockSheet([[
    'LINE_UserID', '姓名', '樓層', 'Balance', 'Role'
  ]]) });
  const gas = loadGas(spreadsheet, {
    userId: 'profile-user-id',
    displayName: 'LINE Profile Name'
  });

  const invalidFloor = gas.registerUser({ accessToken: 'access-token', pickupFloor: '2樓' });
  assert.equal(invalidFloor.success, false);
  assert.match(invalidFloor.message, /只允許/);
  assert.equal(spreadsheet.sheets.Users.rows.length, 1);

  const invalidTokenGas = loadGas(spreadsheet, {
    userId: 'profile-user-id',
    displayName: 'LINE Profile Name'
  }, 401);
  const invalidToken = invalidTokenGas.registerUser({ accessToken: 'expired-token', pickupFloor: '1樓' });
  assert.equal(invalidToken.success, false);
  assert.equal(invalidToken.code, 'LINE_PROFILE_401');
  assert.equal(invalidToken.message, 'LINE_PROFILE_401');
  assert.equal(spreadsheet.sheets.Users.rows.length, 1);
});

test('registration readback failure does not append a second row', () => {
  const spreadsheet = new MockSpreadsheet({ Users: new MockSheet([[
    'LINE_UserID', '姓名', '樓層', 'Balance', 'Role'
  ]]) });
  const gas = loadGas(spreadsheet, {
    userId: 'profile-user-id',
    displayName: 'LINE Profile Name'
  });
  gas.getRegisteredUser = () => null;

  const result = gas.registerUser({ accessToken: 'access-token', pickupFloor: '1樓' });

  assert.equal(result.success, false);
  assert.match(result.message, /無法重新取得/);
  assert.equal(spreadsheet.sheets.Users.rows.length, 2);
});

test('Admin top-up uses Users balance and appends complete TOPUP ledger row', () => {
  const spreadsheet = new MockSpreadsheet({
    Users: usersSheet(),
    TopupHistory: new MockSheet([[
      'Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註'
    ]])
  });
  const gas = loadGas(spreadsheet);

  const result = gas.topUpBalance('admin-id', 'user-id', 500, '現金收款');
  assert.equal(result.success, true);
  assert.equal(result.newBalance, 420);
  assert.equal(spreadsheet.sheets.Users.getCell(3, 4), 420);

  const ledgerRow = spreadsheet.sheets.TopupHistory.rows[1];
  assert.equal(ledgerRow[4], 500);
  assert.equal(ledgerRow[5], 420);
  assert.match(ledgerRow[7], /^TXN-/);
  assert.equal(ledgerRow[8], 'TOPUP');
  assert.equal(ledgerRow[9], '');
  assert.equal(ledgerRow[10], 'admin-id');
  assert.equal(ledgerRow[11], 'Admin User');
});

test('top-up always starts from Users balance even when legacy ledger balance differs', () => {
  const spreadsheet = new MockSpreadsheet({
    Users: usersSheet(),
    TopupHistory: new MockSheet([
      ['Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註', 'TransactionID', 'Type', 'ReferenceID', 'OperatorUserID', 'OperatorName'],
      ['2026-09-01 10:00:00', 'user-id', 'Leo Wu Leo', '9樓', 1000, 9999, 'legacy mismatch', 'TXN-OLD', 'TOPUP', '', 'legacy', 'Legacy']
    ])
  });
  const gas = loadGas(spreadsheet);

  const result = gas.topUpBalance('admin-id', 'user-id', 500, '現金收款');

  assert.equal(result.success, true);
  assert.equal(result.newBalance, 420);
  assert.equal(spreadsheet.sheets.Users.getCell(3, 4), 420);
  assert.equal(spreadsheet.sheets.TopupHistory.rows.at(-1)[5], 420);
});

test('top-up rejects unknown operators, non-Admin operators, and non-positive amounts', () => {
  const spreadsheet = new MockSpreadsheet({ Users: usersSheet() });
  const gas = loadGas(spreadsheet);

  assert.equal(gas.topUpBalance('unknown-id', 'user-id', 100, '').success, false);
  assert.equal(gas.topUpBalance('user-id', 'admin-id', 100, '').success, false);
  assert.equal(gas.topUpBalance('admin-id', 'user-id', 0, '').success, false);
  assert.equal(gas.topUpBalance('admin-id', 'user-id', -1, '').success, false);
  assert.equal(gas.topUpBalance('admin-id', 'user-id', 'NaN', '').success, false);
});

test('schema ensure preserves A:G and backfills only safe legacy metadata', () => {
  const legacyRows = [
    ['Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註'],
    ['2026-09-01 10:00:00', 'user-id', 'Leo Wu Leo', '9樓', 500, 420, 'Admin 手動儲值'],
    ['2026-09-02 10:00:00', 'user-id', 'Leo Wu Leo', '9樓', -160, 260, '未知歷史備註']
  ];
  const spreadsheet = new MockSpreadsheet({ TopupHistory: new MockSheet(legacyRows) });
  const gas = loadGas(spreadsheet);
  const before = legacyRows.map(row => row.slice());

  gas.ensureTopupHistorySchema();

  const history = spreadsheet.sheets.TopupHistory;
  assert.deepEqual(history.rows.map(row => row.slice(0, 7)), before);
  assert.deepEqual(history.rows[0].slice(7, 12), [
    'TransactionID', 'Type', 'ReferenceID', 'OperatorUserID', 'OperatorName'
  ]);
  assert.match(history.rows[1][7], /^TXN-LEGACY-/);
  assert.equal(history.rows[1][8], 'TOPUP');
  assert.equal(history.rows[1][9], '');
  assert.equal(history.rows[1][10], 'LEGACY');
  assert.equal(history.rows[1][11], 'LEGACY');
  assert.equal(history.rows[2][8], '');
});

test('submit and cancel append ORDER/REFUND using the same OrderID', () => {
  const spreadsheet = orderSpreadsheet();
  const gas = loadGas(spreadsheet);

  const submitted = gas.submitOrder({
    userId: 'user-id',
    pickup_floor: '1樓',
    target_date: '2026-09-10',
    items: [{ item_id: 'A01', quantity: 2, item_name: 'client value', unit_price: 1 }],
    note: '不要菇'
  });

  assert.equal(submitted.success, true);
  assert.match(submitted.orderId, /^ORD-/);
  assert.equal(spreadsheet.sheets.Users.getCell(3, 4), -240);
  const orderLedger = spreadsheet.sheets.TopupHistory.rows.at(-1);
  assert.equal(orderLedger[4], -160);
  assert.equal(orderLedger[5], -240);
  assert.equal(orderLedger[8], 'ORDER');
  assert.equal(orderLedger[9], submitted.orderId);
  assert.equal(spreadsheet.sheets.Orders.rows[1][3], 'Leo Wu Leo');
  assert.equal(spreadsheet.sheets.Orders.rows[1][4], '1樓');
  assert.equal(spreadsheet.sheets.Orders.rows[1][8], 80);

  const unauthorizedCancel = gas.cancelOrder({
    userId: 'admin-id',
    orderId: submitted.orderId,
    date: '2026-09-10'
  });
  assert.equal(unauthorizedCancel.success, false);

  const cancelled = gas.cancelOrder({
    userId: 'user-id',
    orderId: submitted.orderId,
    date: '2026-09-10'
  });

  assert.equal(cancelled.success, true);
  assert.equal(cancelled.newBalance, -80);
  assert.equal(spreadsheet.sheets.Users.getCell(3, 4), -80);
  assert.equal(spreadsheet.sheets.Orders.rows[1][12], 'CANCELLED');
  const refundLedger = spreadsheet.sheets.TopupHistory.rows.at(-1);
  assert.equal(refundLedger[4], 160);
  assert.equal(refundLedger[5], -80);
  assert.equal(refundLedger[8], 'REFUND');
  assert.equal(refundLedger[9], submitted.orderId);
});

test('editing an order refunds the old OrderID and charges a new OrderID', () => {
  const spreadsheet = orderSpreadsheet();
  const gas = loadGas(spreadsheet);
  const first = gas.submitOrder({
    userId: 'user-id',
    pickup_floor: '9樓',
    target_date: '2026-09-10',
    items: [{ item_id: 'A01', quantity: 2 }],
    note: ''
  });
  const second = gas.submitOrder({
    userId: 'user-id',
    pickup_floor: '1樓',
    target_date: '2026-09-10',
    items: [{ item_id: 'A01', quantity: 1 }],
    note: ''
  });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.notEqual(first.orderId, second.orderId);
  assert.equal(spreadsheet.sheets.Users.getCell(3, 4), -160);
  assert.equal(spreadsheet.sheets.Orders.rows[1][12], 'CANCELLED');
  assert.equal(spreadsheet.sheets.Orders.rows[2][12], 'ACTIVE');
  const ledger = spreadsheet.sheets.TopupHistory.rows;
  assert.equal(ledger[1][8], 'ORDER');
  assert.equal(ledger[2][8], 'REFUND');
  assert.equal(ledger[2][9], first.orderId);
  assert.equal(ledger[3][8], 'ORDER');
  assert.equal(ledger[3][9], second.orderId);
});

test('reconciliation is read-only and reports differences without repairing them', () => {
  const spreadsheet = new MockSpreadsheet({
    Users: usersSheet(),
    TopupHistory: new MockSheet([
      ['Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註', 'TransactionID', 'Type', 'ReferenceID', 'OperatorUserID', 'OperatorName'],
      ['2026-09-01 10:00:00', 'user-id', 'Leo Wu Leo', '9樓', 500, 420, '現金收款', 'TXN-1', 'TOPUP', '', 'admin-id', 'Admin User']
    ])
  });
  const gas = loadGas(spreadsheet);
  const usersBefore = spreadsheet.sheets.Users.rows.map(row => row.slice());
  const ledgerBefore = spreadsheet.sheets.TopupHistory.rows.map(row => row.slice());

  const result = gas.auditBalanceConsistency();

  assert.equal(result.success, true);
  assert.equal(result.allConsistent, false);
  assert.equal(result.results.find(row => row.lineUserId === 'user-id').difference, -500);
  assert.equal(result.results.find(row => row.lineUserId === 'admin-id').latestLedgerBalance, null);
  assert.deepEqual(spreadsheet.sheets.Users.rows, usersBefore);
  assert.deepEqual(spreadsheet.sheets.TopupHistory.rows, ledgerBefore);
});

function ledgerSpreadsheet(rows) {
  return new MockSpreadsheet({
    Users: usersSheet(),
    TopupHistory: new MockSheet(rows)
  });
}

test('monthly balance history keeps the previous month opening balance and stable newest-first order', () => {
  const gas = loadGas(ledgerSpreadsheet([
    ['Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註', 'TransactionID', 'Type', 'ReferenceID'],
    ['2026-08-31 23:59:59', 'user-id', 'Leo Wu Leo', '9樓', 0, 500, '月初餘額', 'TXN-AUG', 'ADJUSTMENT', ''],
    ['2026-09-01 00:00:00', 'user-id', 'Leo Wu Leo', '9樓', -100, 400, '訂餐扣款 (2026-09-01)', 'TXN-SEP-1', 'ORDER', 'ORD-1'],
    ['2026-09-03 16:25:00', 'user-id', 'Leo Wu Leo', '9樓', -200, 200, '訂餐扣款 (2026-09-09)', 'TXN-SEP-2', 'ORDER', 'ORD-2']
  ]));

  const result = gas.getBalanceHistoryByMonth('user-id', 2026, 9);

  assert.equal(result.success, true);
  assert.equal(result.openingBalance, 500);
  assert.equal(result.totalCredit, 0);
  assert.equal(result.totalDebit, 300);
  assert.equal(result.closingBalance, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(result.transactions.map(row => row.id))), ['TXN-SEP-2', 'TXN-SEP-1']);
});

test('monthly balance history aggregates credits and debits from the anchored opening balance', () => {
  const gas = loadGas(ledgerSpreadsheet([
    ['Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註', 'TransactionID', 'Type', 'ReferenceID'],
    ['2026-08-31 12:00:00', 'user-id', 'Leo Wu Leo', '9樓', 0, -500, '前月結餘', 'TXN-AUG', 'ADJUSTMENT', ''],
    ['2026-09-02 09:00:00', 'user-id', 'Leo Wu Leo', '9樓', 200, -300, '取消訂單退款', 'TXN-CREDIT', 'REFUND', 'ORD-1'],
    ['2026-09-04 09:00:00', 'user-id', 'Leo Wu Leo', '9樓', -300, -600, '訂餐扣款', 'TXN-DEBIT', 'ORDER', 'ORD-2']
  ]));

  const result = gas.getBalanceHistoryByMonth('user-id', 2026, 9);

  assert.equal(result.openingBalance, -500);
  assert.equal(result.totalCredit, 200);
  assert.equal(result.totalDebit, 300);
  assert.equal(result.closingBalance, -600);
});

test('monthly balance history returns equal opening and closing balances for an empty month', () => {
  const gas = loadGas(ledgerSpreadsheet([
    ['Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註', 'TransactionID', 'Type', 'ReferenceID'],
    ['2026-08-31 23:59:59', 'user-id', 'Leo Wu Leo', '9樓', 0, 400, '前月結餘', 'TXN-AUG', 'ADJUSTMENT', '']
  ]));

  const result = gas.getBalanceHistoryByMonth('user-id', 2026, 9);

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.transactions)), []);
  assert.equal(result.openingBalance, 400);
  assert.equal(result.closingBalance, 400);
  assert.equal(result.totalCredit, 0);
  assert.equal(result.totalDebit, 0);
});

test('monthly balance history rejects invalid months safely', () => {
  const gas = loadGas(ledgerSpreadsheet([
    ['Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註', 'TransactionID', 'Type', 'ReferenceID']
  ]));

  assert.equal(gas.getBalanceHistoryByMonth('user-id', 2026, 0).success, false);
  assert.equal(gas.getBalanceHistoryByMonth('user-id', 2026, 13).success, false);
});

test('monthly balance history uses the existing ledger read-only', () => {
  const rows = [
    ['Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註', 'TransactionID', 'Type', 'ReferenceID'],
    ['2026-08-31 23:59:59', 'user-id', 'Leo Wu Leo', '9樓', 0, 400, '前月結餘', 'TXN-AUG', 'ADJUSTMENT', '']
  ];
  const spreadsheet = ledgerSpreadsheet(rows);
  const before = spreadsheet.sheets.TopupHistory.rows.map(row => row.slice());
  const gas = loadGas(spreadsheet);

  gas.getBalanceHistoryByMonth('user-id', '2026', '09');

  assert.deepEqual(spreadsheet.sheets.TopupHistory.rows, before);
});

test('monthly balance API resolves the user from the LINE access token, not a forged userId', () => {
  const spreadsheet = ledgerSpreadsheet([
    ['Timestamp', 'LINE_UserID', '姓名', '樓層', '異動金額', '結餘', '備註', 'TransactionID', 'Type', 'ReferenceID'],
    ['2026-09-01 10:00:00', 'user-id', 'Leo Wu Leo', '9樓', -100, -180, '本人扣款', 'TXN-USER', 'ORDER', 'ORD-USER'],
    ['2026-09-02 10:00:00', 'admin-id', 'Admin User', '9樓', 500, 600, '其他帳戶儲值', 'TXN-ADMIN', 'TOPUP', '']
  ]);
  const gas = loadGas(spreadsheet, { userId: 'user-id', displayName: 'Leo Wu Leo' });

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'getBalanceHistoryByMonth',
        accessToken: 'access-token',
        userId: 'admin-id',
        year: '2026',
        month: '09'
      })
    }
  });
  const result = JSON.parse(output.text);

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.transactions.map(row => row.id))), ['TXN-USER']);
});

test('calendar management keeps the existing special-date vendor save contract', () => {
  const spreadsheet = new MockSpreadsheet({
    Users: usersSheet(),
    Settings: new MockSheet([
      ['Date', 'Vendor', 'Mode'],
      ['2026-09-09', '蔡老師', 'A']
    ])
  });
  const gas = loadGas(spreadsheet);

  const result = gas.adminSetVendor({
    adminUserId: 'admin-id',
    dateStr: '2026-09-09',
    vendor: '禾拾'
  });

  assert.equal(result.success, true);
  assert.equal(spreadsheet.sheets.Settings.rows[1][1], '禾拾');
  assert.equal(spreadsheet.sheets.Settings.rows[1][2], 'B');
});

test('admin summary defaults to today and returns an empty summary for a future date', () => {
  const gas = loadGas(orderSpreadsheet());
  const todayResult = gas.getAdminSummary('admin-id');
  const futureResult = gas.getAdminSummary('admin-id', '2099-12-31');

  assert.equal(todayResult.success, true);
  assert.match(todayResult.targetDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(futureResult.success, true);
  assert.equal(futureResult.totalItems, 0);
  assert.equal(futureResult.totalAmount, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(futureResult.items)), []);
});

test('admin summary filters the selected date and aggregates item, amount, and pickup totals', () => {
  const spreadsheet = orderSpreadsheet();
  spreadsheet.sheets.Orders.rows.push(
    ['ORD-0909-A', '2026-09-09', '蔡老師', 'Leo Wu Leo', '1樓', 'A01', '小而美', 2, 80, 160, '2026-09-03 08:00:00', '2026-09-03 08:00:00', 'ACTIVE', 'user-id', -240, ''],
    ['ORD-0909-B', '2026-09-09', '蔡老師', 'Admin User', '9樓', 'A02', '田園便當', 1, 100, 100, '2026-09-03 08:00:00', '2026-09-03 08:00:00', 'ACTIVE', 'admin-id', 0, ''],
    ['ORD-0908', '2026-09-08', '蔡老師', 'Leo Wu Leo', '1樓', 'A01', '小而美', 9, 80, 720, '2026-09-03 08:00:00', '2026-09-03 08:00:00', 'ACTIVE', 'user-id', -800, ''],
    ['ORD-0910', '2026-09-10', '蔡老師', 'Leo Wu Leo', '1樓', 'A01', '小而美', 7, 80, 560, '2026-09-03 08:00:00', '2026-09-03 08:00:00', 'ACTIVE', 'user-id', -640, '']
  );
  const gas = loadGas(spreadsheet);

  const result = gas.getAdminSummary('admin-id', '2026-09-09');

  assert.equal(result.success, true);
  assert.equal(result.todayOrders.length, 2);
  assert.equal(result.totalItems, 3);
  assert.equal(result.totalAmount, 260);
  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), [
    { item_id: 'A01', item_name: '小而美', quantity: 2, totalAmount: 160 },
    { item_id: 'A02', item_name: '田園便當', quantity: 1, totalAmount: 100 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.pickupSummary)), {
    '1樓': { totalItems: 2, totalAmount: 160 },
    '9樓': { totalItems: 1, totalAmount: 100 }
  });
});

test('admin summary rejects invalid date-only values', () => {
  const gas = loadGas(orderSpreadsheet());

  assert.equal(gas.getAdminSummary('admin-id', '2026-02-30').success, false);
  assert.equal(gas.getAdminSummary('admin-id', 'abc').success, false);
});

test('admin summary is restricted to Admin and its token API ignores forged operator ids', () => {
  const spreadsheet = orderSpreadsheet();
  const gas = loadGas(spreadsheet, { userId: 'user-id', displayName: 'Leo Wu Leo' });

  assert.equal(gas.getAdminSummary('user-id', '2026-09-09').success, false);

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'getAdminSummary',
        accessToken: 'access-token',
        userId: 'admin-id',
        role: 'Admin',
        targetDate: '2026-09-09'
      })
    }
  });

  assert.equal(JSON.parse(output.text).success, false);
});

test('central permission model keeps ProxyAdmin operational read access without finance or identity access', () => {
  const gas = loadGas(new MockSpreadsheet({ Users: usersWithProxySheet() }));

  assert.equal(gas.hasPermission('User', 'orderOwn'), true);
  assert.equal(gas.hasPermission('User', 'viewMemberBalances'), false);
  assert.equal(gas.hasPermission('User', 'topupMember'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewAdminOrderSummary'), true);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewAllOrders'), true);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewOrderStatistics'), true);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewMemberBalances'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'topupMember'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'manageUsers'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'manageRoles'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewAsUser'), false);
  assert.equal(gas.hasPermission('Admin', 'viewAsUser'), true);
});

test('ProxyAdmin retains operations access but cannot read balances or top up', () => {
  const spreadsheet = orderSpreadsheet();
  spreadsheet.sheets.Users = usersWithProxySheet();
  const gas = loadGas(spreadsheet);

  const summary = gas.getAdminSummary('proxy-id', '2026-09-10', false);
  const balances = gas.getMemberBalances('proxy-id');
  const topup = gas.topUpBalance('proxy-id', 'user-id', 100, 'forged finance attempt');

  assert.equal(summary.success, true);
  assert.equal(summary.requesterRole, 'ProxyAdmin');
  assert.deepEqual(JSON.parse(JSON.stringify(summary.usersSummary)), []);
  assert.equal(balances.success, false);
  assert.equal(topup.success, false);
  assert.equal(spreadsheet.sheets.Users.getCell(3, 4), -80);
});

test('includeMemberBalances false avoids the member-list Users read while legacy callers remain compatible', () => {
  const noBalancesUsers = new TrackingSheet(usersSheet().rows);
  const noBalancesSpreadsheet = orderSpreadsheet();
  noBalancesSpreadsheet.sheets.Users = noBalancesUsers;
  const noBalancesGas = loadGas(noBalancesSpreadsheet);

  const withoutBalances = noBalancesGas.getAdminSummary('admin-id', '2026-09-10', false);

  assert.equal(withoutBalances.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(withoutBalances.usersSummary)), []);
  assert.equal(noBalancesUsers.dataRangeReads, 1);

  const legacyUsers = new TrackingSheet(usersSheet().rows);
  const legacySpreadsheet = orderSpreadsheet();
  legacySpreadsheet.sheets.Users = legacyUsers;
  const legacyGas = loadGas(legacySpreadsheet);
  const legacySummary = legacyGas.getAdminSummary('admin-id', '2026-09-10');

  assert.equal(legacySummary.success, true);
  assert.equal(legacySummary.usersSummary.length, 2);
  assert.equal(legacyUsers.dataRangeReads, 2);
});

test('token-authenticated admin APIs ignore forged operator ids', () => {
  const spreadsheet = orderSpreadsheet();
  const gas = loadGas(spreadsheet, { userId: 'user-id', displayName: 'Leo Wu Leo' });

  const topupOutput = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'topUpBalance',
        accessToken: 'access-token',
        adminUserId: 'admin-id',
        targetUserId: 'user-id',
        amount: 100,
        note: 'forged operator'
      })
    }
  });
  const vendorOutput = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'adminSetVendor',
        accessToken: 'access-token',
        adminUserId: 'admin-id',
        dateStr: '2026-09-10',
        vendor: '禾拾'
      })
    }
  });
  const roleOutput = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'assignProxy',
        accessToken: 'access-token',
        userId: 'admin-id',
        targetUserId: 'user-id',
        newRole: 'ProxyAdmin'
      })
    }
  });

  assert.equal(JSON.parse(topupOutput.text).success, false);
  assert.equal(JSON.parse(vendorOutput.text).success, false);
  assert.equal(JSON.parse(roleOutput.text).success, false);
  assert.equal(spreadsheet.sheets.Users.getCell(3, 5), 'User');
  assert.equal(spreadsheet.sheets.Settings.rows[1][1], '蔡老師');
});

test('token-authenticated admin operator is accepted even when client operator id is forged', () => {
  const spreadsheet = orderSpreadsheet();
  const gas = loadGas(spreadsheet, { userId: 'admin-id', displayName: 'Admin User' });

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'topUpBalance',
        accessToken: 'access-token',
        adminUserId: 'user-id',
        targetUserId: 'user-id',
        amount: 100,
        note: 'token wins'
      })
    }
  });

  const result = JSON.parse(output.text);
  assert.equal(result.success, true);
  assert.equal(result.newBalance, 20);
  assert.equal(spreadsheet.sheets.Users.getCell(3, 4), 20);
});

test('member balance API is permission-gated by the authenticated LINE identity', () => {
  const spreadsheet = new MockSpreadsheet({ Users: usersWithProxySheet() });
  const gas = loadGas(spreadsheet, { userId: 'user-id', displayName: 'Leo Wu Leo' });

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'getMemberBalances',
        accessToken: 'access-token',
        userId: 'admin-id'
      })
    }
  });

  assert.equal(JSON.parse(output.text).success, false);
});

test('token-authenticated order writes ignore forged user ids', () => {
  const spreadsheet = orderSpreadsheet();
  const gas = loadGas(spreadsheet, { userId: 'user-id', displayName: 'Leo Wu Leo' });

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'submitOrder',
        accessToken: 'access-token',
        userId: 'admin-id',
        pickup_floor: '1樓',
        target_date: '2026-09-10',
        items: [{ item_id: 'A01', quantity: 1 }],
        note: ''
      })
    }
  });
  const result = JSON.parse(output.text);

  assert.equal(result.success, true);
  assert.equal(spreadsheet.sheets.Orders.rows[1][13], 'user-id');
  assert.equal(spreadsheet.sheets.Users.getCell(3, 4), -160);
});

test('frontend separates auth/view-as identity, guards writes, and keeps date changes off member balances', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const permissionsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth', 'permissions.js'), 'utf8');
  const viewAsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ViewAsBanner.jsx'), 'utf8');
  const dateHandler = appSource.match(/const handleAdminDateChange = \(dateStr\) => \{[\s\S]*?\n  \};/);
  const exitViewAsHandler = appSource.match(/const handleExitViewAs = \(\) => \{[\s\S]*?\n  \};/);

  assert.match(permissionsSource, /export const ROLE_PERMISSIONS/);
  assert.match(permissionsSource, /export const hasPermission/);
  assert.match(appSource, /from ['"]\.\/auth\/permissions['"]/);
  assert.match(appSource, /const \[authUser, setAuthUser\]/);
  assert.match(appSource, /const \[viewAsUser, setViewAsUser\]/);
  assert.match(appSource, /const effectiveUser = viewAsUser \|\| authUser/);
  assert.match(appSource, /const effectiveRole = effectiveUser\?\.role/);
  assert.match(appSource, /showViewAsModal/);
  assert.match(viewAsSource, /返回 Admin/);
  assert.match(appSource, /action: 'getMemberBalances'/);
  assert.match(appSource, /includeMemberBalances: false/);
  assert.doesNotMatch(appSource, /adminSummary\.usersSummary\.map/);
  assert.match(appSource, /const guardWrite = async/);
  assert.match(appSource, /guardWrite\('愛心投票'\)/);
  assert.match(appSource, /guardWrite\('月曆設定'\)/);
  assert.match(appSource, /guardWrite\('訂單送出'\)/);
  assert.match(appSource, /guardWrite\('取消訂單'\)/);
  assert.match(appSource, /guardWrite\('儲值'\)/);
  assert.ok(dateHandler);
  assert.doesNotMatch(dateHandler[0], /loadMemberBalances/);
  assert.ok(exitViewAsHandler);
  assert.match(exitViewAsHandler[0], /setViewAsUser\(null\)/);
  assert.match(exitViewAsHandler[0], /authUser\?\.role/);

  const selectViewAsHandler = appSource.match(/const handleSelectViewAs = \(user\) => \{[\s\S]*?\n  \};/);
  assert.ok(selectViewAsHandler);
  assert.doesNotMatch(selectViewAsHandler[0], /setAuthUser|setLineUserId/);
});

test('frontend wires floor editing, version history, modal preview, and corrected finance permissions', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const permissionsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth', 'permissions.js'), 'utf8');
  const changelogSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'changelog.js'), 'utf8');
  const modalSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Modal.jsx'), 'utf8');
  const orderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'orders', 'OrderPage.jsx'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));

  assert.equal(packageJson.version, '0.7.0');
  assert.equal(packageLock.version, '0.7.0');
  assert.equal(packageLock.packages[''].version, '0.7.0');
  assert.match(changelogSource, /from ['"]\.\.\/\.\.\/package\.json['"]/);
  assert.match(changelogSource, /version: '0\.1\.0'/);
  assert.match(changelogSource, /version: '0\.7\.0'/);
  assert.match(changelogSource, /version: '0\.6\.0'/);
  assert.match(changelogSource, /新增首頁公告與公告詳情/);
  assert.match(changelogSource, /支援同時查看多則有效公告/);
  assert.match(changelogSource, /修正切換月份時月曆寬度不一致/);
  assert.match(changelogSource, /統一已截止日期視覺狀態/);
  assert.match(changelogSource, /commits:/);
  assert.match(modalSource, /role="dialog"/);
  assert.match(modalSource, /Escape/);
  assert.match(appSource, /APP_VERSION/);
  assert.match(appSource, /CHANGELOG/);
  assert.match(appSource, /updateMyPickupFloor/);
  assert.match(appSource, /showFloorModal/);
  assert.match(appSource, /showChangelogModal/);
  assert.match(appSource, /imagePreview/);
  assert.match(orderSource, /onImagePreview/);
  assert.match(orderSource, /w-20 h-20 sm:w-24 sm:h-24/);
  assert.match(orderSource, /aria-label/);
  assert.match(permissionsSource, /ProxyAdmin:[\s\S]*?viewMemberBalances: false[\s\S]*?topupMember: false/);
  assert.match(permissionsSource, /Admin:[\s\S]*?viewMemberBalances: true[\s\S]*?topupMember: true/);
});

test('month navigation crosses calendar year boundaries', async () => {
  const utils = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'dateUtils.js')).href);

  assert.deepEqual(utils.shiftYearMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(utils.shiftYearMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(utils.getTaipeiYearMonth(new Date('2026-09-30T16:30:00Z')), { year: 2026, month: 10 });
  assert.equal(utils.formatDateInput(new Date('2026-09-30T16:30:00Z')), '2026-10-01');
});

test('calendar management owns special-date controls without a separate modal entry', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');

  assert.doesNotMatch(appSource, /showSpecialAdminModal/);
  assert.doesNotMatch(appSource, /特殊日期開團/);
  assert.match(appSource, /specialAdminDate/);
});

test('frontend wires monthly balance and selected-date admin summary queries', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');

  assert.match(appSource, /getBalanceHistoryByMonth/);
  assert.match(appSource, /selectedYear/);
  assert.match(appSource, /selectedOrderDate/);
  assert.match(appSource, /adminSummaryRequestRef\.current \+= 1/);
  assert.match(appSource, /historyRequestRef\.current \+= 1/);
});
