const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('mock account fixtures use synthetic employee IDs only', () => {
  const mockData = read('src/auth/mockData.js');
  assert.doesNotMatch(mockData, /employeeId:\s*['"]\d{5,}['"]/);
});

test('inactive or invalid members remain read-only when included in admin management', async () => {
  const { isActiveValidMember } = await import('../src/features/balances/identityStatus.js');
  const activeMember = { userId: 'synthetic-active-member', active: true, invalidReason: null };
  const invalidSource = {
    userId: 'synthetic-invalid-source',
    active: false,
    invalidReason: 'INVALID_EMPLOYEE_ID',
    authSource: 'EMPLOYEE',
    lineBound: false
  };
  assert.equal(isActiveValidMember(activeMember), true);
  assert.equal(isActiveValidMember(invalidSource), false);

  const member = read('src/features/balances/MemberBalanceManagement.jsx');
  assert.match(member, /if \(isViewAsMode \|\| !isActiveValidMember\(user\)\) return/);
  assert.match(member, /isViewAsMode \|\| !isActiveValidMember\(user\)/);
  assert.match(member, /canRepairInvalidEmployee && isActiveValidMember\(selectedUser\)/);
});

test('mock member ledger supports Admin detail view with synthetic read-only data', async () => {
  const { createApiClient } = await import('../src/api/apiClientCore.js');
  const { createMockGasApi } = await import('../src/api/mockGasApi.js');
  const createMockClient = (mockUser) => createApiClient({
    env: { DEV: true, VITE_AUTH_MODE: 'mock' },
    authClient: { isMock: true, getAccessToken: () => 'local-mock-session' },
    gasApi: createMockGasApi({ mockUser })
  });

  const response = await createMockClient('admin').getAdminUserLedger({
    userId: 'mock-repair-source-id', month: '2026-10'
  });
  const ledger = await response.json();
  assert.equal(response.status, 200);
  assert.equal(ledger.success, true);
  assert.equal(ledger.closingBalance, 0);
  assert.deepEqual(ledger.transactions, []);
  assert.equal(ledger.reconciliation.status, 'CONSISTENT');

  const denied = await createMockClient('user').getAdminUserLedger({
    userId: 'mock-repair-source-id', month: '2026-10'
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).message, 'ADMIN_LINE_AUTH_REQUIRED');
});

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

  await api.getMemberBalances({ includeInvalid: true });
  assert.equal(new URL(calls[3].url).searchParams.get('includeInvalid'), 'true');
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
  const identityReset = app.slice(app.indexOf('const clearIdentityData ='), app.indexOf('\n  const ', app.indexOf('const clearIdentityData =') + 1));
  assert.match(identityReset, /setIncludeInvalidMembers\(false\)/);
});

test('Admin can opt into disabled/invalid rows and the mock repair stays in local memory', async () => {
  const member = read('src/features/balances/MemberBalanceManagement.jsx');
  const app = read('src/App.jsx');
  assert.match(member, /包含停用／誤建帳號/);
  assert.match(app, /getMemberBalances\(\{ includeInvalid: canIncludeInvalid \}\)/);
  assert.match(app, /includeInvalidMembers/);
  assert.match(app, /apiClient\.transport === 'mock'/);

  const { createApiClient } = await import('../src/api/apiClientCore.js');
  const { createMockGasApi } = await import('../src/api/mockGasApi.js');
  const authClient = { isMock: true, getAccessToken: () => 'local-mock-session' };
  const api = createApiClient({
    env: { DEV: true, VITE_AUTH_MODE: 'mock' },
    authClient,
    gasApi: createMockGasApi({ mockUser: 'admin' })
  });

  const sourceUserId = 'mock-repair-source-id';
  const targetUserId = 'mock-repair-target-id';
  const before = await (await api.getMemberBalances()).json();
  const source = before.members.find((memberRow) => memberRow.userId === sourceUserId);
  const target = before.members.find((memberRow) => memberRow.userId === targetUserId);
  assert.equal(before.members.some((memberRow) => memberRow.userId === 'mock-disabled-synthetic-id'), false);
  assert.ok(source);
  assert.ok(target);
  const includedBefore = await (await api.getMemberBalances({ includeInvalid: true })).json();
  const disabledBefore = includedBefore.members.find((memberRow) => memberRow.userId === 'mock-disabled-synthetic-id');
  assert.equal(disabledBefore.active, false);
  assert.equal(disabledBefore.invalidReason, null);
  const preservedTarget = {
    employeeId: target.employeeId,
    lineBound: target.lineBound,
    role: target.role,
    floor: target.floor,
    balance: target.balance
  };

  const preview = await (await api.previewInvalidEmployeeRepair({ sourceUserId, targetUserId })).json();
  assert.equal(preview.readyToRepair, true);
  assert.equal(preview.changes.targetDisplayName, source.name);
  const repaired = await (await api.repairInvalidEmployee({
    sourceUserId,
    targetUserId,
    expectedSourceUpdatedAt: preview.source.updatedAt,
    expectedTargetUpdatedAt: preview.target.updatedAt,
    expectedSourceDisplayName: preview.source.displayName,
    expectedSourceEmployeeId: preview.source.employeeId,
    expectedTargetEmployeeId: preview.target.employeeId,
    expectedSourceBalance: preview.source.balance,
    expectedTargetBalance: preview.target.balance,
    confirmTargetDisplayName: preview.target.displayName
  })).json();
  assert.equal(repaired.success, true);
  assert.equal(repaired.auditRecorded, true);

  const defaultAfter = await (await api.getMemberBalances()).json();
  assert.equal(defaultAfter.members.some((memberRow) => memberRow.userId === sourceUserId), false);
  const includedAfter = await (await api.getMemberBalances({ includeInvalid: true })).json();
  const invalidSource = includedAfter.members.find((memberRow) => memberRow.userId === sourceUserId);
  const updatedTarget = includedAfter.members.find((memberRow) => memberRow.userId === targetUserId);
  assert.equal(invalidSource.active, false);
  assert.equal(invalidSource.invalidReason, 'INVALID_EMPLOYEE_ID');
  assert.equal(updatedTarget.name, preview.source.displayName);
  assert.deepEqual({
    employeeId: updatedTarget.employeeId,
    lineBound: updatedTarget.lineBound,
    role: updatedTarget.role,
    floor: updatedTarget.floor,
    balance: updatedTarget.balance
  }, preservedTarget);
  assert.equal((await (await api.getInvalidEmployeeRepairAudit()).json()).repairs.length, 1);

  const userApi = createApiClient({
    env: { DEV: true, VITE_AUTH_MODE: 'mock' },
    authClient: { isMock: true, getAccessToken: () => 'local-mock-session' },
    gasApi: createMockGasApi({ mockUser: 'user' })
  });
  assert.equal((await userApi.getMemberBalances({ includeInvalid: true })).status, 403);
  assert.equal((await userApi.previewInvalidEmployeeRepair({ sourceUserId, targetUserId })).status, 403);
  assert.equal((await userApi.getInvalidEmployeeRepairAudit()).status, 403);
});
