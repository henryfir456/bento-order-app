const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { accessSync, constants, existsSync, mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

const findBrowser = () => {
  const candidates = [
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')
  ].filter(Boolean);
  return candidates.find((candidate) => {
    if (!existsSync(candidate)) return false;
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return process.platform === 'win32';
    }
  }) || null;
};

const browserPath = findBrowser();
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const milliseconds = (seconds) => seconds * 1000;

const connectDevTools = (url) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  socket.onopen = () => resolve({
    close: () => socket.close(),
    send: (method, params = {}) => new Promise((requestResolve, requestReject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        requestReject(new Error(`Timed out waiting for Chrome DevTools ${method}.`));
      }, milliseconds(10_000));
      pending.set(id, { method, details: JSON.stringify(params).slice(0, 240), resolve: requestResolve, reject: requestReject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    })
  });
  socket.onerror = () => reject(new Error('Could not connect to the local Chromium DevTools endpoint.'));
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.reject(new Error(`${entry.method} ${entry.details}: ${message.error.message}`));
    else entry.resolve(message.result);
  };
});

test('local mock UAT #103, #108, #111, and #121 works at phone and desktop widths', {
  skip: browserPath ? false : 'Chromium/Chrome is unavailable; manual viewport UAT remains required.',
  timeout: milliseconds(90_000)
}, async () => {
  const envKeys = ['VITE_AUTH_MODE', 'VITE_MOCK_USER', 'VITE_API_TRANSPORT'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.VITE_AUTH_MODE = 'mock';
  process.env.VITE_MOCK_USER = 'admin';
  delete process.env.VITE_API_TRANSPORT;

  let viteServer;
  let browser;
  let devtools;
  let browserProfile;
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
    const port = viteServer.httpServer.address().port;
    const appUrl = `http://127.0.0.1:${port}/`;

    browserProfile = mkdtempSync(path.join(os.tmpdir(), 'bento-mock-uat-'));
    const browserArgs = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-crash-reporter', '--disable-breakpad', '--remote-debugging-port=0',
      `--user-data-dir=${browserProfile}`, 'about:blank'
    ];
    if (process.platform === 'linux') browserArgs.splice(2, 0, '--no-zygote', '--single-process');
    browser = spawn(browserPath, browserArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    const devtoolsUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chromium did not expose DevTools within 15 seconds.')), milliseconds(15_000));
      browser.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      browser.once('exit', (code) => {
        if (!browserStderr.includes('DevTools listening on')) {
          clearTimeout(timeout);
          reject(new Error(`Chromium exited before starting DevTools (${code}).`));
        }
      });
      browser.stderr.on('data', (chunk) => {
        browserStderr += chunk.toString();
        const match = browserStderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/u);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
    });
    const debugPort = new URL(devtoolsUrl).port;
    const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
    assert.equal(targetResponse.ok, true, 'Chromium should create a local browser tab.');
    const target = await targetResponse.json();
    devtools = await connectDevTools(target.webSocketDebuggerUrl);
    await devtools.send('Page.enable');
    await devtools.send('Runtime.enable');

    const evaluate = async (expression) => {
      const response = await devtools.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (response.result.exceptionDetails) {
        throw new Error(response.result.exceptionDetails.text || 'Browser interaction failed.');
      }
      return response.result.value;
    };
    const waitFor = async (expression, description) => {
      const until = Date.now() + milliseconds(10_000);
      while (Date.now() < until) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${description}.`);
    };
    const clickVisibleButton = async ({ ariaLabel, text }) => {
      const selector = ariaLabel
        ? `button[aria-label=${JSON.stringify(ariaLabel)}]`
        : 'button';
      const matchText = text ? `element.innerText.trim().replace(/\\s*›\\s*$/u, '') === ${JSON.stringify(text)}` : 'true';
      const clicked = await evaluate(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(element=>element.getBoundingClientRect().width>0&&${matchText});if(!element)return false;element.scrollIntoView({block:"center",inline:"nearest"});element.click();return true})()`);
      assert.equal(clicked, true, `Expected a visible button for ${ariaLabel || text}.`);
    };
    const enterSearch = async (value) => {
      const entered = await evaluate(`(()=>{const input=document.querySelector("input[aria-label=搜尋員編]");if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event("input",{bubbles:true}));return true})()`);
      assert.equal(entered, true, 'The member search input should be available.');
    };

    for (const width of [375, 1280]) {
      const height = width < 640 ? 812 : 900;
      await devtools.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width < 640,
        screenWidth: width, screenHeight: height
      });
      await devtools.send('Page.navigate', { url: appUrl });
      await waitFor('document.readyState === "complete" && document.body.innerText.includes("DEV · MOCK ADMIN")', 'mock admin app startup');
      await devtools.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width < 640,
        screenWidth: width, screenHeight: height
      });
      assert.equal(await evaluate('window.innerWidth'), width);

      await waitFor('document.querySelector("[role=dialog]")?.innerText.includes("Mock 新公告二")', '#121 first eligible popup');
      assert.equal(await evaluate('document.querySelector("[role=dialog] input[type=checkbox]")?.checked'), false);
      await evaluate('document.querySelector("[role=dialog] input[type=checkbox]").click()');
      await clickVisibleButton({ text: '確認不再顯示' });
      await waitFor('document.querySelector("[role=dialog]")?.innerText.includes("Mock 新公告一")', '#121 serial second popup');
      await clickVisibleButton({ ariaLabel: '關閉視窗' });
      await waitFor('!document.querySelector("[role=dialog]")', '#121 ordinary popup close');
      await evaluate('window.dispatchEvent(new Event("pageshow"))');
      await delay(250);
      assert.equal(await evaluate('Boolean(document.querySelector("[role=dialog]"))'), false, 'LIFF resume events must not duplicate an entry popup.');
      const calendarBeforeInbox = await evaluate('document.querySelector("main")?.innerText || ""');
      await clickVisibleButton({ ariaLabel: '公告通知，1 則未讀' });
      await waitFor('document.querySelector("[role=dialog]")?.innerText.includes("Mock 既有公告")', '#121 inbox retains the non-popup legacy notice');
      const legacyClicked = await evaluate('(()=>{const button=[...document.querySelectorAll("[role=dialog] button")].find(item=>item.innerText.includes("Mock 既有公告"));if(!button)return false;button.click();return true})()');
      assert.equal(legacyClicked, true, 'The legacy notice should open from the inbox.');
      await waitFor('document.querySelector("[role=dialog]")?.innerText.includes("既有公告保留在收件匣")', '#121 announcement detail');
      await clickVisibleButton({ text: '← 返回公告列表' });
      await clickVisibleButton({ ariaLabel: '關閉視窗' });
      await waitFor('document.querySelector("button[aria-label=公告通知]")', '#121 inbox read state');
      assert.equal(await evaluate('document.querySelector("main")?.innerText || ""'), calendarBeforeInbox, 'Closing the inbox should return to the same order/calendar state.');

      await clickVisibleButton({ ariaLabel: '管理' });
      await clickVisibleButton({ text: '訂單總覽' });
      await waitFor('document.body.innerText.includes("E.風味餐") && document.body.innerText.includes("S.小而美") && document.body.innerText.includes("C.特餐(半飯)")', '#103 effective order labels');
      await clickVisibleButton({ text: '樓層數' });
      await waitFor('document.querySelector("[role=tab][aria-selected=true]")?.innerText.includes("樓層數") && document.body.innerText.includes("E.風味餐")', '#103 effective floor count');
      await clickVisibleButton({ text: '總數' });
      await waitFor('document.querySelector("[role=tab][aria-selected=true]")?.innerText.includes("總數") && document.body.innerText.includes("E.風味餐")', '#103 effective total count');
      await clickVisibleButton({ text: '明細' });

      await clickVisibleButton({ ariaLabel: '足跡' });
      await waitFor('document.querySelector("[aria-label=我的便當足跡]")?.innerText.includes("餐點份數排行")', '#108 mock statistics');
      const summary = JSON.parse(await evaluate('JSON.stringify([...document.querySelectorAll("[aria-label=我的便當足跡] article")].map(article=>[article.querySelector("h3")?.innerText,article.querySelector("p")?.innerText]))'));
      assert.deepEqual(summary.slice(0, 3), [
        ['累計便當份數', '7'],
        ['實際訂購天數', '2'],
        ['不同餐點種類', '3']
      ]);
      const footprintText = await evaluate('document.querySelector("[aria-label=我的便當足跡]").innerText');
      assert.match(footprintText, /蕃茄鷹豆泥[\s\S]*?3 份/u);
      assert.match(footprintText, /C\.特餐[\s\S]*?3 份/u);

      const vendorChart = JSON.parse(await evaluate('(()=>{const chart=document.querySelector("[aria-label*=店家份數甜甜圈圖]");return JSON.stringify({label:chart?.getAttribute("aria-label"),total:chart?.querySelector("[data-chart-total]")?.textContent?.trim(),details:document.querySelector("[aria-label=店家份數明細]")?.children.length})})()'));
      assert.equal(vendorChart.label, '店家份數甜甜圈圖，共 7 份');
      assert.equal(vendorChart.total, '7');
      assert.ok(vendorChart.details > 0, 'Each vendor should have a readable details row.');

      if (width === 375) {
        await devtools.send('Emulation.setDeviceMetricsOverride', {
          width: 320, height: 812, deviceScaleFactor: 1, mobile: true,
          screenWidth: 320, screenHeight: 812
        });
        const longVendorName = 'SyntheticVendorNameWithoutSpaces'.repeat(20);
        const narrowChart = JSON.parse(await evaluate(`(()=>{const section=document.querySelector('svg[aria-label*="店家份數甜甜圈圖"]')?.closest('section');const list=section?.querySelector('[aria-label="店家份數明細"]');const row=list?.querySelector('li');const name=row?.querySelector('div > span:first-child > span:last-child');const count=row?.querySelector('div > span:last-child');if(!section||!list||!row||!name||!count)return null;const original=name.textContent;name.textContent=${JSON.stringify(longVendorName)};const nameRect=name.getBoundingClientRect();const countRect=count.getBoundingClientRect();const metrics={viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,listWidth:list.clientWidth,listScrollWidth:list.scrollWidth,nameRight:nameRect.right,countLeft:countRect.left};name.textContent=original;return JSON.stringify(metrics)})()`));
        assert.ok(narrowChart, 'The 320px chart should expose a vendor details row.');
        assert.equal(narrowChart.viewport, 320);
        assert.ok(narrowChart.documentWidth <= 320, 'A long synthetic vendor name must not widen the page beyond 320px.');
        assert.ok(narrowChart.listScrollWidth <= narrowChart.listWidth, 'A long synthetic vendor name must wrap inside the details list.');
        assert.ok(narrowChart.nameRight <= narrowChart.countLeft, 'A long synthetic vendor name must not overlap the portions count.');
        await devtools.send('Emulation.setDeviceMetricsOverride', {
          width, height, deviceScaleFactor: 1, mobile: true,
          screenWidth: width, screenHeight: height
        });
      }

      await clickVisibleButton({ ariaLabel: '管理' });
      await clickVisibleButton({ text: '使用者管理' });
      await waitFor('document.querySelector("input[type=checkbox]") && document.body.innerText.includes("使用者管理中心")', '#111 member management');
      const layout = JSON.parse(await evaluate('(()=>{const input=document.querySelector("input[type=checkbox]");const rect=input.getBoundingClientRect();return JSON.stringify({width:innerWidth,documentWidth:document.documentElement.scrollWidth,x:rect.x,right:rect.right,visible:rect.width>0})})()'));
      assert.equal(layout.width, width);
      assert.ok(layout.documentWidth <= width, 'The document should not exceed the viewport width.');
      assert.equal(layout.visible, true);
      assert.ok(layout.x >= 0 && layout.right <= width, 'The include-invalid toggle should fit the viewport.');

      await enterSearch('MCKSRC');
      await waitFor('[...document.querySelectorAll("button[aria-label*=MCKSRC]")].some(button=>button.getBoundingClientRect().width>0)', '#111 synthetic source search');
      await clickVisibleButton({ ariaLabel: '檢視 MCKSRC 使用者' });
      await waitFor('document.querySelector("[role=dialog][aria-label=使用者交易明細]")', '#111 source details');
      await clickVisibleButton({ text: '修正誤建員編' });
      await waitFor('document.querySelector("[role=dialog][aria-label=修正誤建員編]")', '#111 repair dialog');
      const repairLayout = JSON.parse(await evaluate('(()=>{const dialog=document.querySelector("[role=dialog][aria-label=修正誤建員編]");const rect=dialog.getBoundingClientRect();return JSON.stringify({x:rect.x,right:rect.right,width:rect.width,scrollWidth:document.documentElement.scrollWidth})})()'));
      assert.ok(repairLayout.x >= 0 && repairLayout.right <= width, 'The repair dialog should fit the viewport.');
      assert.ok(repairLayout.scrollWidth <= width, 'The repair dialog should not introduce horizontal overflow.');

      const selectedTarget = await evaluate('(()=>{const dialog=document.querySelector("[role=dialog][aria-label=修正誤建員編]");const select=dialog.querySelector("select");const option=[...select.options].find(item=>item.text.includes("Mock Target Name"));if(!option)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set;setter.call(select,option.value);select.dispatchEvent(new Event("change",{bubbles:true}));return true})()');
      assert.equal(selectedTarget, true, 'The synthetic target should be selectable.');
      await clickVisibleButton({ text: '預覽來源與目標' });
      await waitFor('document.querySelector("[role=dialog][aria-label=修正誤建員編]")?.innerText.includes("預覽結果")', '#111 synthetic repair preview');
      const confirmationFilled = await evaluate('(()=>{const dialog=document.querySelector("[role=dialog][aria-label=修正誤建員編]");const input=dialog.querySelector("input[aria-label=輸入目標目前姓名以確認覆寫]");const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;setter.call(input,"Mock Target Name");input.dispatchEvent(new Event("input",{bubbles:true}));dialog.querySelector("input[type=checkbox]").click();return true})()');
      assert.equal(confirmationFilled, true);
      await clickVisibleButton({ text: '確認修復並記錄稽核' });
      await waitFor('document.body.innerText.includes("誤建員編帳號已停用並加入稽核")', '#111 mock repair and list reload');
      const hiddenByDefault = await evaluate('[...document.querySelectorAll("button[aria-label*=MCKSRC]")].every(button=>button.getBoundingClientRect().width===0)');
      assert.equal(hiddenByDefault, true, 'The repaired source should be hidden by default.');
      await evaluate('document.querySelector("input[type=checkbox]").click()');
      await waitFor('[...document.querySelectorAll("button[aria-label*=MCKSRC]")].some(button=>button.getBoundingClientRect().width>0)', '#111 include-invalid toggle');
      const invalidSourceButtons = JSON.parse(await evaluate('(()=>{const details=[...document.querySelectorAll("button[aria-label*=MCKSRC]")].find(button=>button.getBoundingClientRect().width>0);const row=details?.closest("tr,article");return JSON.stringify(row?[...row.querySelectorAll("button")].map(button=>button.innerText.trim()):[])})()'));
      assert.equal(invalidSourceButtons.includes('儲值'), false, 'An inactive invalid account must not expose a balance top-up action.');
      assert.equal(invalidSourceButtons.includes('檢視身分'), false, 'An inactive invalid account must not expose View As.');
      assert.equal(invalidSourceButtons.includes('代點餐'), false, 'An inactive invalid account must not expose delegated ordering.');
      assert.equal(invalidSourceButtons.includes('Mock Source Name'), false, 'An inactive invalid account must not expose name editing.');
    }
  } finally {
    devtools?.close();
    if (browser && browser.exitCode === null) browser.kill('SIGTERM');
    if (viteServer) await viteServer.close();
    if (browserProfile) rmSync(browserProfile, { recursive: true, force: true });
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
