const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('repair API uses LINE credentials and sends exact preview concurrency fields', async () => {
  const clientSource = read('src/api/apiClientCore.js');
  assert.match(clientSource, /previewInvalidEmployeeRepair:[\s\S]*?invalid-employee-repair-preview/);
  assert.match(clientSource, /repairInvalidEmployee:[\s\S]*?invalid-employee-repair/);
  assert.match(clientSource, /getInvalidEmployeeRepairAudit:[\s\S]*?invalid-employee-repairs/);
  const { createApiClient } = await import('../src/api/apiClientCore.js');
  const calls = [];
  const api = createApiClient({
    env: { VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.example.test' },
    authClient: { getAccessToken: () => 'synthetic-line-admin-token' },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({ success: true });
    }
  });
  await api.previewInvalidEmployeeRepair({ sourceUserId: 'user-source-synthetic', targetUserId: 'user-target-synthetic' });
  await api.repairInvalidEmployee({
    sourceUserId: 'user-source-synthetic', targetUserId: 'user-target-synthetic',
    expectedSourceUpdatedAt: 'source-version-synthetic', expectedTargetUpdatedAt: 'target-version-synthetic',
    expectedSourceDisplayName: '合成來源帳號', expectedSourceEmployeeId: 'SYNTHETIC-EMPLOYEE-SOURCE',
    expectedTargetEmployeeId: 'SYNTHETIC-EMPLOYEE-TARGET',
    expectedSourceBalance: 150, expectedTargetBalance: 350,
    confirmTargetDisplayName: '合成目標帳號'
  });
  await api.getInvalidEmployeeRepairAudit();

  assert.equal(calls[0].options.method, 'GET');
  assert.equal(new URL(calls[0].url).searchParams.get('targetUserId'), 'user-target-synthetic');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-line-admin-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    targetUserId: 'user-target-synthetic',
    expectedSourceUpdatedAt: 'source-version-synthetic',
    expectedTargetUpdatedAt: 'target-version-synthetic',
    expectedSourceDisplayName: '合成來源帳號',
    expectedSourceEmployeeId: 'SYNTHETIC-EMPLOYEE-SOURCE',
    expectedTargetEmployeeId: 'SYNTHETIC-EMPLOYEE-TARGET',
    expectedSourceBalance: 150,
    expectedTargetBalance: 350,
    confirmTargetDisplayName: '合成目標帳號'
  });
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-line-admin-token');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer synthetic-line-admin-token');
});

test('repair detail exposes source and target preview, typed name confirmation, and audit query on desktop and mobile', () => {
  const member = read('src/features/balances/MemberBalanceManagement.jsx');
  const desktopStart = member.indexOf('<div className="hidden md:block');
  const mobileStart = member.indexOf('<div className="space-y-2 md:hidden">');
  assert.ok(desktopStart >= 0 && mobileStart > desktopStart);
  assert.match(member.slice(desktopStart, mobileStart), /<UserDetailsAction/);
  assert.match(member.slice(mobileStart), /<UserDetailsAction/);
  assert.match(member, /修正誤建員編/);
  assert.match(member, /預覽來源與目標/);
  assert.match(member, /INVALID_EMPLOYEE_ID/);
  assert.match(member, /輸入目標目前姓名以確認覆寫/);
  assert.match(member, /確認修復並記錄稽核/);
  assert.match(member, /目標的 LINE 綁定、員編、角色、樓層、餘額、訂單與歷史帳務都會保留/);
  assert.match(member, /查詢誤建員編修復稽核/);
  assert.match(member, /稽核編號：\{entry\.requestId \|\| entry\.auditId\}/);
  assert.match(member, /max-h-\[94dvh\]/);
  assert.match(member, /w-full rounded-xl bg-rose-800/);
  assert.match(member, /getInvalidEmployeeRepairMessage\(code\)/);
});

test('repair conflict codes have localized safe messages and a localized fallback', async () => {
  const { getInvalidEmployeeRepairMessage } = await import('../src/features/balances/invalidEmployeeRepairMessages.js');
  assert.match(getInvalidEmployeeRepairMessage('SOURCE_ROLE_NOT_REPAIRABLE'), /來源帳號角色/);
  assert.match(getInvalidEmployeeRepairMessage('SOURCE_INACTIVE'), /來源帳號已停用/);
  assert.match(getInvalidEmployeeRepairMessage('UNKNOWN_SYNTHETIC_CONFLICT'), /重新整理來源與目標/);
  assert.doesNotMatch(getInvalidEmployeeRepairMessage('UNKNOWN_SYNTHETIC_CONFLICT'), /UNKNOWN_SYNTHETIC_CONFLICT/);
});

test('App only exposes repair and audit to a LINE Admin outside View As and reloads members after success', () => {
  const app = read('src/App.jsx');
  assert.match(app, /canRepairInvalidEmployee=\{[\s\S]*?authMode === 'line'[\s\S]*?authUser\?\.role === 'Admin'[\s\S]*?!isViewAsMode[\s\S]*?\}/);
  assert.match(app, /onInvalidEmployeeRepairCompleted=\{\(\) => loadMemberBalances\(true\)\}/);
});
