const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('LINE binding transfer uses authenticated Worker preview and commit contracts', () => {
  const client = read('src/api/apiClientCore.js');
  assert.match(client, /previewAdminLineBindingTransfer:[\s\S]*?line-binding-transfer-preview/);
  assert.match(client, /transferAdminLineBinding:[\s\S]*?line-binding-transfer/);
  const preview = client.slice(
    client.indexOf('previewAdminLineBindingTransfer:'),
    client.indexOf('transferAdminLineBinding:')
  );
  const commit = client.slice(client.indexOf('transferAdminLineBinding:'));
  assert.match(preview, /'GET'/);
  assert.match(preview, /credentialMode: 'line'/);
  assert.match(commit, /'POST'/);
  assert.match(commit, /credentialMode: 'line'/);
  assert.match(commit, /previewFingerprint/);
  const gasOperations = client.slice(client.indexOf('const createGasOperations'), client.indexOf('const createWorkerOperations'));
  assert.doesNotMatch(gasOperations, /line-binding-transfer/);
});

test('Worker client sends preview and commit with the LINE bearer and preview fingerprint', async () => {
  const { createApiClient } = await import('../src/api/apiClientCore.js');
  const calls = [];
  const api = createApiClient({
    env: {
      VITE_API_TRANSPORT: 'worker',
      VITE_WORKER_API_URL: 'https://worker.example.test'
    },
    authClient: { getAccessToken: () => 'admin-line-token' },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({ readyToTransfer: true, success: true });
    }
  });

  await api.previewAdminLineBindingTransfer({ sourceUserId: 'source-user', employeeId: '139700' });
  await api.transferAdminLineBinding({
    sourceUserId: 'source-user',
    employeeId: '139700',
    previewFingerprint: 'preview-fingerprint'
  });

  assert.equal(calls[0].options.method, 'GET');
  assert.equal(new URL(calls[0].url).pathname, '/api/admin/users/source-user/line-binding-transfer-preview');
  assert.equal(new URL(calls[0].url).searchParams.get('employeeId'), '139700');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer admin-line-token');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(new URL(calls[1].url).pathname, '/api/admin/users/source-user/line-binding-transfer');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer admin-line-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    employeeId: '139700',
    previewFingerprint: 'preview-fingerprint'
  });
});

test('transfer UI gives specific messages for blocked source accounts', async () => {
  const { getLineBindingTransferMessage } = await import('../src/features/balances/lineBindingTransferMessages.js');
  assert.match(getLineBindingTransferMessage('SOURCE_HAS_ORDERS'), /來源帳號有訂單紀錄/);
  assert.match(getLineBindingTransferMessage('SOURCE_HAS_TRANSACTIONS'), /帳務交易紀錄/);
  assert.match(getLineBindingTransferMessage({ code: 'TARGET_LINE_ALREADY_BOUND' }), /不會覆蓋/);
  assert.match(getLineBindingTransferMessage('LINE_BINDING_TRANSFER_STALE'), /重新取得移轉預覽/);
});

test('desktop and mobile user cards share the same view and transfer actions', () => {
  const member = read('src/features/balances/MemberBalanceManagement.jsx');
  const desktopStart = member.indexOf('<div className="hidden md:block');
  const mobileStart = member.indexOf('<div className="space-y-2 md:hidden">');
  const desktop = member.slice(desktopStart, mobileStart);
  const mobile = member.slice(mobileStart);

  assert.ok(desktopStart >= 0);
  assert.ok(mobileStart > desktopStart);
  assert.match(desktop, /<UserDetailsAction/);
  assert.match(mobile, /<UserDetailsAction/);
  assert.match(member, /檢視使用者/);
  assert.match(member, /canTransferLineBinding/);
  assert.match(member, /修正 LINE 綁定/);
  assert.match(member, /取得移轉預覽/);
  assert.match(member, /確認移轉 LINE 綁定/);
  assert.match(member, /role="dialog" aria-modal="true" aria-label="修正 LINE 綁定"/);
  assert.match(member, /只移轉 LINE 綁定/);
  assert.match(member, /onLineBindingTransferCompleted/);
  assert.match(member, /role="alert"/);
});

test('App exposes transfer only for a LINE-authenticated Admin and reloads the member list on success', () => {
  const app = read('src/App.jsx');
  assert.match(app, /canTransferLineBinding=\{[\s\S]*?authMode === 'line'[\s\S]*?authUser\?\.role === 'Admin'[\s\S]*?!isViewAsMode[\s\S]*?\}/);
  assert.match(app, /onLineBindingTransferCompleted=\{\(\) => loadMemberBalances\(true\)\}/);
});
