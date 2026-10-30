const assert = require('node:assert/strict');
const { test } = require('node:test');

const load = () => import('../src/observability/authErrorReport.js');

const setup = (overrides = {}) => {
  const calls = [];
  const apiClient = {
    transport: 'worker',
    reportClientError: async (report) => { calls.push(report); },
    ...overrides.apiClient
  };
  const authClient = { isMock: false, isInClient: () => true, ...overrides.authClient };
  return { calls, apiClient, authClient };
};

test('failure is reported once with stage, code, status, LINE context and version', async () => {
  const { createAuthErrorReporter } = await load();
  const { calls, apiClient, authClient } = setup();
  const report = createAuthErrorReporter({ apiClient, authClient, appVersion: '0.19.25' });
  const error = Object.assign(new Error('Bearer secret-token rejected'), { code: 'TOKEN_INVALID', status: 401, kind: 'authentication' });
  report('AUTH_LINE', error);
  report('AUTH_LINE', error);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    { ...calls[0], detail: undefined },
    { stage: 'AUTH_LINE', errorCode: 'TOKEN_INVALID', httpStatus: 401, errorClass: 'authentication', inLine: true, appVersion: '0.19.25', detail: undefined }
  );
  assert.doesNotMatch(calls[0].detail, /secret-token/);
});

test('string failures fall back to the stage as the error code', async () => {
  const { createAuthErrorReporter } = await load();
  const { calls, apiClient, authClient } = setup();
  createAuthErrorReporter({ apiClient, authClient, appVersion: '1' })('BACKEND_IDENTITY_VERIFY_FAILED', 'backend 未回傳有效身份狀態');
  assert.equal(calls[0].errorCode, 'BACKEND_IDENTITY_VERIFY_FAILED');
  assert.equal(calls[0].httpStatus, null);
});

test('reporting is skipped for mock and non-worker transports and never throws', async () => {
  const { createAuthErrorReporter } = await load();
  const mock = setup({ authClient: { isMock: true } });
  createAuthErrorReporter({ ...mock, appVersion: '1' })('S', 'x');
  const gas = setup({ apiClient: { transport: 'gas' } });
  createAuthErrorReporter({ ...gas, appVersion: '1' })('S', 'x');
  assert.equal(mock.calls.length + gas.calls.length, 0);
  const broken = setup({ apiClient: { reportClientError: () => { throw new Error('boom'); } } });
  assert.doesNotThrow(() => createAuthErrorReporter({ ...broken, appVersion: '1' })('S', 'x'));
  const rejecting = setup({ apiClient: { reportClientError: () => Promise.reject(new Error('net')) } });
  assert.doesNotThrow(() => createAuthErrorReporter({ ...rejecting, appVersion: '1' })('S', 'x'));
});

test('a page load sends at most five distinct reports', async () => {
  const { createAuthErrorReporter } = await load();
  const { calls, apiClient, authClient } = setup();
  const report = createAuthErrorReporter({ apiClient, authClient, appVersion: '1' });
  for (let i = 0; i < 10; i += 1) report(`STAGE_${i}`, 'x');
  assert.equal(calls.length, 5);
});
