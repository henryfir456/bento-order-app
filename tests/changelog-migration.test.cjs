const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const repoRoot = path.join(__dirname, '..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
const changelogSourcePath = path.join(repoRoot, 'src', 'data', 'changelog.js');

const expectedHistory = [
  {
    version: '0.9.0',
    date: '2026-09-09',
    category: 'Changes',
    changes: [
      '改善頁首資訊與功能操作區的分層配置',
      '送出訂單前新增訂單內容確認流程',
      'ProxyAdmin 新增開團設定權限',
      '月曆管理更名為開團'
    ],
    commits: []
  },
  {
    version: '0.8.0',
    date: '2026-09-09',
    category: 'Changes',
    changes: [
      '後端由 Google Apps Script 遷移至 Cloudflare Workers，正式資料遷移至 Cloudflare D1，GAS 保留作回滾傳輸',
      '啟用 Worker bootstrap、訂單、開團、餘額與管理 API，完成 Admin View As 讀取傳遞，Worker 模式不再靜默回退至 GAS',
      '新增正式環境替換匯入與驗證流程，完成生產 workbook 匯入與 reconciliation，保留 opening-balance policy 與 quarantine 語意，未捏造歷史 ledger',
      'Bearer 身份由伺服器驗證、View As 授權由伺服器控管，正式 CORS 限制為 production Netlify origin'
    ],
    commits: ['3305217', '195a619', '4821970', '7317dc5', 'd145f16', '691cc59', 'de5f152', '2641c6d', '7fc7bee', '03f54c4']
  },
  {
    version: '0.7.1',
    date: '2026-09-04',
    category: 'Changes',
    changes: [
      '修正月份起始於週末時的月曆空白列',
      '優化頁尾資訊與作者標示',
      '公告詳情新增公告日期'
    ],
    commits: []
  },
  {
    version: '0.7.0',
    date: '2026-09-04',
    category: 'Changes',
    changes: [
      '新增首頁公告與公告詳情',
      '支援同時查看多則有效公告',
      '修正切換月份時月曆寬度不一致',
      '統一已截止日期視覺狀態'
    ],
    commits: []
  },
  {
    version: '0.6.0',
    date: '2026-09-04',
    category: 'Changes',
    changes: [
      '預設領取樓層改為可點擊設定',
      'ProxyAdmin 移除餘額管理權限',
      '新增版本號與開發歷程',
      '放大餐點圖片並支援圖片預覽'
    ],
    commits: []
  },
  {
    version: '0.5.0',
    date: '2026-09-03',
    category: 'Changes',
    changes: [
      '建立集中式角色與權限模型',
      '新增 Admin 的 View As 預覽功能',
      '強化不同角色的操作隔離',
      'View As 模式禁止代替其他使用者執行寫入操作'
    ],
    commits: ['8f4d148']
  },
  {
    version: '0.4.1',
    date: '2026-09-03',
    category: 'Changes',
    changes: [
      '優化訂餐畫面更新體驗與訂單視覺提示',
      '補強網站分享 metadata 與 OG 預覽圖片'
    ],
    commits: ['fbfdfb0', '1efe300']
  },
  {
    version: '0.4.0',
    date: '2026-09-03',
    category: 'Changes',
    changes: [
      '交易明細支援依年份與月份查詢',
      '增加月初餘額、月底餘額與當月收支統計'
    ],
    commits: ['e669e04']
  },
  {
    version: '0.3.0',
    date: '2026-09-03',
    category: 'Changes',
    changes: [
      '增加 LINE 身份驗證與註冊狀態管理',
      '強化未註冊、登入失敗與驗證異常處理',
      '限制訂餐及資料操作必須通過身份驗證'
    ],
    commits: ['fefde43']
  },
  {
    version: '0.2.1',
    date: '2026-09-03',
    category: 'Changes',
    changes: [
      '餐點支援圖片與菜單變體顯示',
      '月曆排除週末，並支援特殊日期開團',
      '增加訂購人資訊與餘額操作入口'
    ],
    commits: ['7be031b', 'd9cee3d']
  },
  {
    version: '0.1.0',
    date: '2026-09-02',
    category: 'Changes',
    changes: [
      '建立蔬食便當訂購核心流程',
      '提供月曆、開團日期與菜單瀏覽',
      '支援訂餐、取消訂單與基本管理資訊'
    ],
    commits: ['fc3d963']
  }
];

test('CHANGELOG.md preserves the complete pre-migration release history', async () => {
  const { isFormalRelease, parseChangelog } = await import('../src/data/changelogParser.js');
  const markdown = fs.readFileSync(changelogPath, 'utf8');
  const parsed = parseChangelog(markdown);
  const historical = parsed.filter((release) => (
    isFormalRelease(release) && !['0.10.0', '0.10.1', '0.11.0', '0.11.1', '0.11.2', '0.11.3', '0.12.0'].includes(release.version)
  ));

  assert.deepEqual(
    historical.map(({ version, date, categories, changes, commits }) => ({
      version,
      date,
      category: categories[0]?.name,
      changes,
      commits
    })),
    expectedHistory
  );
  const authStartupRelease = parsed.find((release) => release.version === '0.11.3');
  assert.ok(authStartupRelease);
  assert.equal(authStartupRelease.date, '2026-09-11');
  assert.deepEqual(authStartupRelease.categories.map(({ name }) => name), ['Fixed']);
  assert.deepEqual(authStartupRelease.changes, [
    'Fixed Worker startup authentication resolution so a trusted LINE/LIFF identity is checked before restoring a cached Employee Guest session.',
    'Cleared stale guest credentials when LINE identity takes precedence, preventing mixed `line` and `employee_guest` authentication state.',
    'Routed existing canonical `UNVERIFIED` LINE identities to profile update and pending verification instead of recreating Employee Guest onboarding.',
    'Resolved stale Employee Guest sessions against an existing unverified canonical employee identity, with explicit lifecycle state instead of treating every `registered=false` response as a missing user.',
    'Kept `EMPLOYEE_ONBOARDING_CONFLICT` protection for direct duplicate or stale onboarding-create attempts while routing reconciled users to profile update.'
  ]);
  assert.deepEqual(authStartupRelease.commits, []);
  const employeeBindingRelease = parsed.find((release) => release.version === '0.12.0');
  assert.ok(employeeBindingRelease);
  assert.equal(employeeBindingRelease.date, '2026-09-11');
  assert.deepEqual(employeeBindingRelease.categories.map(({ name }) => name), ['Added', 'Changed', 'Fixed']);
  assert.deepEqual(employeeBindingRelease.changes, [
    'Added an explicit `EMPLOYEE_BIND_REQUIRED` state and binding-only capability set for canonical LINE identities that do not yet have an `employee_id`.',
    'Added direct employee binding for those identities through the existing server-validated `POST /api/auth/line-employee-bind` endpoint, without creating an Employee Guest session.',
    'Kept employee binding, verification status, role, balance, and canonical user ownership separate; binding an employee ID does not promote an `UNVERIFIED` user.',
    'Kept the LINE-authenticated binding flow fail-closed on employee collisions and idempotent for same-user retries.',
    'Fixed LINE-authenticated canonical users without an employee ID being treated as an already-bound identity or being routed into the wrong unregistered flow.'
  ]);
  assert.deepEqual(employeeBindingRelease.commits, []);
  const finalized = parsed.find((release) => release.version === '0.10.0');
  assert.ok(finalized);
  assert.equal(finalized.date, '2026-09-10');
  assert.deepEqual(finalized.categories.map(({ name }) => name), ['Added', 'Changed']);
  assert.deepEqual(finalized.changes, [
    'Admin-only Worker announcement CRUD with authenticated list, create, update, and delete operations.',
    'Order-summary navigation and read access for registered users without granting unrelated administrative capabilities.',
    'Removed the header balance label while preserving balance data, formatting, ledger, and management behavior.',
    'Made this Markdown file the canonical source for the complete release history.'
  ]);
  assert.deepEqual(finalized.commits, []);
  const currentRelease = parsed.find((release) => release.version === '0.10.1');
  assert.ok(currentRelease);
  assert.equal(currentRelease.date, '2026-09-10');
  assert.deepEqual(currentRelease.categories.map(({ name }) => name), ['Fixed', 'Added', 'Changed']);
  assert.deepEqual(currentRelease.changes, [
    'Fixed body-less Worker cancel POST parsing so `POST /api/orders/:orderId/cancel` no longer attempts to parse an absent JSON body.',
    'Improved API error classification so business, authentication, and server errors are not reported as network failures.',
    'Added a cancel-order detail confirmation modal before submitting a cancellation.',
    'Added a success confirmation before returning to the calendar after cancellation.',
    'Prevented duplicate cancel submissions while a cancellation request is pending.',
    'Refresh order, calendar, and balance state after a successful cancellation.'
  ]);
  assert.deepEqual(currentRelease.commits, []);
  const uxRelease = parsed.find((release) => release.version === '0.11.2');
  assert.ok(uxRelease);
  assert.equal(uxRelease.date, '2026-09-11');
  assert.deepEqual(uxRelease.categories.map(({ name }) => name), ['Changed', 'Fixed']);
  assert.deepEqual(uxRelease.changes, [
    'Kept LINE-bound and profile-completed `UNVERIFIED` identities in the onboarding-only flow until an approved verification transition occurs.',
    'Extended the self-profile update contract to persist both display name and pickup floor so the pending-verification profile survives refresh.',
    'Added visible success feedback after an `UNVERIFIED` profile update and clarified that the employee identity is still awaiting verification.',
    'Replaced the misleading completed-LINE-onboarding copy with explicit `LINE 綁定完成` and `員工身分待核驗` status messaging.'
  ]);
  assert.deepEqual(uxRelease.commits, []);
  const fixRelease = parsed.find((release) => release.version === '0.11.1');
  assert.ok(fixRelease);
  assert.equal(fixRelease.date, '2026-09-11');
  assert.deepEqual(fixRelease.categories.map(({ name }) => name), ['Added', 'Changed', 'Fixed']);
  assert.deepEqual(fixRelease.changes, [
    'Added `POST /api/auth/employee-guest/onboarding` for completing provisional Employee Guest onboarding without a LINE authentication context.',
    'Employee Guest provisional onboarding now creates an `UNVERIFIED` canonical user without requiring LINE authentication or creating a LINE binding; LINE binding remains limited to the LINE-authenticated onboarding flow.',
    'Fixed the provisional onboarding UI so a guest fallback no longer presents or invokes LINE binding as a required completion step.'
  ]);
  assert.deepEqual(fixRelease.commits, []);
  const featureRelease = parsed.find((release) => release.version === '0.11.0');
  assert.ok(featureRelease);
  assert.equal(featureRelease.date, '2026-09-11');
  assert.deepEqual(featureRelease.categories.map(({ name }) => name), [
    'Added',
    'Changed',
    'Fixed',
    'Known Limitations'
  ]);
  assert.deepEqual(featureRelease.changes, [
    'Added a server-authenticated LINE employee identity lookup and explicit binding flow for first-time LINE sign-in.',
    'Added provisional onboarding for valid but unknown employee IDs as `UNVERIFIED` canonical users.',
    'Added centralized verification-aware authorization and capability derivation.',
    'Added provisional identity migration `0003` for verification state and nullable onboarding sessions.',
    'Employee-number-only login is rejected with `LINE_LOGIN_REQUIRED` after an employee is bound to LINE, regardless of verification state.',
    'Restricted Employee Guest Login to the fallback flow where no LINE authentication context is available.',
    'Restricted `UNVERIFIED` principals to onboarding capabilities and denied ordinary application-data and privileged capabilities by default.',
    'Completed the remote canonical identity migration and applied the provisional identity migration to the formal D1 database.',
    'Made LINE binding, employee collision, and silent-rebind protection fail closed.',
    'The workbook still lacks `employee_id` and an approved employee mapping, so the full production employee import remains `BLOCKED`.'
  ]);
  assert.deepEqual(featureRelease.commits, []);
  const unreleased = parsed.filter((release) => release.version === null);
  assert.equal(unreleased.length, 1);
  assert.equal(parsed[0].version, null);
  assert.deepEqual(unreleased[0].categories, []);
  assert.deepEqual(unreleased[0].changes, []);
  assert.deepEqual(unreleased[0].commits, []);
  const uiReleases = parsed.filter(isFormalRelease);
  assert.deepEqual(uiReleases.map((release) => release.version).slice(0, 5), ['0.12.0', '0.11.3', '0.11.2', '0.11.1', '0.11.0']);
  assert.equal(uiReleases.some((release) => release.version === null), false);
  assert.deepEqual(historical.map((release) => release.version), expectedHistory.map((release) => release.version));
  assert.equal(new Set(historical.map((release) => release.version)).size, expectedHistory.length);
});

test('changelog source is derived from the Markdown raw import', () => {
  const source = fs.readFileSync(changelogSourcePath, 'utf8');

  assert.match(source, /CHANGELOG\.md\?raw/);
  assert.match(source, /parseChangelog\(/);
  assert.doesNotMatch(source, /export const CHANGELOG = \[\s*\{/);
  assert.match(source, /UI_CHANGELOG_TRANSLATIONS/);
  assert.match(source, /APP_VERSION = CHANGELOG\.find\(isFormalRelease\)/);
  assert.match(source, /CHANGELOG\.filter\(isFormalRelease\)/);
  assert.match(source, /修正取消訂單失敗問題/);
});
