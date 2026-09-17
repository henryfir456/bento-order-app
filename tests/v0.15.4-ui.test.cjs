const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('balance history keeps month data semantics while defaulting the summary to collapsed', () => {
  const app = read('src/App.jsx');
  const modal = app.match(/餘額歷史異動 Modal[\s\S]*?historyList\.map/)?.[0] || '';

  assert.match(app, /const \[historySummaryExpanded, setHistorySummaryExpanded\] = useState\(false\)/);
  assert.match(app, /setHistorySummaryExpanded\(false\)/);
  assert.match(modal, /aria-expanded=\{historySummaryExpanded\}/);
  assert.match(modal, /setHistorySummaryExpanded\(\(expanded\) => !expanded\)/);
  assert.match(modal, /historySummaryExpanded &&/);
  for (const field of ['openingBalance', 'closingBalance', 'totalCredit', 'totalDebit']) {
    assert.ok((modal.match(new RegExp(`historySummary\\.${field}`, 'g')) || []).length >= 2, field);
  }
  assert.match(modal, /flex-1 overflow-y-auto/);
  assert.match(modal, /text-emerald-800/);
  assert.match(modal, /text-rose-800/);
});

test('employee entry remains a normal-user entry and explicit LINE entry is selectable', () => {
  const app = read('src/App.jsx');
  const boot = read('src/auth/bootFlow.js');

  assert.match(boot, /if \(hasGuestSession\) \{/);
  assert.match(boot, /return WORKER_AUTH_RESOLUTIONS\.EMPLOYEE_GUEST/);
  assert.match(app, /authMode === 'employee_guest'\s+&&\s+authState === AUTH_STATES\.UNVERIFIED/);
  assert.match(app, /guestSessionStore\.clearGuestSession\(\{ reason: 'line-login', notify: false \}\)/);
  assert.doesNotMatch(app, /reason: 'line-precedence'/);
  assert.match(app, /authMode === 'employee_guest'[\s\S]*?綁定 LINE/);
});

test('ProxyAdmin delegated date selection is bounded in the UI and Worker guard', () => {
  const app = read('src/App.jsx');
  const authorization = read('worker-poc/src/domain/orderAuthorization.js');
  const selectBlock = app.match(/const handleSelectDate = async \(dateStr\) => \{[\s\S]*?\n  \};/)?.[0] || '';

  assert.match(selectBlock, /delegatedOrderUser/);
  assert.match(selectBlock, /authUser\?\.role === 'ProxyAdmin'/);
  assert.match(selectBlock, /dateStr < formatDateInput\(new Date\(\)\)/);
  assert.match(authorization, /targetDate >= getTaipeiDate\(now\)/);
  assert.match(authorization, /DELEGATED_ORDER_DATE_NOT_ELIGIBLE/);
  assert.match(authorization, /const cutoffApplies = !adminBypass/);
  assert.doesNotMatch(authorization, /proxyDelegatedBypass && proxyDelegatedDateAllowed\)\);/);
});

test('Vendor Hub renders the canonical projected cutoff in both list and detail paths', () => {
  const hub = read('src/features/vendors/VendorHub.jsx');
  const model = read('src/features/vendors/vendorModel.js');

  assert.match(model, /latestVendorOrderingGroup/);
  assert.match(model, /formatVendorCutoff/);
  assert.match(model, /group\?\.deadline/);
  assert.equal((hub.match(/最後點餐時間/g) || []).length, 2);
  assert.match(hub, /formatVendorCutoff\(latestVendorOrderingGroup\(vendor\)\)/);
  assert.doesNotMatch(hub, /mode === ['"]B['"][\s\S]*18:00/);
});
