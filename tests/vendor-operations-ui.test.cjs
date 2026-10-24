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
  assert.match(page, /模擬登記銀行轉帳（LOCAL MOCK）/);
  assert.match(page, /只建立本機瀏覽器中的合成測試紀錄，不連接銀行、Worker 或正式資料/);
  assert.match(page, /我確認這是合成 Mock 轉帳/);
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
  assert.match(app, /廠商對帳 ›/);
  assert.match(nav, /role === 'Vendor'[\s\S]*key === 'vendor'/);
  assert.match(nav, /role === 'Vendor'[\s\S]*key === 'calendar'/);
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

test('vendor item labels show Chinese variant names instead of variant codes', async () => {
  const { vendorItemLabel } = await import('../src/features/vendors/vendorDayFormat.js');
  assert.equal(vendorItemLabel({ name: '紅麴豆腐', variantKey: 'BASE' }), '紅麴豆腐');
  assert.equal(vendorItemLabel({ name: '紅麴豆腐', variantKey: 'HALF' }), '紅麴豆腐（半飯）');
  assert.equal(vendorItemLabel({ name: '紅麴豆腐半飯', variantKey: 'HALF' }), '紅麴豆腐半飯');
  assert.equal(vendorItemLabel({ name: '風味便當', variantKey: 'PLUS' }), '風味便當（加量）');
  assert.equal(vendorItemLabel({ name: 'A.風味便當', variantKey: '飯少' }), 'A.風味便當（飯少）');
  assert.equal(vendorItemLabel({ name: 'C.每日特餐', variantKey: '' }), 'C.每日特餐');
  for (const file of ['VendorOperationsPage.jsx', 'VendorDaySummary.jsx']) {
    assert.doesNotMatch(read(`src/features/vendors/${file}`), /（\$\{item\.variantKey\}）/);
  }
});

test('Admin vendor preview shows the Vendor layout without Admin controls or Vendor actions', async () => {
  const page = read('src/features/vendors/VendorOperationsPage.jsx');
  const { vendorOperationsView } = await import('../src/features/vendors/vendorOperationsPolicy.js');

  assert.deepEqual(vendorOperationsView('Admin', false), {
    previewing: false, vendorLayout: false, adminControls: true, vendorActionsEnabled: false
  });
  assert.deepEqual(vendorOperationsView('Admin', true), {
    previewing: true, vendorLayout: true, adminControls: false, vendorActionsEnabled: false
  });
  assert.deepEqual(vendorOperationsView('Vendor', false), {
    previewing: false, vendorLayout: true, adminControls: false, vendorActionsEnabled: true
  });
  // A non-Admin cannot turn preview on.
  assert.equal(vendorOperationsView('Vendor', true).previewing, false);
  assert.equal(vendorOperationsView('User', true).vendorLayout, false);
  const codeLogin = vendorOperationsView('Vendor', false, true);
  assert.equal(codeLogin.vendorLayout, true);
  assert.equal(codeLogin.vendorActionsEnabled, false);

  assert.match(page, /以廠商視角預覽（唯讀）/);
  assert.match(page, /view\.adminControls && canRecordVendorTransfer\(role, selectedVendor\)/);
  // Data still comes from the Admin read API while previewing.
  assert.match(page, /getAdminVendorOperations\(\{ month, vendorId \}\)/);
  // Acknowledge and dispute stay disabled unless the signed-in user is the Vendor.
  assert.match(page, /disabled=\{Boolean\(busyKey\) \|\| !view\.vendorActionsEnabled\}/);
  assert.match(page, /disabled=\{Boolean\(busyKey\) \|\| !view\.vendorActionsEnabled \|\| /);
  assert.doesNotMatch(page, /\{isAdmin && transfer\./);
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
    await clickButton('廠商對帳 ›');
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
      return section?.querySelectorAll("article").length > 0
        && section.querySelector("select option:checked")?.textContent.includes("已停用");
    })()`, 'disabled-vendor order day');
    const expandedHistory = await evaluate(`(() => {
      const section = document.querySelector('[aria-label="廠商每日訂單與轉帳管理"]');
      const article = [...(section?.querySelectorAll("article") || [])]
        .find((candidate) => candidate.innerText.includes("2 筆訂單"));
      const button = article?.querySelector("button");
      if (!button) return false;
      if (button.getAttribute("aria-expanded") === "false") button.click();
      return true;
    })()`);
    assert.equal(
      expandedHistory,
      true,
      `Disabled-vendor history day should be expandable. Current section: ${await evaluate('document.querySelector("[aria-label=廠商每日訂單與轉帳管理]")?.innerText || "missing"')}`
    );
    await waitFor(`(() => {
      const section = document.querySelector('[aria-label="廠商每日訂單與轉帳管理"]');
      const historyDay = [...(section?.querySelectorAll("article") || [])]
        .find((article) => article.innerText.includes("Mock Noodle"));
      return section?.innerText.includes("此廠商已停用；仍可檢視歷史對帳，但不能登記新轉帳。")
        && !section.querySelector("form")
        && section.querySelector("select option:checked")?.textContent.includes("已停用")
        && historyDay?.innerText.includes("2 筆訂單");
    })()`, 'successfully loaded disabled-vendor order history and history-only view');
    const result = await evaluate(`(() => {
      const section = document.querySelector('[aria-label="廠商每日訂單與轉帳管理"]');
      const historyDay = [...section.querySelectorAll("article")]
        .find((article) => article.innerText.includes("Mock Noodle"));
      return {
        selectedOption: section.querySelector("select option:checked").textContent.trim(),
        historyDate: historyDay?.querySelector("button")?.innerText.split(" ・")[0] || "",
        historyOrders: historyDay?.innerText.match(/(\\d+) 筆訂單/u)?.[1] || "",
        historyItem: historyDay?.innerText.includes("Mock Noodle") || false,
        transferFormCount: section.querySelectorAll("form").length,
        status: section.querySelector('[role="status"]')?.innerText || ""
      };
    })()`);
    assert.match(result.selectedOption, /已停用/u);
    assert.match(result.historyDate, /^\d{4}-\d{2}-\d{2}$/u);
    assert.equal(result.historyOrders, '2');
    assert.equal(result.historyItem, true);
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

test('local Mock settlement survives a same-browser restart when switching Admin and Vendor roles', async () => {
  const { createMockGasApi } = await import('../src/api/mockGasApi.js');
  const { MOCK_VENDOR_PAYMENT_STORAGE_KEY, getMockSessionState } = await import('../src/auth/mockData.js');
  const createStorage = (initialValue = '[]') => {
    let value = initialValue;
    return {
      getItem: (key) => key === MOCK_VENDOR_PAYMENT_STORAGE_KEY ? value : null,
      setItem: (key, nextValue) => { if (key === MOCK_VENDOR_PAYMENT_STORAGE_KEY) value = String(nextValue); }
    };
  };
  const initialStorage = createStorage();
  const serviceDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  let paymentId;

  try {
    const adminApi = createMockGasApi({ mockUser: 'admin', storage: initialStorage });
    const recordedResponse = await adminApi.post({
      action: 'recordVendorPayment',
      vendorId: 'mock-vendor-a',
      amountTwd: 100,
      transferredOn: serviceDate,
      actualTransferDone: true,
      detailsReviewed: true,
      idempotencyKey: 'mock-role-switch-storage',
      allocations: [{ serviceDate, amountTwd: 100 }]
    });
    assert.equal(recordedResponse.status, 201);
    paymentId = (await recordedResponse.json()).paymentId;
    assert.equal(JSON.parse(initialStorage.getItem(MOCK_VENDOR_PAYMENT_STORAGE_KEY))[0].paymentId, paymentId);

    // A new Storage instance models a reload/restart using the same browser origin.
    const restartedStorage = createStorage(initialStorage.getItem(MOCK_VENDOR_PAYMENT_STORAGE_KEY));
    const vendorApi = createMockGasApi({ mockUser: 'vendor', storage: restartedStorage });
    const vendorResponse = await vendorApi.get(`?action=getVendorOperations&month=${serviceDate.slice(0, 7)}`);
    const vendorOperations = await vendorResponse.json();
    assert.equal(vendorOperations.days[0].settlement.pendingConfirmationTwd, 100);
    assert.equal(vendorOperations.days[0].settlement.transfers[0].paymentId, paymentId);

    const acknowledgement = await vendorApi.post({ action: 'acknowledgeVendorPayment', paymentId });
    assert.equal((await acknowledgement.json()).status, 'ACKNOWLEDGED');
    const adminAfterRestart = createMockGasApi({
      mockUser: 'admin',
      storage: createStorage(restartedStorage.getItem(MOCK_VENDOR_PAYMENT_STORAGE_KEY))
    });
    const adminResponse = await adminAfterRestart.get(
      `?action=getAdminVendorOperations&month=${serviceDate.slice(0, 7)}&vendorId=mock-vendor-a`
    );
    const adminOperations = await adminResponse.json();
    assert.equal(adminOperations.days[0].settlement.confirmedTwd, 100);

    const tampered = JSON.parse(restartedStorage.getItem(MOCK_VENDOR_PAYMENT_STORAGE_KEY));
    tampered[0].createdByMockUser = 'not-admin';
    const vendorWithInvalidStorage = createMockGasApi({
      mockUser: 'vendor',
      storage: createStorage(JSON.stringify(tampered))
    });
    const ignoredPaymentResponse = await vendorWithInvalidStorage.get(
      `?action=getVendorOperations&month=${serviceDate.slice(0, 7)}`
    );
    const ignoredPayment = await ignoredPaymentResponse.json();
    assert.equal(ignoredPayment.days[0].settlement.registeredTransferTwd, 0);
  } finally {
    getMockSessionState('admin').vendorPayments.splice(0);
    createMockGasApi({ mockUser: 'admin', storage: createStorage() });
  }
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
      await waitFor('document.body.innerText.includes("DEV · MOCK VENDOR") && document.body.innerText.includes("Mock Bento A") && document.body.innerText.includes("備餐清單")', 'Vendor local Mock portal today tab');
      const readMetrics = async () => JSON.parse(await evaluate(`JSON.stringify({width:innerWidth,documentWidth:document.documentElement.scrollWidth,main:document.querySelector("main")?.innerText||"",nav:[...document.querySelectorAll("nav[aria-label=主要導覽] button")].map(button=>button.innerText.trim()),tabs:[...document.querySelectorAll("[role=tab]")].map(button=>button.innerText.trim())})`));
      const clickTab = (label) => evaluate(`(()=>{const tab=[...document.querySelectorAll("[role=tab]")].find(button=>button.innerText.trim()===${JSON.stringify(label)});tab?.click();return Boolean(tab)})()`);
      const metrics = await readMetrics();
      assert.equal(metrics.width, width);
      assert.ok(metrics.documentWidth <= width, `Vendor UI should fit ${width}px without horizontal overflow.`);
      assert.match(metrics.main, /LOCAL MOCK · 非 LINE／非實際 API/u);
      assert.match(metrics.main, /Mock Bento A/u);
      assert.deepEqual(metrics.tabs, ['今日', '訂單總覽', '對帳']);
      assert.doesNotMatch(metrics.main, /Local mock vendor|員工編號|我的訂單|餘額/u);
      assert.deepEqual(metrics.nav, ['店家', '訂餐', '足跡']);

      assert.equal(await clickTab('訂單總覽'), true);
      await waitFor('document.body.innerText.includes("訂單日數") && document.querySelectorAll("main article").length > 1', 'Vendor order overview with several days');
      const overview = await readMetrics();
      assert.ok(overview.documentWidth <= width, `Vendor order overview should fit ${width}px.`);
      assert.doesNotMatch(overview.main, /已登記轉帳/u);

      assert.equal(await clickTab('對帳'), true);
      await waitFor('document.body.innerText.includes("與訂單履行狀態分開") && document.body.innerText.includes("未登記差額")', 'Vendor settlement tab');
      const settlement = await readMetrics();
      assert.ok(settlement.documentWidth <= width, `Vendor settlement tab should fit ${width}px.`);
      assert.doesNotMatch(settlement.main, /備餐清單|訂單日數/u);
      assert.equal(await clickTab('今日'), true);

      const clickNav = (label) => evaluate(`(()=>{const button=[...document.querySelectorAll("nav[aria-label=主要導覽] button")].find(item=>item.innerText.trim()===${JSON.stringify(label)});button?.click();return Boolean(button)})()`);
      assert.equal(await clickNav('訂餐'), true);
      await waitFor('document.querySelector("[aria-label=廠商訂餐月曆]") && [...document.querySelectorAll("[aria-label=廠商訂餐月曆] button")].some(button=>!button.disabled && /你的團/.test(button.getAttribute("aria-label")||""))', 'Vendor read-only calendar with own days');
      const calendar = await readMetrics();
      assert.ok(calendar.documentWidth <= width, `Vendor calendar should fit ${width}px.`);
      assert.match(calendar.main, /只能查看/u);
      assert.doesNotMatch(calendar.main, /查看菜單並預訂|我的訂單/u);
      assert.equal(await evaluate('[...document.querySelectorAll("[aria-label=廠商訂餐月曆] button")].filter(button=>/你的團/.test(button.getAttribute("aria-label")||"")).every(button=>!button.disabled)'), true);
      await evaluate('[...document.querySelectorAll("[aria-label=廠商訂餐月曆] button")].find(button=>!button.disabled && /你的團/.test(button.getAttribute("aria-label")||"")).click()');
      await waitFor('document.querySelector("[role=dialog]")?.innerText.includes("訂單總覽") && document.querySelector("[role=dialog]")?.innerText.includes("備餐清單")', 'Vendor day order summary dialog');
      await evaluate('document.querySelector("[role=dialog] button[aria-label=關閉視窗]").click()');
      await waitFor('![...document.querySelectorAll("[role=dialog]")].some(dialog=>dialog.innerText.includes("訂單總覽"))', 'Vendor day dialog closes');
      assert.equal(await clickNav('足跡'), true);
      await waitFor('document.querySelector("[aria-label=廠商售出足跡]")?.innerText.includes("售出餐點排行")', 'Vendor sales footprint');
      const footprint = await readMetrics();
      assert.ok(footprint.documentWidth <= width, `Vendor footprint should fit ${width}px.`);
      assert.match(footprint.main, /累計售出份數/u);
      assert.match(footprint.main, /統計到昨天為止/u);
      assert.doesNotMatch(footprint.main, /BASE|HALF|我的便當足跡|餘額/u);
      await evaluate('[...document.querySelectorAll("[aria-label=統計期間] button")].find(button=>button.innerText.trim()==="本月").click()');
      await waitFor('document.querySelector("[aria-label=統計期間] button[aria-pressed=true]")?.innerText.trim()==="本月"', 'Vendor footprint month period');
      assert.equal(await clickNav('店家'), true);
      await waitFor('document.body.innerText.includes("備餐清單")', 'Vendor back to workbench');
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
