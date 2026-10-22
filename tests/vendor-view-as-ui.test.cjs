const assert = require('node:assert/strict');
const { test } = require('node:test');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');

const loadMemberManagement = () => {
  const output = buildSync({
    entryPoints: [path.join(__dirname, '../src/features/balances/MemberBalanceManagement.jsx')],
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
    // The component imports the API client, which resolves its transport from the Vite env at module load.
    define: {
      'import.meta.env': JSON.stringify({
        DEV: false, VITE_API_TRANSPORT: 'worker', VITE_WORKER_API_URL: 'https://worker.test', VITE_AUTH_MODE: 'liff'
      })
    }
  });
  const module = { exports: {} };
  vm.runInNewContext(output.outputFiles[0].text, {
    module, exports: module.exports, require, URL, URLSearchParams, console, setTimeout, clearTimeout
  });
  return module.exports.default;
};

const member = (overrides) => ({
  userId: 'synthetic-user', employeeId: 'T0001', name: 'Synthetic Employee', role: 'User',
  active: true, lineBound: true, floor: '1樓', balance: 0, authSource: 'LINE', identityState: 'VERIFIED', ...overrides
});
const render = (members, props = {}) => renderToStaticMarkup(React.createElement(loadMemberManagement(), {
  memberBalances: members, canViewAsUser: true, canTopup: false, canBindEmployee: false, isViewAsMode: false, ...props
}));
const enabledViewAs = (markup) => (markup.match(/<button(?![^>]*\bdisabled\b)[^>]*>檢視身分<\/button>/g) || []).length;

test('Vendor accounts cannot be opened with View As from the phone card or the desktop table', () => {
  const markup = render([
    member({ userId: 'synthetic-employee' }),
    member({ userId: 'synthetic-vendor', employeeId: '', name: 'Synthetic Vendor', role: 'Vendor' })
  ]);
  // One enabled control per layout (desktop table + phone card) for the ordinary employee only.
  assert.equal(enabledViewAs(markup), 2, markup);
  assert.equal((markup.match(/廠商帳號不可檢視身分/g) || []).length >= 2, true, markup);
});

test('the View As selection modal gives Vendor rows the same disabled control and explanation', () => {
  const app = require('node:fs').readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');
  const modal = app.slice(app.indexOf("viewAsModalMode === 'view' && (user.role === 'Vendor'"));
  assert.ok(modal.length < app.length, 'modal Vendor branch missing');
  const vendorBranch = modal.slice(0, modal.indexOf('handleSelectViewAs(user)'));
  assert.match(vendorBranch, /disabled/);
  assert.match(vendorBranch, /廠商帳號不可檢視身分/);
  // handleSelectViewAs itself also refuses Vendor targets.
  assert.match(app, /!canAuth\('viewAsUser'\) \|\| user\.role === 'Vendor'\) return;/);
});

test('ordinary employees keep the View As control in both layouts', () => {
  const markup = render([member({ userId: 'synthetic-employee' })]);
  assert.equal(enabledViewAs(markup), 2, markup);
  assert.equal(markup.includes('廠商帳號不可檢視身分'), false);
});

test('Vendor accounts show no View As control when the viewer lacks View As permission', () => {
  const markup = render([member({ userId: 'synthetic-vendor', role: 'Vendor', employeeId: '' })], { canViewAsUser: false });
  assert.equal(enabledViewAs(markup), 0);
  assert.equal(markup.includes('廠商帳號不可檢視身分'), false);
});
