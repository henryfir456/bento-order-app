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
  let activeSpreadsheetCalls = 0;
  const fetchCalls = [];
  const logs = [];
  let contentReads = 0;
  const logger = fetchBehavior.logger || {
    warn: (...args) => logs.push(args.join(' ')),
    error: (...args) => logs.push(args.join(' ')),
    info: (...args) => logs.push(args.join(' ')),
    log: (...args) => logs.push(args.join(' '))
  };
  const responseBody = Object.prototype.hasOwnProperty.call(fetchBehavior, 'responseBody')
    ? fetchBehavior.responseBody
    : JSON.stringify(lineProfile);
  const context = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => {
        activeSpreadsheetCalls += 1;
        return spreadsheet;
      }
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
    __activeSpreadsheetCalls: () => activeSpreadsheetCalls,
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
    'Bootstrap.gs',
    'DeferredBootstrap.gs',
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

function bootstrapSpreadsheet(orderRows = []) {
  const spreadsheet = orderSpreadsheet();
  spreadsheet.sheets.Users = new TrackingSheet(usersSheet().rows);
  spreadsheet.sheets.Settings = new TrackingSheet([
    ['Date', 'Vendor', 'Mode'],
    ['2026-09-10', '蔡老師', 'A']
  ]);
  spreadsheet.sheets.Likes = new TrackingSheet([
    ['Date', 'LINE_UserID', 'Created_At']
  ]);
  spreadsheet.sheets.Menu = new TrackingSheet(spreadsheet.sheets.Menu.rows);
  spreadsheet.sheets.Orders = new TrackingSheet([
    ['OrderID', 'Date', 'Vendor', 'Name', 'PickupFloor', 'item_id', 'item_name', 'quantity', 'unit_price', 'subtotal', 'CreatedAt', 'UpdatedAt', 'Status', 'LINE_UserID', 'Balance', 'Note'],
    ...orderRows
  ]);
  spreadsheet.sheets.Announcements = new TrackingSheet([
    ['id', 'title', 'content', 'start_date', 'end_date', 'enabled']
  ]);
  return spreadsheet;
}

function orderRow(orderId, date, userId, status = 'ACTIVE') {
  return [
    orderId,
    date,
    '蔡老師',
    'Test User',
    '9樓',
    'A01',
    '小而美',
    1,
    80,
    80,
    '2026-09-01T01:00:00.000Z',
    '2026-09-01T01:00:00.000Z',
    status,
    userId,
    0,
    ''
  ];
}

test('bootstrap authenticates canonically and reads each startup sheet once', () => {
  const spreadsheet = bootstrapSpreadsheet([
    orderRow('active-target', '2026-09-10', 'user-id'),
    orderRow('active-other-date', '2026-09-11', 'user-id'),
    orderRow('active-other-user', '2026-09-10', 'other-user'),
    orderRow('cancelled-target', '2026-09-10', 'user-id', 'CANCELLED')
  ]);
  const gas = loadGas(spreadsheet, {
    userId: 'user-id',
    displayName: 'LINE Profile Name'
  });

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'getBootstrapData',
        accessToken: 'access-token',
        bootId: 'BOOT-20260906-abc123',
        deferUiData: true
      })
    }
  });
  const result = JSON.parse(output.text);

  assert.equal(result.success, true);
  assert.equal(result.registered, true);
  assert.equal(result.user.userId, 'user-id');
  assert.equal(result.user.lineUserId, 'user-id');
  assert.equal(result.user.displayName, 'LINE Profile Name');
  assert.equal(result.calendar.events['2026-09-10'].vendor, '蔡老師');
  assert.equal(Object.prototype.hasOwnProperty.call(result.calendar.events['2026-09-10'], 'likeCount'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.calendar.announcements)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(result.ordersMap)), {
    '2026-09-10': true,
    '2026-09-11': true
  });
  assert.equal(result.bootId, 'BOOT-20260906-abc123');
  const perfLines = gas.__logs.filter(line => line.includes('[PERF][BOOT][BOOT-20260906-abc123] backend'));
  assert.ok(perfLines.some(line => line.includes('"metric":"LINE_PROFILE_MS"')));
  assert.ok(perfLines.some(line => line.includes('"metric":"USER_LOOKUP_MS"')));
  assert.ok(perfLines.some(line => line.includes('"metric":"ORDERS_MS"')));
  assert.ok(perfLines.some(line => line.includes('"metric":"BOOTSTRAP_TOTAL_MS"')));
  assert.doesNotMatch(perfLines.join('\n'), /metric":"(?:LIKES_MS|ANNOUNCEMENTS_MS)/);
  assert.doesNotMatch(perfLines.join('\n'), /access-token|user-id|LINE Profile Name|Authorization/i);
  assert.equal(result.observability.timing.status, 'success');
  assert.deepEqual(Object.keys(result.observability.timing.metrics).sort(), [
    'BOOTSTRAP_TOTAL_MS',
    'CALENDAR_MS',
    'LINE_PROFILE_MS',
    'ORDERS_MS',
    'SETTINGS_MS',
    'USER_LOOKUP_MS'
  ]);
  assert.equal(spreadsheet.sheets.Users.dataRangeReads, 1);
  assert.equal(spreadsheet.sheets.Settings.dataRangeReads, 1);
  assert.equal(spreadsheet.sheets.Likes.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Announcements.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Orders.dataRangeReads, 1);
  assert.equal(spreadsheet.sheets.Menu.dataRangeReads, 0);
  assert.equal(gas.__fetchCalls.length, 1);
  assert.equal(gas.__activeSpreadsheetCalls(), 1);
});

test('bootstrap without deferUiData keeps the legacy Likes and Announcements response', () => {
  const spreadsheet = bootstrapSpreadsheet();
  spreadsheet.sheets.Likes.rows.push(['2026-09-10', 'user-id', '2026-09-01T01:00:00.000Z']);
  spreadsheet.sheets.Announcements.rows.push([
    'legacy-announcement',
    'Legacy announcement',
    'Legacy content',
    '2020-01-01',
    '2100-12-31',
    true
  ]);
  const gas = loadGas(spreadsheet, {
    userId: 'user-id',
    displayName: 'LINE Profile Name'
  });

  const result = gas.getBootstrapData('access-token', '', 'BOOT-20260906-legacy1');

  assert.equal(result.success, true);
  assert.equal(result.calendar.events['2026-09-10'].likeCount, 1);
  assert.equal(result.calendar.events['2026-09-10'].isUserLiked, true);
  assert.equal(result.calendar.announcements[0].id, 'legacy-announcement');
  assert.ok(Object.prototype.hasOwnProperty.call(result.observability.timing.metrics, 'LIKES_MS'));
  assert.ok(Object.prototype.hasOwnProperty.call(result.observability.timing.metrics, 'ANNOUNCEMENTS_MS'));
  assert.equal(spreadsheet.sheets.Likes.dataRangeReads, 1);
  assert.equal(spreadsheet.sheets.Announcements.dataRangeReads, 1);
});

test('deferred bootstrap authenticates canonically and reads Likes and Announcements once', () => {
  const spreadsheet = bootstrapSpreadsheet();
  spreadsheet.sheets.Likes.rows.push(
    ['2026-09-10', 'user-id', '2026-09-01T01:00:00.000Z'],
    ['2026-09-10', 'other-user', '2026-09-01T01:00:00.000Z']
  );
  spreadsheet.sheets.Announcements.rows.push([
    'deferred-announcement',
    'Deferred announcement',
    'Deferred content',
    '2020-01-01',
    '2100-12-31',
    true
  ]);
  const gas = loadGas(spreadsheet, {
    userId: 'user-id',
    displayName: 'LINE Profile Name'
  });

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'getDeferredBootstrapData',
        accessToken: 'access-token',
        bootId: 'BOOT-20260906-defer1'
      })
    }
  });
  const result = JSON.parse(output.text);

  assert.equal(result.success, true);
  assert.equal(result.registered, true);
  assert.equal(result.bootId, 'BOOT-20260906-defer1');
  assert.equal(result.likes['2026-09-10'].likeCount, 2);
  assert.equal(result.likes['2026-09-10'].isUserLiked, true);
  assert.equal(result.likes['2026-09-10'].calendarEvent.order_date, '2026-09-10');
  assert.equal(result.likes['2026-09-10'].calendarEvent.vendor, '');
  assert.equal(result.likes['2026-09-10'].calendarEvent.mode, 'A');
  assert.equal(typeof result.likes['2026-09-10'].calendarEvent.deadline, 'string');
  assert.equal(typeof result.likes['2026-09-10'].calendarEvent.isExpired, 'boolean');
  assert.equal(result.announcements[0].id, 'deferred-announcement');
  assert.deepEqual(Object.keys(result.observability.timing.metrics).sort(), [
    'ANNOUNCEMENTS_MS',
    'DEFERRED_UI_TOTAL_MS',
    'LIKES_MS'
  ]);
  const perfLines = gas.__logs.filter(line => line.includes('[PERF][BOOT][BOOT-20260906-defer1] deferred-backend'));
  assert.ok(perfLines.some(line => line.includes('"metric":"LIKES_MS"')));
  assert.ok(perfLines.some(line => line.includes('"metric":"ANNOUNCEMENTS_MS"')));
  assert.ok(perfLines.some(line => line.includes('"metric":"DEFERRED_UI_TOTAL_MS"')));
  assert.doesNotMatch(perfLines.join('\n'), /access-token|user-id|LINE Profile Name|Authorization/i);
  assert.doesNotMatch(JSON.stringify(result), /access-token|user-id|lineUserId|displayName|Authorization/i);
  assert.equal(spreadsheet.sheets.Users.dataRangeReads, 1);
  assert.equal(spreadsheet.sheets.Settings.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Orders.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Likes.dataRangeReads, 1);
  assert.equal(spreadsheet.sheets.Announcements.dataRangeReads, 1);
  assert.equal(gas.__fetchCalls.length, 1);
  assert.equal(gas.__activeSpreadsheetCalls(), 1);
});

test('deferred bootstrap token failures remain safe and do not read deferred sheets', () => {
  const spreadsheet = bootstrapSpreadsheet();
  const gas = loadGas(spreadsheet, {}, 401);

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'getDeferredBootstrapData',
        accessToken: 'secret-token',
        bootId: 'BOOT-20260906-defer2'
      })
    }
  });
  const result = JSON.parse(output.text);

  assert.deepEqual(result, {
    success: false,
    code: 'LINE_PROFILE_401',
    message: 'LINE_PROFILE_401',
    bootId: 'BOOT-20260906-defer2',
    observability: {
      timing: {
        status: 'error',
        metrics: { DEFERRED_UI_TOTAL_MS: result.observability.timing.metrics.DEFERRED_UI_TOTAL_MS }
      }
    }
  });
  assert.equal(spreadsheet.sheets.Likes.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Announcements.dataRangeReads, 0);
  assert.doesNotMatch(JSON.stringify(result), /secret-token|Authorization|stack/i);
  assert.doesNotMatch(gas.__logs.join('\n'), /secret-token|Authorization/i);
  assert.doesNotMatch(gas.__logs.join('\n'), /metric":"(?:LIKES_MS|ANNOUNCEMENTS_MS)/);
});

test('unregistered bootstrap preserves identity response and skips non-critical sheets', () => {
  const spreadsheet = bootstrapSpreadsheet();
  const gas = loadGas(spreadsheet, {
    userId: 'unknown-id',
    displayName: 'LINE Profile Name'
  });

  const result = gas.getBootstrapData('access-token', '', 'BOOT-20260906-unreg1');

  const { observability, ...identityResponse } = result;
  assert.deepEqual(JSON.parse(JSON.stringify(identityResponse)), {
    success: true,
    registered: false,
    lineUserId: 'unknown-id',
    displayName: 'LINE Profile Name',
    bootId: 'BOOT-20260906-unreg1'
  });
  assert.equal(observability.timing.status, 'success');
  assert.deepEqual(Object.keys(observability.timing.metrics).sort(), [
    'BOOTSTRAP_TOTAL_MS',
    'LINE_PROFILE_MS',
    'USER_LOOKUP_MS'
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(observability.timing.metrics, 'SETTINGS_MS'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(observability.timing.metrics, 'ORDERS_MS'), false);
  assert.equal(spreadsheet.sheets.Users.dataRangeReads, 1);
  assert.equal(spreadsheet.sheets.Settings.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Likes.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Announcements.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Orders.dataRangeReads, 0);
});

test('invalid bootstrap token returns the existing LINE error without reading Sheets', () => {
  const spreadsheet = bootstrapSpreadsheet();
  const gas = loadGas(spreadsheet, {}, 401);

  const output = gas.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'getBootstrapData',
        accessToken: 'secret-token',
        bootId: 'BOOT-20260906-error1'
      })
    }
  });
  const result = JSON.parse(output.text);

  const { observability, ...errorResponse } = result;
  assert.deepEqual(errorResponse, {
    success: false,
    code: 'LINE_PROFILE_401',
    message: 'LINE_PROFILE_401',
    bootId: 'BOOT-20260906-error1'
  });
  assert.equal(observability.timing.status, 'error');
  assert.deepEqual(Object.keys(observability.timing.metrics).sort(), [
    'BOOTSTRAP_TOTAL_MS',
    'LINE_PROFILE_MS'
  ]);
  assert.doesNotMatch(JSON.stringify(observability), /secret-token|Authorization|stack|message/i);
  const perfLines = gas.__logs.filter(line => line.includes('[PERF][BOOT][BOOT-20260906-error1] backend'));
  assert.ok(perfLines.every(line => line.includes('"status":"error"')));
  assert.doesNotMatch(perfLines.join('\n'), /secret-token|Authorization/i);
  assert.equal(spreadsheet.sheets.Users.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Settings.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Likes.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Announcements.dataRangeReads, 0);
  assert.equal(spreadsheet.sheets.Orders.dataRangeReads, 0);
});

test('frontend bootstrap owns initial state and only uses legacy startup on INVALID_ACTION', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const initStart = appSource.indexOf('const initLiffAndFetchData');
  const initEnd = appSource.indexOf('  useEffect(() => {', initStart);
  const initSource = appSource.slice(initStart, initEnd);
  const bootstrapBranchStart = initSource.indexOf('} else {', initSource.indexOf('if (usingLegacyStartup) {'));
  const bootstrapBranch = initSource.slice(bootstrapBranchStart);

  assert.match(initSource, /fetchBootstrapData\(accessToken, bootId\)/);
  assert.match(initSource, /identity\?\.code === 'INVALID_ACTION'/);
  assert.match(initSource, /identity = await fetchUserInfo\(accessToken\)/);
  assert.match(bootstrapBranch, /setCalendarEvents\(identity\.calendar\?\.events/);
  assert.match(bootstrapBranch, /setUserOrdersMap\(identity\.ordersMap/);
  assert.doesNotMatch(bootstrapBranch, /fetchUserAllOrders|fetchCalendarEvents/);
});

test('frontend boot timing logger emits only the Phase 3 allowlist', async () => {
  const { createBootTimingLogger } = await import(pathToFileURL(
    path.join(__dirname, '..', 'src', 'observability', 'bootTiming.js')
  ).href);
  const lines = [];
  const timing = createBootTimingLogger('BOOT-20260906-abc123', {
    info(message) {
      lines.push(message);
    }
  });

  timing.milestone('BOOT_START');
  timing.metric('LIFF_INIT_MS', 12.345, 'success', false);
  timing.milestone('NOT_ALLOWED');
  timing.metric('SECRET_MS', 99, 'success', false);

  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\[PERF\]\[BOOT\]\[BOOT-20260906-abc123\] frontend /);
  assert.deepEqual(JSON.parse(lines[0].split(' frontend ')[1]), { milestone: 'BOOT_START' });
  assert.deepEqual(JSON.parse(lines[1].split(' frontend ')[1]), {
    status: 'success',
    fallback: false,
    metric: 'LIFF_INIT_MS',
    durationMs: 12.3
  });

  timing.backend({
    status: 'success',
    metrics: {
      BOOTSTRAP_TOTAL_MS: 40.45,
      LINE_PROFILE_MS: 12,
      SECRET_MS: 99,
      USER_LOOKUP_MS: 'not-a-duration'
    }
  }, 'BOOT-20260906-abc123');
  timing.backend({
    status: 'success',
    metrics: { SETTINGS_MS: 0 }
  }, 'BOOT-20260906-other1');
  timing.deferredBackend({
    status: 'success',
    metrics: {
      DEFERRED_UI_TOTAL_MS: 88.8,
      LIKES_MS: 20,
      ANNOUNCEMENTS_MS: 30,
      BOOTSTRAP_TOTAL_MS: 999
    }
  }, 'BOOT-20260906-abc123');

  assert.equal(lines.length, 7);
  assert.match(lines[2], /^\[PERF\]\[BOOT\]\[BOOT-20260906-abc123\] backend /);
  assert.deepEqual(JSON.parse(lines[2].split(' backend ')[1]), {
    status: 'success',
    metric: 'BOOTSTRAP_TOTAL_MS',
    durationMs: 40.5
  });
  assert.deepEqual(JSON.parse(lines[3].split(' backend ')[1]), {
    status: 'success',
    metric: 'LINE_PROFILE_MS',
    durationMs: 12
  });
  assert.match(lines[4], /^\[PERF\]\[BOOT\]\[BOOT-20260906-abc123\] deferred-backend /);
  assert.deepEqual(JSON.parse(lines[4].split(' deferred-backend ')[1]), {
    status: 'success',
    metric: 'DEFERRED_UI_TOTAL_MS',
    durationMs: 88.8
  });
  assert.match(lines[5], /"metric":"LIKES_MS"/);
  assert.match(lines[6], /"metric":"ANNOUNCEMENTS_MS"/);
  assert.doesNotMatch(lines.join('\n'), /accessToken|Authorization|userId|displayName|response|Error|stack/i);
});

test('frontend bootstrap wires the correlated Phase 3 waterfall without extra requests', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const initStart = appSource.indexOf('const initLiffAndFetchData');
  const initEnd = appSource.indexOf('  useEffect(() => {', initStart);
  const initSource = appSource.slice(initStart, initEnd);

  assert.match(appSource, /createBootId/);
  assert.match(appSource, /createBootTimingLogger/);
  assert.match(appSource, /if \(!import\.meta\.env\.DEV\) return;/);
  for (const milestone of [
    'BOOT_START',
    'LIFF_INIT_START',
    'LIFF_INIT_END',
    'BOOTSTRAP_REQUEST_START',
    'BOOTSTRAP_REQUEST_END',
    'BOOTSTRAP_STATE_READY',
    'BOOT_READY'
  ]) {
    assert.match(appSource, new RegExp(milestone));
  }
  for (const metric of ['LIFF_INIT_MS', 'BOOTSTRAP_NETWORK_MS', 'STATE_APPLY_MS', 'BOOT_TOTAL_MS']) {
    assert.match(appSource, new RegExp(metric));
  }
  assert.match(initSource, /const bootId = createBootId\(\)/);
  assert.match(initSource, /createBootTimingLogger\(bootId\)/);
  assert.match(initSource, /bootTiming\.backend\(identity\?\.observability\?\.timing, identity\?\.bootId\)/);
  assert.match(appSource, /apiClient\.getBootstrap\(\{ bootId \}\)/);
  assert.match(appSource, /apiClient\.getDeferredBootstrap\(\{ bootId \}\)/);
  assert.match(appSource, /\.timing\.deferredBackend/);
  assert.match(appSource, /deferredUiGenerationRef/);
  assert.match(appSource, /deferredUiBootRef/);
  assert.match(appSource, /likesLoaded/);
  assert.match(appSource, /announcementsLoaded/);
  assert.match(appSource, /useEffect\(\(\) => \{[\s\S]*BOOTSTRAP_STATE_READY[\s\S]*BOOT_READY/);
  const normalBranchStart = initSource.indexOf('} else {', initSource.indexOf('if (usingLegacyStartup) {'));
  const normalBranch = initSource.slice(normalBranchStart);
  assert.doesNotMatch(normalBranch, /fetchUserAllOrders|fetchCalendarEvents/);

  const bootstrapFetchStart = appSource.indexOf('const fetchBootstrapData');
  const bootstrapFetchEnd = appSource.indexOf('  const handleRegister', bootstrapFetchStart);
  const bootstrapFetchSource = appSource.slice(bootstrapFetchStart, bootstrapFetchEnd);
  assert.equal((bootstrapFetchSource.match(/apiClient\.getBootstrap\(/g) || []).length, 1);
  assert.match(bootstrapFetchSource, /apiClient\.getBootstrap\(\{ bootId \}\)/);

  const deferredFetchStart = appSource.indexOf('const fetchDeferredBootstrapData');
  const deferredFetchEnd = appSource.indexOf('const showPopup', deferredFetchStart);
  const deferredFetchSource = appSource.slice(deferredFetchStart, deferredFetchEnd);
  assert.equal((deferredFetchSource.match(/apiClient\.getDeferredBootstrap\(/g) || []).length, 1);
  assert.match(deferredFetchSource, /apiClient\.getDeferredBootstrap\(\{ bootId \}\)/);
});

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
  const warningLogs = gas.__logs.filter(line => line.includes('[ANNOUNCEMENT]'));
  assert.equal(warningLogs.length, 2);
  assert.match(warningLogs[0], /malformed row 2/);
  assert.match(warningLogs[1], /malformed row 3/);
});

test('missing Announcements sheet returns null and keeps calendar initialization successful', () => {
  const gas = loadGas(orderSpreadsheet());

  const result = gas.getCalendarEvents('admin-id');

  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.announcements)), []);
  assert.equal(result.announcement, null);
  assert.ok(result.events['2026-09-10']);
  assert.match(gas.__logs[0], /Announcements sheet not found/);
  assert.equal(gas.__activeSpreadsheetCalls(), 2);
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
  assert.match(appSource, /<AnnouncementBar[\s\S]*announcement=\{announcements\[0\]\}/);
  assert.match(appSource, /<AnnouncementModal[\s\S]*announcements=\{announcements\}[\s\S]*loading=\{!announcementsLoaded\}/);
  assert.match(barSource, /truncate/);
  assert.match(barSource, /onClick/);
  assert.match(modalSource, /announcements\.map/);
  assert.match(modalSource, /announcement\.title/);
  assert.match(modalSource, /announcement\.start_date/);
  assert.match(modalSource, /公告日期/);
  assert.match(modalSource, /formatAnnouncementDate/);
  assert.match(modalSource, /announcement\.content/);
  assert.ok(modalSource.indexOf('announcement.title') < modalSource.indexOf('announcement.start_date'));
  assert.ok(modalSource.indexOf('announcement.start_date') < modalSource.indexOf('announcement.content'));
  assert.doesNotMatch(modalSource, /announcement\.end_date/);
  assert.match(gasCalendarSource, /announcements: announcements/);
  assert.match(gasCalendarSource, /Transitional compatibility/);
  assert.match(calendarSource, /w-full min-w-0 bg-white/);
  assert.match(calendarSource, /grid grid-cols-5/);
  assert.match(appSource, /w-full max-w-xl min-w-0 mx-auto flex-1 p-4/);
  assert.doesNotMatch(appSource, /bg-amber-50 border-amber-200 text-amber-900/);
  assert.doesNotMatch(appSource, /bg-amber-100 text-amber-800/);
  assert.match(appSource, /bg-slate-300 border border-slate-400 text-slate-700/);
  assert.match(appSource, /bg-slate-500 text-white/);
  const footerBlock = appSource.match(/<footer[\s\S]*?<\/footer>/)?.[0];
  assert.ok(footerBlock);
  assert.match(footerBlock, /© 2026 Henry · 蔬食便當預訂系統/);
  assert.match(footerBlock, /v\{APP_VERSION\}/);
  assert.match(footerBlock, /setShowChangelogModal\(true\)/);
  assert.match(footerBlock, /text-center text-xs text-gray-400/);
  assert.doesNotMatch(footerBlock, /fixed|sticky/);
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
  assert.equal(gas.hasPermission('User', 'manageCalendar'), false);
  assert.equal(gas.hasPermission('User', 'viewMemberBalances'), false);
  assert.equal(gas.hasPermission('User', 'topupMember'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewAdminOrderSummary'), true);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewAllOrders'), true);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewOrderStatistics'), true);
  assert.equal(gas.hasPermission('ProxyAdmin', 'manageCalendar'), true);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewMemberBalances'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'topupMember'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'manageUsers'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'manageRoles'), false);
  assert.equal(gas.hasPermission('ProxyAdmin', 'viewAsUser'), false);
  assert.equal(gas.hasPermission('Admin', 'viewAsUser'), true);
  assert.equal(gas.hasPermission('Admin', 'manageCalendar'), true);
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
  assert.match(appSource, /apiClient\.getMemberBalances/);
  assert.match(appSource, /apiClient\.getAdminSummary/);
  assert.match(appSource, /adminUserId: authUserId,[\s\S]*targetUserId: selectedTopupUser\.userId/);
  assert.match(appSource, /topupIdempotencyKey/);
  assert.match(appSource, /idempotencyKey: requestKey/);
  assert.match(appSource, /const workerTopUp = apiClient\.transport === ['"]worker['"]/);
  assert.match(appSource, /Number\.isSafeInteger\(amount\)/);
  assert.match(appSource, /Number\.isFinite\(amount\)/);
  assert.match(appSource, /min=\{apiClient\.transport === ['"]worker['"] \? ['"]1['"] : ['"]0\.01['"]\}/);
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
  const confirmationSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'features', 'orders', 'OrderConfirmationModal.jsx'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));

  assert.equal(packageJson.version, '0.9.0');
  assert.equal(packageLock.version, '0.9.0');
  assert.equal(packageLock.packages[''].version, '0.9.0');
  assert.match(changelogSource, /from ['"]\.\.\/\.\.\/package\.json['"]/);
  assert.match(changelogSource, /version: '0\.1\.0'/);
  assert.match(changelogSource, /version: '0\.8\.0'/);
  assert.match(changelogSource, /version: '0\.9\.0'/);
  assert.match(changelogSource, /version: '0\.7\.0'/);
  assert.match(changelogSource, /3305217/);
  assert.match(changelogSource, /de5f152/);
  assert.match(changelogSource, /後端由 Google Apps Script 遷移至 Cloudflare Workers/);
  assert.match(changelogSource, /送出訂單前新增訂單內容確認流程/);
  assert.match(changelogSource, /ProxyAdmin 新增開團設定權限/);
  assert.match(changelogSource, /月曆管理更名為開團/);
  assert.match(changelogSource, /2641c6d/);
  assert.match(changelogSource, /7fc7bee/);
  assert.match(changelogSource, /03f54c4/);
  assert.match(changelogSource, /修正月份起始於週末時的月曆空白列/);
  assert.match(changelogSource, /優化頁尾資訊與作者標示/);
  assert.match(changelogSource, /公告詳情新增公告日期/);
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
  assert.match(appSource, /apiClient\.updatePickupFloor/);
  assert.match(appSource, /showFloorModal/);
  assert.match(appSource, /showChangelogModal/);
  assert.match(appSource, /imagePreview/);
  assert.match(appSource, /OrderConfirmationModal/);
  assert.match(appSource, /buildOrderSubmission/);
  assert.match(appSource, /aria-label="功能操作"/);
  assert.match(appSource, /💰 餘額/);
  assert.match(appSource, /📅 開團/);
  assert.match(appSource, /送出訂單/);
  assert.doesNotMatch(appSource, /月曆管理/);
  assert.match(orderSource, /onImagePreview/);
  assert.match(orderSource, /w-20 h-20 sm:w-24 sm:h-24/);
  assert.match(orderSource, /aria-label/);
  assert.match(permissionsSource, /ProxyAdmin:[\s\S]*?viewMemberBalances: false[\s\S]*?topupMember: false/);
  assert.match(permissionsSource, /Admin:[\s\S]*?viewMemberBalances: true[\s\S]*?topupMember: true/);
  assert.match(permissionsSource, /ProxyAdmin:[\s\S]*?manageCalendar: true/);

  const submitHandler = appSource.match(/const handleSubmit = async \(\) => \{[\s\S]*?\n  \};/);
  const confirmHandler = appSource.match(/const handleConfirmSubmit = async \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(submitHandler);
  assert.ok(confirmHandler);
  assert.match(submitHandler[0], /setShowOrderConfirmation\(true\)/);
  assert.doesNotMatch(submitHandler[0], /submitOrder/);
  assert.match(confirmHandler[0], /apiClient\.submitOrder/);
  assert.match(confirmHandler[0], /idempotencyKey: requestKey/);
  assert.match(confirmHandler[0], /setShowOrderConfirmation\(false\)/);
  assert.match(appSource, /onConfirm=\{handleConfirmSubmit\}/);

  assert.match(confirmationSource, /訂餐日期/);
  assert.match(confirmationSource, /領取樓層/);
  assert.match(confirmationSource, /submission\.items\.map/);
  assert.match(confirmationSource, /item\.quantity/);
  assert.match(confirmationSource, /item\.unit_price \* item\.quantity/);
  assert.match(confirmationSource, /submission\.totalCount/);
  assert.match(confirmationSource, /submission\.totalAmount/);
  assert.match(confirmationSource, /無備註/);
  assert.match(confirmationSource, /確認下單/);
  assert.match(confirmationSource, /disabled=\{loading\}/);
});

test('order submission builder produces the shared confirmation and mutation payload', async () => {
  const { buildOrderSubmission } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'features', 'orders', 'orderSubmission.js')).href);
  const input = {
    menu: [
      { item_id: 'A01', menu_item_id: 'menu-A01', item_name: '小而美', price: 80 },
      { item_id: 'A02', menu_item_id: 'menu-A02', item_name: '田園便當', price: 100 }
    ],
    orderItems: { A01: 2, A02: 1, EMPTY: 0 },
    selectedDate: '2026-09-10',
    floor: '9樓',
    note: '少辣  '
  };

  const workerSubmission = buildOrderSubmission({ ...input, workerOrderMutation: true });
  assert.deepEqual(workerSubmission, {
    targetDate: '2026-09-10',
    pickupFloor: '9樓',
    items: [
      { item_id: 'A01', menu_item_id: 'menu-A01', item_name: '小而美', quantity: 2, unit_price: 80 },
      { item_id: 'A02', menu_item_id: 'menu-A02', item_name: '田園便當', quantity: 1, unit_price: 100 }
    ],
    note: '少辣  ',
    totalCount: 3,
    totalAmount: 260
  });

  const gasSubmission = buildOrderSubmission({ ...input, workerOrderMutation: false });
  assert.equal(Object.hasOwn(gasSubmission.items[0], 'menu_item_id'), false);
  assert.equal(gasSubmission.totalCount, workerSubmission.totalCount);
  assert.equal(gasSubmission.totalAmount, workerSubmission.totalAmount);
});

test('month navigation crosses calendar year boundaries', async () => {
  const utils = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'dateUtils.js')).href);

  assert.deepEqual(utils.shiftYearMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(utils.shiftYearMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(utils.getTaipeiYearMonth(new Date('2026-09-30T16:30:00Z')), { year: 2026, month: 10 });
  assert.equal(utils.formatDateInput(new Date('2026-09-30T16:30:00Z')), '2026-10-01');
});

test('weekday-only calendar offset skips leading weekend dates', async () => {
  const utils = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'dateUtils.js')).href);

  assert.equal(utils.getWeekdayLeadingBlankCount(2026, 5), 0); // Monday: June 1
  assert.equal(utils.getWeekdayLeadingBlankCount(2026, 8), 1); // Tuesday: September 1
  assert.equal(utils.getWeekdayLeadingBlankCount(2026, 4), 4); // Friday: May 1
  assert.equal(utils.getWeekdayLeadingBlankCount(2026, 7), 0); // Saturday: August 1
  assert.equal(utils.getWeekdayLeadingBlankCount(2026, 10), 0); // Sunday: November 1
});

test('calendar management owns special-date controls without a separate modal entry', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');

  assert.doesNotMatch(appSource, /showSpecialAdminModal/);
  assert.doesNotMatch(appSource, /特殊日期開團/);
  assert.match(appSource, /specialAdminDate/);
});

test('frontend wires monthly balance and selected-date admin summary queries', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');

  assert.match(appSource, /apiClient\.getBalanceHistory/);
  assert.match(appSource, /selectedYear/);
  assert.match(appSource, /selectedOrderDate/);
  assert.match(appSource, /adminSummaryRequestRef\.current \+= 1/);
  assert.match(appSource, /historyRequestRef\.current \+= 1/);
  assert.match(appSource, /data\.openingBalancePolicyRequired/);
  assert.match(appSource, /error\?\.code === ['"]OPENING_BALANCE_POLICY_REQUIRED['"]/);
  assert.match(appSource, /openingBalance: data\.openingBalance \?\? 0/);
});

test('auth mode defaults to LIFF and production cannot enable mock mode', async () => {
  const { resolveAuthConfig } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'auth', 'authMode.js')).href);

  assert.equal(resolveAuthConfig({ DEV: true }).mode, 'liff');
  assert.equal(resolveAuthConfig({ DEV: true, VITE_AUTH_MODE: 'mock' }).mode, 'mock');
  assert.equal(resolveAuthConfig({ DEV: false, VITE_AUTH_MODE: 'mock' }).mode, 'liff');
});

test('DEV mock auth never calls LIFF lifecycle or access-token methods', async () => {
  const { createAuthClient } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'auth', 'authClient.js')).href);
  const calls = [];
  const liffClient = {
    init: () => calls.push('init'),
    isLoggedIn: () => calls.push('isLoggedIn'),
    isInClient: () => calls.push('isInClient'),
    login: () => calls.push('login'),
    getAccessToken: () => calls.push('getAccessToken')
  };
  const client = createAuthClient({
    env: { DEV: true, VITE_AUTH_MODE: 'mock', VITE_MOCK_USER: 'admin' },
    liffClient,
    logger: { info() {} }
  });

  await client.init();
  assert.equal(client.isLoggedIn(), true);
  assert.equal(client.isInClient(), false);
  assert.equal(client.getAccessToken(), 'local-mock-session');
  assert.deepEqual(calls, []);
});

test('frontend keeps LIFF and GAS transport behind the auth and API boundaries', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const mockApiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'mockGasApi.js'), 'utf8');
  const gasApiSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'gasApi.js'), 'utf8');
  const apiClientSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'apiClient.js'), 'utf8');

  assert.doesNotMatch(appSource, /@line\/liff|\bliff\./);
  assert.doesNotMatch(appSource, /\bgas(Get|Post)\s*\(/);
  assert.doesNotMatch(appSource, /action\s*:/);
  assert.match(appSource, /authClient\.getAccessToken/);
  assert.doesNotMatch(mockApiSource, /\bfetch\s*\(/);
  assert.match(gasApiSource, /auth = authClient/);
  assert.match(apiClientSource, /resolveApiTransportConfig/);
  assert.match(appSource, /from ['"]\.\/api\/apiClient['"]/);
});

test('API transport boundary isolates Worker, GAS, and mock modes with typed gaps', async () => {
  const { createApiClient } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'apiClientCore.js')).href);
  const {
    ApiAuthenticationError,
    ApiAuthorizationError,
    ApiBackendError,
    ApiConfigurationError
  } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'apiErrors.js')).href);
  const { resolveApiTransportConfig } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'transportConfig.js')).href);

  const jsonResponse = (body = {}, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
  const authClient = {
    isMock: false,
    getAccessToken: () => 'line-token'
  };
  const workerCalls = [];
  const gasCalls = [];
  const gasApi = {
    get: async (query) => {
      gasCalls.push({ method: 'GET', query });
      return jsonResponse({ success: true });
    },
    post: async (payload) => {
      gasCalls.push({ method: 'POST', payload });
      return jsonResponse({ success: true });
    }
  };
  const worker = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test/'
    },
    authClient,
    gasApi,
    fetchImpl: async (url, options) => {
      workerCalls.push({ url, options });
      const pathname = new URL(url).pathname;
      if (pathname === '/api/admin/members/balances') {
        return jsonResponse({
          success: true,
          requesterRole: 'Admin',
          members: [{ userId: 'member-1', name: 'Member', floor: '1樓', balance: -10, role: 'User' }]
        });
      }
      if (pathname === '/api/me/balance/history') {
        const month = new URL(url).searchParams.get('month');
        if (month === '2026-10') {
          return jsonResponse({
            success: true,
            ok: true,
            month,
            year: 2026,
            monthNumber: 10,
            openingBalance: 0,
            totalCredit: 0,
            totalDebit: 0,
            closingBalance: 0,
            transactions: [],
            openingBalancePolicyRequired: false
          });
        }
        return jsonResponse({
          success: true,
          ok: true,
          month,
          year: 2026,
          monthNumber: 9,
          openingBalance: -120,
          totalCredit: 10,
          totalDebit: 25,
          closingBalance: -135,
          transactions: [{
            id: 'history-txn-1',
            transactionId: 'history-txn-1',
            type: 'ORDER',
            referenceId: 'history-order-1',
            description: 'history order',
            note: '',
            occurredAt: '2026-09-10T00:00:00.000Z',
            timestamp: '2026-09-10T00:00',
            businessDate: '2026-09-10',
            amount: -25,
            changeAmount: -25,
            balanceAfter: -135,
            balance: -135
          }],
          openingBalancePolicyRequired: false
        });
      }
      if (pathname === '/api/admin/calendar/2026-09-10') {
        return jsonResponse({
          success: true,
          setting: { order_date: '2026-09-10', vendor: '禾拾', mode: 'B' }
        });
      }
      if (pathname === '/api/admin/balances/top-up') {
        return jsonResponse({
          success: true,
          message: 'BALANCE_TOPPED_UP',
          targetUserId: 'member-1',
          transactionId: 'txn-test',
          newBalance: 15
        });
      }
      if (pathname === '/api/admin/summary') {
        return jsonResponse({
          success: true,
          requesterRole: 'Admin',
          targetDate: new URL(url).searchParams.get('date'),
          usersSummary: [],
          todayOrders: [],
          totalItems: 0,
          totalAmount: 0,
          items: [],
          pickupSummary: {}
        });
      }
      return jsonResponse({ success: true });
    }
  });

  assert.equal(worker.transport, 'worker');
  await worker.getIdentity();
  await worker.getBootstrap({ bootId: 'BOOT-20260908-test01', targetDate: '2026-09-08' });
  await worker.getDeferredBootstrap({ bootId: 'BOOT-20260908-test01' });
  await worker.register({ pickupFloor: '1樓' });
  await worker.getCalendar({ userId: 'forged-user' });
  await worker.getOrdersMap({ userId: 'forged-user' });
  await worker.getOrderPage({ targetDate: '2026-09-08', userId: 'forged-user' });
  await worker.updatePickupFloor({ pickupFloor: '9樓' });
  const balanceHistoryResponse = await worker.getBalanceHistory({ year: 2026, month: 9 });
  const emptyBalanceHistoryResponse = await worker.getBalanceHistory({ year: '2026', month: '10' });
  const memberBalancesResponse = await worker.getMemberBalances();
  const calendarSettingResponse = await worker.setCalendarVendor({
    adminUserId: 'forged-admin',
    dateStr: '2026-09-10',
    vendor: '禾拾'
  });
  const topUpResponse = await worker.topUpBalance({
    adminUserId: 'forged-admin',
    targetUserId: 'member-1',
    amount: 25,
    note: 'cash',
    idempotencyKey: 'top-up-1'
  });
  const adminSummaryResponse = await worker.getAdminSummary({
    targetDate: '2026-09-10',
    includeMemberBalances: false
  });
  const viewAsSummaryResponse = await worker.getAdminSummary({
    targetDate: '2026-09-10',
    includeMemberBalances: false,
    viewAsUserId: 'proxy-1'
  });

  assert.deepEqual(await memberBalancesResponse.json(), {
    success: true,
    requesterRole: 'Admin',
    members: [{ userId: 'member-1', name: 'Member', floor: '1樓', balance: -10, role: 'User' }]
  });
  assert.deepEqual(await calendarSettingResponse.json(), {
    success: true,
    setting: { order_date: '2026-09-10', vendor: '禾拾', mode: 'B' }
  });
  assert.deepEqual(await topUpResponse.json(), {
    success: true,
    message: 'BALANCE_TOPPED_UP',
    targetUserId: 'member-1',
    transactionId: 'txn-test',
    newBalance: 15
  });
  assert.deepEqual(await balanceHistoryResponse.json(), {
    success: true,
    ok: true,
    month: '2026-09',
    year: 2026,
    monthNumber: 9,
    openingBalance: -120,
    totalCredit: 10,
    totalDebit: 25,
    closingBalance: -135,
    transactions: [{
      id: 'history-txn-1',
      transactionId: 'history-txn-1',
      type: 'ORDER',
      referenceId: 'history-order-1',
      description: 'history order',
      note: '',
      occurredAt: '2026-09-10T00:00:00.000Z',
      timestamp: '2026-09-10T00:00',
      businessDate: '2026-09-10',
      amount: -25,
      changeAmount: -25,
      balanceAfter: -135,
      balance: -135
    }],
    openingBalancePolicyRequired: false
  });
  assert.deepEqual(await emptyBalanceHistoryResponse.json(), {
    success: true,
    ok: true,
    month: '2026-10',
    year: 2026,
    monthNumber: 10,
    openingBalance: 0,
    totalCredit: 0,
    totalDebit: 0,
    closingBalance: 0,
    transactions: [],
    openingBalancePolicyRequired: false
  });
  assert.deepEqual(await adminSummaryResponse.json(), {
    success: true,
    requesterRole: 'Admin',
    targetDate: '2026-09-10',
    usersSummary: [],
    todayOrders: [],
    totalItems: 0,
    totalAmount: 0,
    items: [],
    pickupSummary: {}
  });
  assert.deepEqual(await viewAsSummaryResponse.json(), {
    success: true,
    requesterRole: 'Admin',
    targetDate: '2026-09-10',
    usersSummary: [],
    todayOrders: [],
    totalItems: 0,
    totalAmount: 0,
    items: [],
    pickupSummary: {}
  });

  assert.deepEqual(workerCalls.map(({ url, options }) => [
    new URL(url).pathname,
    options.method,
    options.headers.Authorization,
    options.body || null
  ]), [
    ['/api/me', 'GET', 'Bearer line-token', null],
    ['/api/me', 'GET', 'Bearer line-token', null],
    ['/api/bootstrap', 'GET', 'Bearer line-token', null],
    ['/api/bootstrap/deferred', 'GET', 'Bearer line-token', null],
    ['/api/register', 'POST', 'Bearer line-token', JSON.stringify({ pickupFloor: '1樓' })],
    ['/api/calendar', 'GET', 'Bearer line-token', null],
    ['/api/orders/map', 'GET', 'Bearer line-token', null],
    ['/api/order-page', 'GET', 'Bearer line-token', null],
    ['/api/me/pickup-floor', 'PATCH', 'Bearer line-token', JSON.stringify({ pickupFloor: '9樓' })],
    ['/api/me/balance/history', 'GET', 'Bearer line-token', null],
    ['/api/me/balance/history', 'GET', 'Bearer line-token', null],
    ['/api/admin/members/balances', 'GET', 'Bearer line-token', null],
    ['/api/admin/calendar/2026-09-10', 'PUT', 'Bearer line-token', JSON.stringify({ vendor: '禾拾', mode: 'B' })],
    ['/api/admin/balances/top-up', 'POST', 'Bearer line-token', JSON.stringify({ targetUserId: 'member-1', amount: 25, note: 'cash' })],
    ['/api/admin/summary', 'GET', 'Bearer line-token', null],
    ['/api/admin/summary', 'GET', 'Bearer line-token', null]
  ]);
  assert.equal(new URL(workerCalls[2].url).searchParams.get('bootId'), 'BOOT-20260908-test01');
  assert.equal(new URL(workerCalls[3].url).searchParams.get('bootId'), 'BOOT-20260908-test01');
  assert.equal(new URL(workerCalls[5].url).searchParams.get('userId'), null);
  assert.equal(new URL(workerCalls[6].url).searchParams.get('userId'), null);
  assert.equal(new URL(workerCalls[3].url).searchParams.get('userId'), null);
  assert.equal(new URL(workerCalls[7].url).searchParams.get('userId'), null);
  assert.equal(new URL(workerCalls[9].url).searchParams.get('month'), '2026-09');
  assert.equal(new URL(workerCalls[10].url).searchParams.get('month'), '2026-10');
  assert.equal(new URL(workerCalls[9].url).searchParams.get('userId'), null);
  assert.equal(new URL(workerCalls[10].url).searchParams.get('userId'), null);
  assert.equal(workerCalls[4].options.headers['Content-Type'], 'application/json');
  assert.equal(workerCalls[8].options.headers['Content-Type'], 'application/json');
  assert.equal(workerCalls[12].options.headers['Content-Type'], 'application/json');
  assert.equal(workerCalls[13].options.headers['Content-Type'], 'application/json');
  assert.equal(workerCalls[13].options.headers['Idempotency-Key'], 'top-up-1');
  const normalSummaryUrl = new URL(workerCalls[14].url);
  const viewAsSummaryUrl = new URL(workerCalls[15].url);
  assert.equal(normalSummaryUrl.searchParams.get('date'), '2026-09-10');
  assert.equal(normalSummaryUrl.searchParams.get('includeMemberBalances'), 'false');
  assert.equal(normalSummaryUrl.searchParams.get('viewAs'), null);
  assert.equal(viewAsSummaryUrl.searchParams.get('date'), '2026-09-10');
  assert.equal(viewAsSummaryUrl.searchParams.get('includeMemberBalances'), 'false');
  assert.equal(viewAsSummaryUrl.searchParams.get('viewAs'), 'proxy-1');
  assert.equal(gasCalls.length, 0);

  const unregisteredCalls = [];
  const unregisteredWorker = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test'
    },
    authClient,
    gasApi,
    fetchImpl: async (url, options) => {
      unregisteredCalls.push({ url, options });
      return new URL(url).pathname === '/api/me'
        ? jsonResponse({
          success: true,
          registered: false,
          lineUserId: 'line-unregistered',
          displayName: 'Unregistered User'
        })
        : jsonResponse({ success: true, registered: true });
    }
  });
  const unregisteredResponse = await unregisteredWorker.getBootstrap({
    bootId: 'BOOT-20260908-unregistered'
  });
  assert.deepEqual(await unregisteredResponse.json(), {
    success: true,
    registered: false,
    lineUserId: 'line-unregistered',
    displayName: 'Unregistered User'
  });
  assert.deepEqual(unregisteredCalls.map(({ url }) => new URL(url).pathname), ['/api/me']);
  assert.equal(gasCalls.length, 0);

  assert.equal(workerCalls.length, 16);
  assert.equal(gasCalls.length, 0);

  const gas = createApiClient({
    env: { VITE_GAS_API_URL: 'https://gas.example.test/exec' },
    authClient,
    gasApi,
    fetchImpl: () => {
      throw new Error('Worker fetch must not be used in GAS mode.');
    }
  });
  assert.equal(gas.transport, 'gas');
  await gas.getIdentity();
  await gas.getBootstrap({ bootId: 'BOOT-20260908-test02' });
  await gas.getCalendar({ userId: 'user-id' });
  await gas.getMemberBalances();
  await gas.setCalendarVendor({ adminUserId: 'admin-id', dateStr: '2026-09-10', vendor: '禾拾' });
  await gas.topUpBalance({ adminUserId: 'admin-id', targetUserId: 'member-id', amount: 25, note: 'cash' });
  await gas.getAdminSummary({
    targetDate: '2026-09-10',
    includeMemberBalances: false,
    viewAsUserId: 'viewed-user'
  });
  await gas.getBalanceHistory({ year: 2026, month: 9 });
  assert.deepEqual(gasCalls.slice(0, 2), [
    { method: 'POST', payload: { action: 'getUserInfo', accessToken: 'line-token' } },
    {
      method: 'POST',
      payload: {
        action: 'getBootstrapData',
        accessToken: 'line-token',
        bootId: 'BOOT-20260908-test02',
        deferUiData: true
      }
    }
  ]);
  assert.match(gasCalls[2].query, /^\?action=getCalendarEvents&userId=user-id&t=\d+$/);
  assert.deepEqual(gasCalls[3], {
    method: 'POST',
    payload: { action: 'getMemberBalances', accessToken: 'line-token' }
  });
  assert.deepEqual(gasCalls[4], {
    method: 'POST',
    payload: {
      action: 'adminSetVendor',
      accessToken: 'line-token',
      adminUserId: 'admin-id',
      dateStr: '2026-09-10',
      vendor: '禾拾'
    }
  });
  assert.deepEqual(gasCalls[5], {
    method: 'POST',
    payload: {
      action: 'topUpBalance',
      accessToken: 'line-token',
      adminUserId: 'admin-id',
      targetUserId: 'member-id',
      amount: 25,
      note: 'cash'
    }
  });
  assert.deepEqual(gasCalls[6], {
    method: 'POST',
    payload: {
      action: 'getAdminSummary',
      accessToken: 'line-token',
      targetDate: '2026-09-10',
      includeMemberBalances: false
    }
  });
  assert.deepEqual(gasCalls[7], {
    method: 'POST',
    payload: {
      action: 'getBalanceHistoryByMonth',
      accessToken: 'line-token',
      year: 2026,
      month: 9
    }
  });
  assert.equal(workerCalls.length, 16);

  const mockCalls = [];
  const mock = createApiClient({
    env: { DEV: true, VITE_AUTH_MODE: 'mock' },
    authClient: {
      isMock: true,
      getAccessToken: () => 'local-mock-session'
    },
    gasApi: {
      get: async (query) => {
        mockCalls.push({ method: 'GET', query });
        return jsonResponse({ success: true });
      },
      post: async (payload) => {
        mockCalls.push({ method: 'POST', payload });
        return jsonResponse({ success: true });
      }
    },
    fetchImpl: () => {
      throw new Error('Mock transport must not use network fetch.');
    }
  });
  assert.equal(mock.transport, 'mock');
  await mock.getIdentity();
  assert.equal(mockCalls[0].payload.action, 'getUserInfo');

  assert.throws(
    () => resolveApiTransportConfig({ VITE_API_TRANSPORT: 'invalid' }),
    (error) => error instanceof ApiConfigurationError && error.code === 'API_TRANSPORT_INVALID'
  );
  assert.throws(
    () => resolveApiTransportConfig({
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'ftp://worker.example.test'
    }),
    (error) => error instanceof ApiConfigurationError && error.code === 'WORKER_API_URL_INVALID'
  );
  assert.throws(
    () => resolveApiTransportConfig({
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test'
    }, { isMock: true }),
    (error) => error instanceof ApiConfigurationError && error.code === 'API_TRANSPORT_MOCK_CONFLICT'
  );
  assert.throws(
    () => createApiClient({
      env: { VITE_API_TRANSPORT: 'worker' },
      authClient,
      gasApi
    }),
    (error) => error instanceof ApiConfigurationError && error.code === 'WORKER_API_URL_MISSING'
  );
  const noToken = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient: { isMock: false, getAccessToken: () => '' },
    fetchImpl: async () => {
      throw new Error('Authentication must stop before fetch.');
    }
  });
  await assert.rejects(
    noToken.getIdentity(),
    (error) => error instanceof ApiAuthenticationError && error.code === 'API_AUTH_REQUIRED'
  );

  const rejected = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient,
    fetchImpl: async () => jsonResponse({ error: 'AUTH_REQUIRED' }, 401)
  });
  await assert.rejects(
    rejected.getIdentity(),
    (error) => error instanceof ApiAuthenticationError
      && error.code === 'API_AUTH_REJECTED'
      && error.status === 401
  );
  await assert.rejects(
    rejected.getBalanceHistory({ year: 2026, month: 9 }),
    (error) => error instanceof ApiAuthenticationError
      && error.operation === 'getBalanceHistory'
      && error.code === 'API_AUTH_REJECTED'
      && error.status === 401
  );

  const policyBlocked = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient,
    fetchImpl: async () => jsonResponse({ error: 'OPENING_BALANCE_POLICY_REQUIRED' }, 409)
  });
  await assert.rejects(
    policyBlocked.getBalanceHistory({ year: 2026, month: 9 }),
    (error) => error instanceof ApiBackendError
      && error.operation === 'getBalanceHistory'
      && error.kind === 'backend'
      && error.code === 'OPENING_BALANCE_POLICY_REQUIRED'
      && error.status === 409
  );

  const forbidden = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient,
    fetchImpl: async () => jsonResponse({ error: 'VIEW_AS_FORBIDDEN' }, 403)
  });
  await assert.rejects(
    forbidden.getOrdersMap(),
    (error) => error instanceof ApiAuthorizationError
      && error.kind === 'authorization'
      && error.code === 'VIEW_AS_FORBIDDEN'
      && error.status === 403
      && !error.message.includes('line-token')
  );
  for (const [operation, args] of [
    ['getBalanceHistory', { year: 2026, month: 9 }],
    ['getMemberBalances', {}],
    ['getAdminSummary', { targetDate: '2026-09-10', viewAsUserId: 'user-1' }],
    ['setCalendarVendor', { dateStr: '2026-09-10', vendor: '蔡老師' }],
    ['topUpBalance', {
      targetUserId: 'member-1',
      amount: 10,
      note: 'cash',
      idempotencyKey: 'forbidden-top-up'
    }]
  ]) {
    await assert.rejects(
      forbidden[operation](args),
      (error) => error instanceof ApiAuthorizationError
        && error.kind === 'authorization'
        && error.code === 'VIEW_AS_FORBIDDEN'
        && error.status === 403
    );
  }

  const failed = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient,
    fetchImpl: async () => jsonResponse({ error: 'INTERNAL_SERVER_ERROR' }, 500)
  });
  await assert.rejects(
    failed.getIdentity(),
    (error) => error instanceof ApiBackendError
      && error.code === 'INTERNAL_SERVER_ERROR'
      && error.status === 500
  );
  await assert.rejects(
    failed.getBalanceHistory({ year: 2026, month: 9 }),
    (error) => error instanceof ApiBackendError
      && error.operation === 'getBalanceHistory'
      && error.code === 'INTERNAL_SERVER_ERROR'
      && error.status === 500
  );
});

test('Worker order mutation adapters map canonical requests and isolate GAS', async () => {
  const { createApiClient } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'apiClientCore.js')).href);
  const { ApiAuthenticationError, ApiAuthorizationError, ApiBackendError } = await import(
    pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'apiErrors.js')).href
  );
  const jsonResponse = (body = {}, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
  const calls = [];
  const gasCalls = [];
  const gasApi = {
    get: async (query) => {
      gasCalls.push({ method: 'GET', query });
      return jsonResponse({ success: true });
    },
    post: async (payload) => {
      gasCalls.push({ method: 'POST', payload });
      return jsonResponse({ success: true });
    }
  };
  const authClient = { getAccessToken: () => 'line-token' };
  const worker = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test'
    },
    authClient,
    gasApi,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ success: true, orderId: 'ORD-1', newBalance: -10 });
    }
  });

  await worker.submitOrder({
    userId: 'forged-user',
    pickup_floor: '1樓',
    target_date: '2026-09-08',
    items: [
      { item_id: 'legacy-duplicate', menu_item_id: 'menu-a', item_name: 'client name', unit_price: 1, quantity: 2 },
      { item_id: 'legacy-duplicate', menu_item_id: 'menu-b', quantity: 1 }
    ],
    note: '  no mushrooms  ',
    idempotencyKey: 'order-key-1'
  });
  await worker.cancelOrder({
    userId: 'forged-user',
    orderId: 'ORD-1',
    date: '2026-09-08',
    idempotencyKey: 'cancel-key-1'
  });

  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0].url).pathname, '/api/orders');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer line-token');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'order-key-1');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    targetDate: '2026-09-08',
    pickupFloor: '1樓',
    replaceExisting: true,
    items: [
      { item_id: 'legacy-duplicate', menu_item_id: 'menu-a', quantity: 2 },
      { item_id: 'legacy-duplicate', menu_item_id: 'menu-b', quantity: 1 }
    ],
    note: '  no mushrooms  '
  });
  assert.equal(JSON.parse(calls[0].options.body).userId, undefined);
  assert.equal(new URL(calls[1].url).pathname, '/api/orders/ORD-1/cancel');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer line-token');
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'cancel-key-1');
  assert.equal(calls[1].options.body, undefined);
  assert.equal(gasCalls.length, 0);

  const gas = createApiClient({
    env: { VITE_GAS_API_URL: 'https://gas.example.test/exec' },
    authClient,
    gasApi,
    fetchImpl: () => {
      throw new Error('GAS mode must not use Worker fetch.');
    }
  });
  await gas.submitOrder({
    userId: 'user-1',
    pickup_floor: '1樓',
    target_date: '2026-09-08',
    items: [{ item_id: 'legacy-a', quantity: 1 }],
    note: 'legacy',
    idempotencyKey: 'ignored-by-gas'
  });
  await gas.cancelOrder({
    userId: 'user-1',
    orderId: 'ORD-1',
    date: '2026-09-08',
    idempotencyKey: 'ignored-by-gas'
  });
  assert.deepEqual(gasCalls.slice(-2), [
    {
      method: 'POST',
      payload: {
        action: 'submitOrder',
        accessToken: 'line-token',
        userId: 'user-1',
        pickup_floor: '1樓',
        target_date: '2026-09-08',
        items: [{ item_id: 'legacy-a', quantity: 1 }],
        note: 'legacy'
      }
    },
    {
      method: 'POST',
      payload: {
        action: 'cancelOrder',
        accessToken: 'line-token',
        userId: 'user-1',
        orderId: 'ORD-1',
        date: '2026-09-08'
      }
    }
  ]);

  const responses = [
    [401, ApiAuthenticationError, 'API_AUTH_REJECTED'],
    [403, ApiAuthorizationError, 'ORDER_FORBIDDEN'],
    [409, ApiBackendError, 'IDEMPOTENCY_CONFLICT']
  ];
  for (const [status, ErrorType, code] of responses) {
    const rejected = createApiClient({
      env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
      authClient,
      fetchImpl: async () => jsonResponse({ error: code }, status)
    });
    await assert.rejects(
      () => rejected.submitOrder({
        target_date: '2026-09-08',
        pickup_floor: '1樓',
        items: [{ item_id: 'legacy-a', quantity: 1 }],
        idempotencyKey: 'order-error'
      }),
      (error) => error instanceof ErrorType
        && error.operation === 'submitOrder'
        && error.code === code
        && error.status === status
    );
  }
});

test('frontend order idempotency keys are stable per action and block duplicate execution', async () => {
  const {
    clearClientRequestKey,
    getStableClientRequestKey
  } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'clientRequestKeys.js')).href);
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const submitRef = { current: null };
  const firstPayload = {
    targetDate: '2026-09-08',
    pickupFloor: '1樓',
    items: [{ item_id: 'legacy-a', quantity: 1 }],
    note: ''
  };
  const firstKey = getStableClientRequestKey(submitRef, 'order', firstPayload);
  const retryKey = getStableClientRequestKey(submitRef, 'order', { ...firstPayload });
  const laterKey = getStableClientRequestKey(submitRef, 'order', {
    ...firstPayload,
    items: [{ item_id: 'legacy-a', quantity: 2 }]
  });
  assert.equal(retryKey, firstKey);
  assert.notEqual(laterKey, firstKey);
  clearClientRequestKey(submitRef);
  assert.notEqual(getStableClientRequestKey(submitRef, 'order', firstPayload), laterKey);

  assert.match(appSource, /orderMutationInFlightRef\.current/);
  assert.match(appSource, /getStableClientRequestKey/);
  assert.match(appSource, /clearClientRequestKey/);
  assert.match(appSource, /item_id: item\.menu_item_id \|\| item\.item_id/);
  assert.match(appSource, /idempotencyKey: requestKey/);
  assert.match(appSource, /idempotencyKey: cancelRequestKey/);
});

test('Worker like adapter maps like and unlike responses without GAS fallback', async () => {
  const { createApiClient } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'apiClientCore.js')).href);
  const { ApiAuthenticationError, ApiAuthorizationError, ApiBackendError } = await import(
    pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'apiErrors.js')).href
  );
  const jsonResponse = (body = {}, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
  const calls = [];
  const gasCalls = [];
  const gasApi = {
    get: async (query) => {
      gasCalls.push({ method: 'GET', query });
      return jsonResponse({ success: true });
    },
    post: async (payload) => {
      gasCalls.push({ method: 'POST', payload });
      return jsonResponse({ success: true });
    }
  };
  const authClient = { getAccessToken: () => 'line-token' };
  const responses = [
    { success: true, isLiked: true, totalLikes: 3 },
    { success: true, isLiked: false, totalLikes: 2 }
  ];
  const worker = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test'
    },
    authClient,
    gasApi,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(responses.shift());
    }
  });

  const liked = await worker.toggleLike({ date: '2026-09-08', userId: 'forged-user' });
  const unliked = await worker.toggleLike({ date: '2026-09-08', userId: 'forged-user' });
  assert.deepEqual(await liked.json(), { success: true, isLiked: true, totalLikes: 3 });
  assert.deepEqual(await unliked.json(), { success: true, isLiked: false, totalLikes: 2 });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(new URL(call.url).pathname, '/api/calendar/2026-09-08/like');
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.Authorization, 'Bearer line-token');
    assert.equal(call.options.body, undefined);
    assert.equal(new URL(call.url).search, '');
  }
  assert.equal(gasCalls.length, 0);

  const gas = createApiClient({
    env: { VITE_GAS_API_URL: 'https://gas.example.test/exec' },
    authClient,
    gasApi,
    fetchImpl: () => {
      throw new Error('GAS mode must not use Worker fetch.');
    }
  });
  await gas.toggleLike({ date: '2026-09-08', userId: 'user-1' });
  assert.deepEqual(gasCalls, [{
    method: 'POST',
    payload: {
      action: 'toggleLike',
      date: '2026-09-08',
      accessToken: 'line-token',
      userId: 'user-1'
    }
  }]);

  const errors = [
    [401, ApiAuthenticationError, 'API_AUTH_REJECTED'],
    [403, ApiAuthorizationError, 'LIKE_FORBIDDEN'],
    [500, ApiBackendError, 'LIKE_FAILED']
  ];
  for (const [status, ErrorType, code] of errors) {
    const rejected = createApiClient({
      env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
      authClient,
      fetchImpl: async () => jsonResponse({ error: code }, status)
    });
    await assert.rejects(
      () => rejected.toggleLike({ date: '2026-09-08', userId: 'forged-user' }),
      (error) => error instanceof ErrorType
        && error.operation === 'toggleLike'
        && error.code === code
        && error.status === status
    );
  }
});

test('frontend like adapter keeps authoritative state and rolls back optimistic failures', async () => {
  const {
    normalizeWorkerLikeResponse,
    restoreCalendarEvent
  } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'likeState.js')).href);
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const likeStateSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'likeState.js'), 'utf8');
  assert.deepEqual(normalizeWorkerLikeResponse({ success: true, isLiked: true, totalLikes: 3 }), {
    isLiked: true,
    likeCount: 3
  });
  assert.deepEqual(normalizeWorkerLikeResponse({ success: true, isLiked: false, totalLikes: 0 }), {
    isLiked: false,
    likeCount: 0
  });
  for (const invalid of [
    { success: true },
    { success: true, isLiked: 'true', totalLikes: 1 },
    { success: true, isLiked: true, totalLikes: null },
    { success: true, isLiked: true, totalLikes: -1 },
    { success: true, isLiked: true, totalLikes: 1.5 }
  ]) {
    assert.equal(normalizeWorkerLikeResponse(invalid), null);
  }
  const previousEvent = { order_date: '2026-09-08', isUserLiked: false, likeCount: 2 };
  assert.deepEqual(
    restoreCalendarEvent({ '2026-09-08': { isUserLiked: true, likeCount: 3 } }, '2026-09-08', previousEvent),
    { '2026-09-08': previousEvent }
  );
  assert.deepEqual(
    restoreCalendarEvent({ '2026-09-08': { isUserLiked: true, likeCount: 1 } }, '2026-09-08', undefined),
    {}
  );
  assert.match(appSource, /const previousEvent = calendarEvents\[dateStr\]/);
  assert.match(appSource, /rollbackOptimisticLike/);
  assert.match(appSource, /normalizeWorkerLikeResponse/);
  assert.match(appSource, /isUserLiked: authoritative\.isLiked/);
  assert.match(appSource, /likeCount: authoritative\.likeCount/);
  assert.match(likeStateSource, /Number\.isSafeInteger\(data\.totalLikes\)/);
  assert.match(appSource, /likeMutationInFlightRef\.current/);
  assert.match(appSource, /disabled=\{isViewAsMode \|\| likeMutationInFlight\}/);
  assert.match(appSource, /apiClient\.transport === 'worker'/);
  assert.match(appSource, /apiClient\.toggleLike\(\{ date: dateStr, userId: authUserId \}\)/);
});

test('Worker read adapters propagate View As only for the effective read subject', async () => {
  const { createApiClient } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'apiClientCore.js')).href);
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const permissionsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth', 'permissions.js'), 'utf8');
  const authClient = { isMock: false, getAccessToken: () => 'line-token' };
  const gasCalls = [];
  const workerCalls = [];
  const jsonResponse = (body = {}, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
  const worker = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient,
    gasApi: {
      get: async () => { throw new Error('Worker mode must not call GAS.'); },
      post: async () => { throw new Error('Worker mode must not call GAS.'); }
    },
    fetchImpl: async (url) => {
      workerCalls.push(new URL(url));
      return jsonResponse({ success: true, transactions: [], events: {}, ordersMap: {}, myOrder: null });
    }
  });

  await worker.getCalendar({ userId: 'forged-user' });
  await worker.getOrdersMap({ userId: 'forged-user' });
  await worker.getOrderPage({ targetDate: '2026-09-10', userId: 'forged-user' });
  await worker.getBalanceHistory({ year: 2026, month: 9, viewAsUserId: 'viewed-user' });
  await worker.getCalendar({ viewAsUserId: 'viewed-user' });
  await worker.getOrdersMap({ viewAsUserId: 'viewed-user' });
  await worker.getOrderPage({ targetDate: '2026-09-10', viewAsUserId: 'viewed-user' });

  assert.equal(workerCalls[0].searchParams.get('userId'), null);
  assert.equal(workerCalls[0].searchParams.get('viewAs'), null);
  assert.equal(workerCalls[1].searchParams.get('userId'), null);
  assert.equal(workerCalls[1].searchParams.get('viewAs'), null);
  assert.equal(workerCalls[2].searchParams.get('userId'), null);
  assert.equal(workerCalls[2].searchParams.get('viewAs'), null);
  assert.equal(workerCalls[3].searchParams.get('month'), '2026-09');
  assert.equal(workerCalls[3].searchParams.get('viewAs'), 'viewed-user');
  assert.equal(workerCalls[4].searchParams.get('viewAs'), 'viewed-user');
  assert.equal(workerCalls[5].searchParams.get('viewAs'), 'viewed-user');
  assert.equal(workerCalls[6].searchParams.get('targetDate'), '2026-09-10');
  assert.equal(workerCalls[6].searchParams.get('viewAs'), 'viewed-user');

  const gas = createApiClient({
    env: { VITE_GAS_API_URL: 'https://gas.example.test/exec' },
    authClient,
    gasApi: {
      get: async (query) => { gasCalls.push(['GET', query]); return jsonResponse({ success: true }); },
      post: async (payload) => { gasCalls.push(['POST', payload]); return jsonResponse({ success: true }); }
    }
  });
  await gas.getCalendar({ userId: 'gas-user' });
  await gas.getOrdersMap({ userId: 'gas-user' });
  await gas.getOrderPage({ userId: 'gas-user', targetDate: '2026-09-10' });
  await gas.getBalanceHistory({ year: 2026, month: 9, viewAsUserId: 'ignored-view' });
  assert.match(gasCalls[0][1], /userId=gas-user/);
  assert.match(gasCalls[1][1], /userId=gas-user/);
  assert.match(gasCalls[2][1], /userId=gas-user/);
  assert.equal(gasCalls[3][1].viewAsUserId, undefined);

  const unauthorized = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient,
    fetchImpl: async () => jsonResponse({ error: 'VIEW_AS_FORBIDDEN' }, 403)
  });
  await assert.rejects(
    unauthorized.getCalendar({ viewAsUserId: 'viewed-user' }),
    (error) => error.kind === 'authorization'
      && error.code === 'VIEW_AS_FORBIDDEN'
      && error.status === 403
  );

  assert.match(appSource, /usingLegacyStartup = apiClient\.transport === ['"]gas['"] && identity\?\.code === ['"]INVALID_ACTION['"]/);
  assert.match(appSource, /fetchCalendarEvents\(user\.userId, user\.userId\)/);
  assert.match(appSource, /fetchUserAllOrders\(user\.userId, user\.userId\)/);
  assert.match(appSource, /loadBalanceHistory\(currentMonth\.year, currentMonth\.month, viewAsUser\?\.userId \|\| null\)/);
  assert.match(appSource, /loadBalanceHistory\(nextMonth\.year, nextMonth\.month, viewAsUser\?\.userId \|\| null\)/);
  assert.match(appSource, /viewAsUserId: apiClient\.transport === ['"]worker['"] \? viewAsUser\?\.userId : null/);
  assert.match(permissionsSource, /ProxyAdmin:[\s\S]*?viewMemberBalances: false[\s\S]*?topupMember: false/);
});

test('production auth client delegates to LIFF even when mock is requested', async () => {
  const { createAuthClient } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'auth', 'authClient.js')).href);
  const calls = [];
  const liffClient = {
    init: (options) => calls.push(['init', options]),
    isLoggedIn: () => true,
    isInClient: () => false,
    login: () => calls.push(['login']),
    getAccessToken: () => 'real-line-token'
  };
  const client = createAuthClient({
    env: { DEV: false, VITE_AUTH_MODE: 'mock', VITE_LIFF_ID: 'test-liff-id' },
    liffClient,
    logger: { info() {} }
  });

  assert.equal(client.mode, 'liff');
  await client.init();
  assert.deepEqual(calls, [['init', { liffId: 'test-liff-id' }]]);
  assert.equal(client.getAccessToken(), 'real-line-token');
});

test('mock identities preserve canonical user roles and unregistered shape', async () => {
  const { getMockIdentityResponse } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'auth', 'mockData.js')).href);

  for (const [mockUser, role] of [['user', 'User'], ['admin', 'Admin'], ['proxy-admin', 'ProxyAdmin']]) {
    const identity = getMockIdentityResponse(mockUser);
    assert.equal(identity.success, true);
    assert.equal(identity.registered, true);
    assert.equal(identity.user.role, role);
    assert.ok(identity.user.userId);
    assert.ok(identity.calendar.events);
    assert.ok(identity.ordersMap);
  }

  const unregistered = getMockIdentityResponse('unregistered');
  assert.deepEqual(unregistered, {
    success: true,
    registered: false,
    lineUserId: 'mock-unregistered-id',
    displayName: 'Mock Unregistered'
  });
});

test('mock API reuses bootstrap and order-page response contracts', async () => {
  const { createMockGasApi } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'api', 'mockGasApi.js')).href);
  const api = createMockGasApi({ mockUser: 'admin' });
  const bootstrap = await (await api.post({
    action: 'getBootstrapData',
    deferUiData: true,
    bootId: 'BOOT-20260906-mock01'
  })).json();
  const deferred = await (await api.post({
    action: 'getDeferredBootstrapData',
    bootId: 'BOOT-20260906-mock01'
  })).json();
  const orderPage = await (await api.get('?action=getOrderPageData&targetDate=2099-01-02')).json();

  assert.equal(bootstrap.registered, true);
  assert.ok(bootstrap.user.userId);
  assert.ok(bootstrap.calendar.events);
  assert.ok(bootstrap.ordersMap);
  const primaryDate = Object.keys(bootstrap.calendar.events)[0];
  assert.deepEqual(Object.keys(bootstrap.calendar.events[primaryDate]).sort(), [
    'deadline',
    'isExpired',
    'lunarLabel',
    'mode',
    'order_date',
    'vendor'
  ]);
  assert.equal(bootstrap.bootId, 'BOOT-20260906-mock01');
  assert.equal(deferred.success, true);
  assert.equal(deferred.registered, true);
  assert.equal(deferred.bootId, 'BOOT-20260906-mock01');
  assert.ok(deferred.likes[primaryDate]);
  assert.ok(Array.isArray(deferred.announcements));
  assert.deepEqual(Object.keys(orderPage), ['success', 'setting', 'deadline', 'menu', 'myOrder']);
  assert.equal(orderPage.success, true);
  assert.ok(Array.isArray(orderPage.menu));
  assert.ok(Array.isArray(orderPage.myOrder.items));
});
