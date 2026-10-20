const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { accessSync, constants, mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const browserPath = [process.env.CHROME_BIN, process.env.CHROMIUM_BIN, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .filter(Boolean).find((candidate) => {
    if (!fs.existsSync(candidate)) return false;
    try { accessSync(candidate, constants.X_OK); return true; } catch { return false; }
  });
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const connectDevTools = (url) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  socket.onopen = () => resolve({
    close: () => socket.close(),
    send: (method, params = {}) => new Promise((ok, fail) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`Timed out waiting for ${method}.`));
      }, 10_000);
      pending.set(id, { ok, fail, timeout, method });
      socket.send(JSON.stringify({ id, method, params }));
    })
  });
  socket.onerror = () => reject(new Error('Could not connect to local Chromium DevTools.'));
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.fail(new Error(`${entry.method}: ${message.error.message}`));
    else entry.ok(message.result);
  };
});

test('Vendor operations UI keeps Vendor in a dedicated shell and separates manual transfers from order status', () => {
  const page = read('src/features/vendors/VendorOperationsPage.jsx');
  const app = read('src/App.jsx');
  const nav = read('src/components/BottomNavigation.jsx');

  assert.match(page, /依已授權廠商範圍顯示/);
  assert.match(page, /LOCAL MOCK · 非 LINE／非實際 API/);
  assert.match(page, /我已在銀行 App 完成這筆實際轉帳/);
  assert.match(page, /本系統不會執行付款/);
  assert.match(page, /不收集帳號或付款截圖/);
  assert.match(page, /與訂單履行狀態分開/);
  assert.match(page, /待廠商確認/);
  assert.match(page, /提出爭議/);
  assert.match(page, /記錄分攤更正/);
  assert.match(page, /未登記差額/);
  assert.match(app, /isVendorAccount && viewMode === 'vendor'/);
  assert.match(app, /!isVendorAccount && viewMode === 'calendar'/);
  assert.match(app, /廠商每日訂單與轉帳對帳/);
  assert.match(nav, /role === 'Vendor'[\s\S]*key === 'vendor'/);
});

test('Admin can read disabled vendor history but cannot start a new transfer', async () => {
  const page = read('src/features/vendors/VendorOperationsPage.jsx');
  const { canRecordVendorTransfer, isVendorEnabled } = await import('../src/features/vendors/vendorOperationsPolicy.js');

  assert.equal(isVendorEnabled({ enabled: true }), true);
  assert.equal(isVendorEnabled({ enabled: 1 }), true);
  assert.equal(isVendorEnabled({ enabled: '1' }), true);
  assert.equal(isVendorEnabled({ enabled: false }), false);
  assert.equal(isVendorEnabled({ enabled: 0 }), false);
  assert.equal(isVendorEnabled({}), false);
  assert.equal(canRecordVendorTransfer('Admin', { enabled: true }), true);
  assert.equal(canRecordVendorTransfer('Admin', { enabled: false }), false);
  assert.equal(canRecordVendorTransfer('Vendor', { enabled: true }), false);

  assert.match(page, /vendors\.find\(\(vendor\) => vendor\.id === vendorId\)/);
  assert.match(page, /canRecordVendorTransfer\(role, selectedVendor\)/);
  assert.match(page, /vendor\.name\}（已停用）/);
  assert.match(page, /此廠商已停用；仍可檢視歷史對帳，但不能登記新轉帳。/);
  assert.match(page, /getAdminVendorOperations\(\{ month, vendorId \}\)/);
});

test('local Mock keeps disabled vendor settlement history read-only', async () => {
  const { createMockGasApi } = await import('../src/api/mockGasApi.js');
  const { getMockSessionState } = await import('../src/auth/mockData.js');
  const state = getMockSessionState('admin');
  const vendor = state.vendorMetadata.find((entry) => entry.id === 'mock-vendor-b');
  assert.ok(vendor);
  const priorEnabled = vendor.enabled;
  const priorPaymentCount = state.vendorPayments.length;
  const adminApi = createMockGasApi({ mockUser: 'admin' });
  const fixture = {
    vendorId: vendor.id, amountTwd: 80, transferredOn: '2099-01-01',
    actualTransferDone: true, detailsReviewed: true,
    idempotencyKey: 'mock-disabled-vendor-history',
    allocations: [{ serviceDate: '2099-01-01', amountTwd: 80 }]
  };

  try {
    const paymentResponse = await adminApi.post({ action: 'recordVendorPayment', ...fixture });
    assert.equal(paymentResponse.status, 201);
    const payment = await paymentResponse.json();
    vendor.enabled = false;

    const historyResponse = await adminApi.get(
      `?action=getAdminVendorOperations&month=2099-01&vendorId=${vendor.id}`
    );
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.equal(history.vendor.id, vendor.id);
    assert.equal(history.days[0].settlement.registeredTransferTwd, 80);
    assert.equal(history.days[0].settlement.transfers[0].paymentId, payment.paymentId);

    const blockedResponse = await adminApi.post({
      action: 'recordVendorPayment', ...fixture, idempotencyKey: 'mock-disabled-vendor-new-transfer'
    });
    assert.equal(blockedResponse.status, 404);
    assert.deepEqual(await blockedResponse.json(), { success: false, error: 'VENDOR_NOT_FOUND' });
    assert.equal(state.vendorPayments.length, priorPaymentCount + 1);
  } finally {
    vendor.enabled = priorEnabled;
    state.vendorPayments.splice(priorPaymentCount);
  }
});

test('Admin browser shows disabled vendor history without a transfer form', {
  skip: browserPath ? false : 'Chromium/Chrome is unavailable; local browser UAT remains required.',
  timeout: 90_000
}, async () => {
  const envKeys = ['VITE_AUTH_MODE', 'VITE_MOCK_USER', 'VITE_API_TRANSPORT'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.VITE_AUTH_MODE = 'mock';
  process.env.VITE_MOCK_USER = 'admin';
  delete process.env.VITE_API_TRANSPORT;
  let viteServer;
  let browser;
  let devtools;
  let profile;
  let browserStderr = '';

  try {
    const { createServer } = await import('vite');
    viteServer = await createServer({
      configFile: path.join(root, 'vite.config.js'),
      root,
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, strictPort: true }
    });
    await viteServer.listen();
    const appUrl = `http://127.0.0.1:${viteServer.httpServer.address().port}/`;
    profile = mkdtempSync(path.join(os.tmpdir(), 'bento-admin-vendor-mock-'));
    const browserArgs = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-crash-reporter', '--disable-breakpad', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, 'about:blank'
    ];
    if (process.platform === 'linux') browserArgs.splice(2, 0, '--no-zygote', '--single-process');
    browser = spawn(browserPath, browserArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    const browserUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chromium did not start within 15 seconds.')), 15_000);
      browser.once('error', (error) => { clearTimeout(timeout); reject(error); });
      browser.once('exit', (code) => {
        if (!browserStderr.includes('DevTools listening on')) {
          clearTimeout(timeout);
          reject(new Error(`Chromium exited before DevTools startup (${code}).`));
        }
      });
      browser.stderr.on('data', (chunk) => {
        browserStderr += chunk.toString();
        const match = browserStderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/u);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    const port = new URL(browserUrl).port;
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    assert.equal(targetResponse.ok, true);
    const target = await targetResponse.json();
    devtools = await connectDevTools(target.webSocketDebuggerUrl);
    await devtools.send('Page.enable');
    await devtools.send('Runtime.enable');
    const evaluate = async (expression) => {
      const result = await devtools.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.text || 'Browser evaluation failed.');
      return result.result.value;
    };
    const waitFor = async (expression, label) => {
      const until = Date.now() + 20_000;
      while (Date.now() < until) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await pause(100);
      }
      throw new Error(`Timed out waiting for ${label}.`);
    };
    const clickButton = async (label, selector = 'button') => {
      const clicked = await evaluate(`(() => {
        const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find((candidate) => candidate.innerText.trim() === ${JSON.stringify(label)});
        if (!button) return false;
        button.click();
        return true;
      })()`);
      assert.equal(clicked, true, `Could not find button: ${label}`);
    };

    await devtools.send('Page.navigate', { url: appUrl });
    await waitFor('document.querySelector("nav[aria-label=主要導覽]")?.innerText.includes("管理")', 'Admin local Mock shell');
    await clickButton('管理', 'nav[aria-label="主要導覽"] button');
    await waitFor('document.body.innerText.includes("管理中心")', 'Admin management center');
    await clickButton('店家專區 ›');
    await waitFor('document.body.innerText.includes("Mock Bento B")', 'Admin vendor list');
    const openedVendor = await evaluate(`(() => {
      const article = [...document.querySelectorAll("article")]
        .find((candidate) => candidate.innerText.includes("Mock Bento B"));
      const button = article?.querySelector("button");
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(openedVendor, true, 'Could not open the synthetic Mock Bento B details.');
    await waitFor('document.querySelector("#vendor-enabled")', 'vendor editor');
    await evaluate('document.querySelector("#vendor-enabled").click()');
    await clickButton('儲存店家資料');
    await waitFor('document.body.innerText.includes("暫停使用") && document.querySelector("#vendor-enabled")?.checked === false', 'disabled vendor update');

    await clickButton('← 店家專區');
    await waitFor('document.body.innerText.includes("店家專區") && document.body.innerText.includes("查看店家")', 'Admin vendor list after update');
    await clickButton('← 月曆');
    await clickButton('管理', 'nav[aria-label="主要導覽"] button');
    await clickButton('廠商每日訂單與轉帳對帳 ›');
    await waitFor('document.querySelector("[aria-label=廠商每日訂單與轉帳管理] select option[value=mock-vendor-b]")', 'Admin Vendor operations selector');
    const selected = await evaluate(`(() => {
      const section = document.querySelector('[aria-label="廠商每日訂單與轉帳管理"]');
      const select = section?.querySelector("select");
      if (!select) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "mock-vendor-b");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    assert.equal(selected, true);
    await waitFor(`(() => {
      const section = document.querySelector('[aria-label="廠商每日訂單與轉帳管理"]');
      return section?.innerText.includes("此廠商已停用；仍可檢視歷史對帳，但不能登記新轉帳。")
        && !section.querySelector("form")
        && section.querySelector("select option:checked")?.textContent.includes("已停用");
    })()`, 'disabled-vendor history-only view');
    const result = await evaluate(`(() => {
      const section = document.querySelector('[aria-label="廠商每日訂單與轉帳管理"]');
      return {
        selectedOption: section.querySelector("select option:checked").textContent.trim(),
        hasHistory: section.innerText.includes("Mock Bento B"),
        transferFormCount: section.querySelectorAll("form").length,
        status: section.querySelector('[role="status"]')?.innerText || ""
      };
    })()`);
    assert.match(result.selectedOption, /已停用/u);
    assert.equal(result.hasHistory, true);
    assert.equal(result.transferFormCount, 0);
    assert.match(result.status, /不能登記新轉帳/u);
  } finally {
    devtools?.close();
    if (browser && browser.exitCode === null) browser.kill('SIGTERM');
    if (viteServer) await viteServer.close();
    if (profile) rmSync(profile, { recursive: true, force: true });
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});

test('local Mock supports a separate Vendor fixture and synthetic bank-transfer workflow', async () => {
  const { createMockGasApi } = await import('../src/api/mockGasApi.js');
  const { getMockIdentityResponse, getMockVendorOperations } = await import('../src/auth/mockData.js');
  const { MOCK_USER_KEYS } = await import('../src/auth/authMode.js');

  assert.ok(MOCK_USER_KEYS.includes('vendor'));
  assert.equal(getMockIdentityResponse('vendor').user.role, 'Vendor');
  assert.equal(getMockIdentityResponse('vendor').user.employeeId, null);
  const serviceDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const month = serviceDate.slice(0, 7);
  const fixture = {
    vendorId: 'mock-vendor-a', amountTwd: 240, transferredOn: serviceDate,
    actualTransferDone: true, detailsReviewed: true,
    idempotencyKey: 'mock-vendor-transfer-1001',
    allocations: [{ serviceDate, amountTwd: 200 }]
  };
  const adminApi = createMockGasApi({ mockUser: 'admin' });
  const paymentResponse = await adminApi.post({ action: 'recordVendorPayment', ...fixture });
  assert.equal(paymentResponse.status, 201);
  const recorded = await paymentResponse.json();
  assert.equal(recorded.replayed, false);
  const replay = await adminApi.post({ action: 'recordVendorPayment', ...fixture });
  assert.equal((await replay.json()).replayed, true);

  const vendorApi = createMockGasApi({ mockUser: 'vendor' });
  const vendorData = await vendorApi.get(`?action=getVendorOperations&month=${month}`);
  const vendorResponse = await vendorData.json();
  assert.equal(vendorResponse.success, true);
  assert.deepEqual(vendorResponse.vendors.map((vendor) => vendor.id), ['mock-vendor-a']);
  assert.equal(vendorResponse.days[0].settlement.pendingConfirmationTwd, 200);
  assert.equal(JSON.stringify(vendorResponse).includes('employeeId'), false);

  const noReason = await vendorApi.post({
    action: 'disputeVendorPayment', paymentId: recorded.paymentId, reason: ' '
  });
  assert.equal(noReason.status, 400);
  const disputed = await vendorApi.post({
    action: 'disputeVendorPayment', paymentId: recorded.paymentId, reason: '合成資料金額不符'
  });
  assert.equal((await disputed.json()).status, 'DISPUTED');

  const resolved = await adminApi.post({
    action: 'resolveVendorPaymentDispute', paymentId: recorded.paymentId,
    resolution: '合成紀錄已核對'
  });
  assert.equal((await resolved.json()).status, 'RESOLVED');

  const mockOps = getMockVendorOperations('vendor', { month });
  assert.equal(mockOps.days[0].settlement.confirmedTwd, 200);
  assert.equal(mockOps.days[0].settlement.disputedTwd, 0);
  const unconfirmedReversal = await adminApi.post({
    action: 'reverseVendorPayment', paymentId: recorded.paymentId,
    reason: '合成資料沖正測試', confirmed: false
  });
  assert.equal(unconfirmedReversal.status, 400);
  const reversal = await adminApi.post({
    action: 'reverseVendorPayment', paymentId: recorded.paymentId,
    reason: '合成資料沖正測試', confirmed: true
  });
  assert.equal((await reversal.json()).status, 'REVERSED');
  const reversedOps = getMockVendorOperations('vendor', { month });
  assert.equal(reversedOps.days[0].settlement.confirmedTwd, 0);
  assert.equal(reversedOps.days[0].settlement.registeredTransferTwd, 0);
  assert.equal(reversedOps.days[0].settlement.transfers[0].status, 'REVERSED');
});

test('Vendor local mock portal renders at phone and desktop widths without employee or wallet views', {
  skip: browserPath ? false : 'Chromium/Chrome is unavailable; local browser UAT remains required.',
  timeout: 90_000
}, async () => {
  const envKeys = ['VITE_AUTH_MODE', 'VITE_MOCK_USER', 'VITE_API_TRANSPORT'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.VITE_AUTH_MODE = 'mock';
  process.env.VITE_MOCK_USER = 'vendor';
  delete process.env.VITE_API_TRANSPORT;
  let viteServer;
  let browser;
  let devtools;
  let profile;
  let browserStderr = '';
  try {
    const { createServer } = await import('vite');
    viteServer = await createServer({
      configFile: path.join(root, 'vite.config.js'),
      root,
      logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, strictPort: true }
    });
    await viteServer.listen();
    const appUrl = `http://127.0.0.1:${viteServer.httpServer.address().port}/`;
    profile = mkdtempSync(path.join(os.tmpdir(), 'bento-vendor-mock-'));
    const browserArgs = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-crash-reporter', '--disable-breakpad', '--remote-debugging-port=0',
      `--user-data-dir=${profile}`, 'about:blank'
    ];
    if (process.platform === 'linux') browserArgs.splice(2, 0, '--no-zygote', '--single-process');
    browser = spawn(browserPath, browserArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    const browserUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chromium did not start within 15 seconds.')), 15_000);
      browser.once('error', (error) => { clearTimeout(timeout); reject(error); });
      browser.once('exit', (code) => {
        if (!browserStderr.includes('DevTools listening on')) {
          clearTimeout(timeout);
          reject(new Error(`Chromium exited before DevTools startup (${code}).`));
        }
      });
      browser.stderr.on('data', (chunk) => {
        browserStderr += chunk.toString();
        const match = browserStderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/u);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    const port = new URL(browserUrl).port;
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
    assert.equal(targetResponse.ok, true);
    const target = await targetResponse.json();
    devtools = await connectDevTools(target.webSocketDebuggerUrl);
    await devtools.send('Page.enable');
    await devtools.send('Runtime.enable');
    const evaluate = async (expression) => {
      const result = await devtools.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.text || 'Browser evaluation failed.');
      return result.result.value;
    };
    const waitFor = async (expression, label) => {
      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await pause(100);
      }
      throw new Error(`Timed out waiting for ${label}.`);
    };

    for (const width of [375, 1280]) {
      const height = width < 640 ? 812 : 900;
      await devtools.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width < 640,
        screenWidth: width, screenHeight: height
      });
      await devtools.send('Page.navigate', { url: appUrl });
      await waitFor('document.body.innerText.includes("DEV · MOCK VENDOR") && document.body.innerText.includes("每日訂單與轉帳") && document.body.innerText.includes("Mock Bento A")', 'Vendor local Mock portal data');
      const metrics = JSON.parse(await evaluate(`JSON.stringify({width:innerWidth,documentWidth:document.documentElement.scrollWidth,main:document.querySelector("main")?.innerText||"",nav:[...document.querySelectorAll("nav[aria-label=主要導覽] button")].map(button=>button.innerText.trim())})`));
      assert.equal(metrics.width, width);
      assert.ok(metrics.documentWidth <= width, `Vendor UI should fit ${width}px without horizontal overflow.`);
      assert.match(metrics.main, /LOCAL MOCK · 非 LINE／非實際 API/u);
      assert.match(metrics.main, /Mock Bento A/u);
      assert.match(metrics.main, /與訂單履行狀態分開/u);
      assert.doesNotMatch(metrics.main, /Local mock vendor|員工編號|我的訂單|餘額/u);
      assert.deepEqual(metrics.nav, ['店家']);
    }
  } finally {
    devtools?.close();
    if (browser && browser.exitCode === null) browser.kill('SIGTERM');
    if (viteServer) await viteServer.close();
    if (profile) rmSync(profile, { recursive: true, force: true });
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
