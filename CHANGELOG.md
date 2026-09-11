# Changelog

## [Unreleased]

## [0.12.1] - 2026-09-11

### Changed

- Added authoritative employee ID display to the Admin View As selector and balance-management member table, with `未綁定` shown when no employee ID is present.
- Added header-aware employee ID mapping to the legacy GAS admin member response when the Users source explicitly provides an employee ID column.
- Preserved the existing role, floor, balance, View As, and top-up behavior while keeping the new table column within the existing mobile overflow container.

## [0.12.0] - 2026-09-11

### Added

- Added an explicit `EMPLOYEE_BIND_REQUIRED` state and binding-only capability set for canonical LINE identities that do not yet have an `employee_id`.
- Added direct employee binding for those identities through the existing server-validated `POST /api/auth/line-employee-bind` endpoint, without creating an Employee Guest session.

### Changed

- Kept employee binding, verification status, role, balance, and canonical user ownership separate; binding an employee ID does not promote an `UNVERIFIED` user.
- Kept the LINE-authenticated binding flow fail-closed on employee collisions and idempotent for same-user retries.

### Fixed

- Fixed LINE-authenticated canonical users without an employee ID being treated as an already-bound identity or being routed into the wrong unregistered flow.

## [0.11.3] - 2026-09-11

### Fixed

- Fixed Worker startup authentication resolution so a trusted LINE/LIFF identity is checked before restoring a cached Employee Guest session.
- Cleared stale guest credentials when LINE identity takes precedence, preventing mixed `line` and `employee_guest` authentication state.
- Routed existing canonical `UNVERIFIED` LINE identities to profile update and pending verification instead of recreating Employee Guest onboarding.
- Resolved stale Employee Guest sessions against an existing unverified canonical employee identity, with explicit lifecycle state instead of treating every `registered=false` response as a missing user.
- Kept `EMPLOYEE_ONBOARDING_CONFLICT` protection for direct duplicate or stale onboarding-create attempts while routing reconciled users to profile update.

## [0.11.2] - 2026-09-11

### Changed

- Kept LINE-bound and profile-completed `UNVERIFIED` identities in the onboarding-only flow until an approved verification transition occurs.
- Extended the self-profile update contract to persist both display name and pickup floor so the pending-verification profile survives refresh.

### Fixed

- Added visible success feedback after an `UNVERIFIED` profile update and clarified that the employee identity is still awaiting verification.
- Replaced the misleading completed-LINE-onboarding copy with explicit `LINE 綁定完成` and `員工身分待核驗` status messaging.

## [0.11.1] - 2026-09-11

### Added

- Added `POST /api/auth/employee-guest/onboarding` for completing provisional Employee Guest onboarding without a LINE authentication context.

### Changed

- Employee Guest provisional onboarding now creates an `UNVERIFIED` canonical user without requiring LINE authentication or creating a LINE binding; LINE binding remains limited to the LINE-authenticated onboarding flow.

### Fixed

- Fixed the provisional onboarding UI so a guest fallback no longer presents or invokes LINE binding as a required completion step.

## [0.11.0] - 2026-09-11

### Added

- Added a server-authenticated LINE employee identity lookup and explicit binding flow for first-time LINE sign-in.
- Added provisional onboarding for valid but unknown employee IDs as `UNVERIFIED` canonical users.
- Added centralized verification-aware authorization and capability derivation.
- Added provisional identity migration `0003` for verification state and nullable onboarding sessions.

### Changed

- Employee-number-only login is rejected with `LINE_LOGIN_REQUIRED` after an employee is bound to LINE, regardless of verification state.
- Restricted Employee Guest Login to the fallback flow where no LINE authentication context is available.
- Restricted `UNVERIFIED` principals to onboarding capabilities and denied ordinary application-data and privileged capabilities by default.
- Completed the remote canonical identity migration and applied the provisional identity migration to the formal D1 database.

### Fixed

- Made LINE binding, employee collision, and silent-rebind protection fail closed.

### Known Limitations

- The workbook still lacks `employee_id` and an approved employee mapping, so the full production employee import remains `BLOCKED`.

## [0.10.1] - 2026-09-10

### Fixed

- Fixed body-less Worker cancel POST parsing so `POST /api/orders/:orderId/cancel` no longer attempts to parse an absent JSON body.
- Improved API error classification so business, authentication, and server errors are not reported as network failures.

### Added

- Added a cancel-order detail confirmation modal before submitting a cancellation.
- Added a success confirmation before returning to the calendar after cancellation.

### Changed

- Prevented duplicate cancel submissions while a cancellation request is pending.
- Refresh order, calendar, and balance state after a successful cancellation.

## [0.10.0] - 2026-09-10

### Added

- Admin-only Worker announcement CRUD with authenticated list, create, update, and delete operations.
- Order-summary navigation and read access for registered users without granting unrelated administrative capabilities.

### Changed

- Removed the header balance label while preserving balance data, formatting, ledger, and management behavior.
- Made this Markdown file the canonical source for the complete release history.

## [0.9.0] - 2026-09-09

### Changes

- 改善頁首資訊與功能操作區的分層配置
- 送出訂單前新增訂單內容確認流程
- ProxyAdmin 新增開團設定權限
- 月曆管理更名為開團

**Commits:** none

## [0.8.0] - 2026-09-09

### Changes

- 後端由 Google Apps Script 遷移至 Cloudflare Workers，正式資料遷移至 Cloudflare D1，GAS 保留作回滾傳輸
- 啟用 Worker bootstrap、訂單、開團、餘額與管理 API，完成 Admin View As 讀取傳遞，Worker 模式不再靜默回退至 GAS
- 新增正式環境替換匯入與驗證流程，完成生產 workbook 匯入與 reconciliation，保留 opening-balance policy 與 quarantine 語意，未捏造歷史 ledger
- Bearer 身份由伺服器驗證、View As 授權由伺服器控管，正式 CORS 限制為 production Netlify origin

**Commits:** 3305217, 195a619, 4821970, 7317dc5, d145f16, 691cc59, de5f152, 2641c6d, 7fc7bee, 03f54c4

## [0.7.1] - 2026-09-04

### Changes

- 修正月份起始於週末時的月曆空白列
- 優化頁尾資訊與作者標示
- 公告詳情新增公告日期

**Commits:** none

## [0.7.0] - 2026-09-04

### Changes

- 新增首頁公告與公告詳情
- 支援同時查看多則有效公告
- 修正切換月份時月曆寬度不一致
- 統一已截止日期視覺狀態

**Commits:** none

## [0.6.0] - 2026-09-04

### Changes

- 預設領取樓層改為可點擊設定
- ProxyAdmin 移除餘額管理權限
- 新增版本號與開發歷程
- 放大餐點圖片並支援圖片預覽

**Commits:** none

## [0.5.0] - 2026-09-03

### Changes

- 建立集中式角色與權限模型
- 新增 Admin 的 View As 預覽功能
- 強化不同角色的操作隔離
- View As 模式禁止代替其他使用者執行寫入操作

**Commits:** 8f4d148

## [0.4.1] - 2026-09-03

### Changes

- 優化訂餐畫面更新體驗與訂單視覺提示
- 補強網站分享 metadata 與 OG 預覽圖片

**Commits:** fbfdfb0, 1efe300

## [0.4.0] - 2026-09-03

### Changes

- 交易明細支援依年份與月份查詢
- 增加月初餘額、月底餘額與當月收支統計

**Commits:** e669e04

## [0.3.0] - 2026-09-03

### Changes

- 增加 LINE 身份驗證與註冊狀態管理
- 強化未註冊、登入失敗與驗證異常處理
- 限制訂餐及資料操作必須通過身份驗證

**Commits:** fefde43

## [0.2.1] - 2026-09-03

### Changes

- 餐點支援圖片與菜單變體顯示
- 月曆排除週末，並支援特殊日期開團
- 增加訂購人資訊與餘額操作入口

**Commits:** 7be031b, d9cee3d

## [0.1.0] - 2026-09-02

### Changes

- 建立蔬食便當訂購核心流程
- 提供月曆、開團日期與菜單瀏覽
- 支援訂餐、取消訂單與基本管理資訊

**Commits:** fc3d963
