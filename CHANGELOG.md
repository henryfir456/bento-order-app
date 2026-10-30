# Changelog

## [Unreleased]

### Fixed
- Leave historical vendor IDs unresolved until an exact menu-version and effective-date mapping is reviewed; write canonical vendor IDs directly on new orders and scope settlement reads through verified attribution (Issues #104 and #139).
- Ignore pre-mapping settlement snapshots and allocations until their source is verified; cap verified settlement capacity by current canonical active-order attribution so stale snapshots cannot authorize excess, without rewriting legacy settlement rows (Issues #104 and #139).


- Restore mobile user-management sort field and direction controls using the same ordering state as desktop, and compact mobile actions including the ledger-details entry (Issue #82).
- Canonicalize the known historical menu code alias `R` to `FR` so effective-name summaries and footprint totals group the same verified dish across menu versions while preserving distinct vendor and variant identities (Issues #103 and #108).
- Return a generated `X-Request-Id` response header and show sanitized API error codes and trace IDs for announcement and vendor failures, without changing JSON response contracts.

- Prevent failed Android LINE LIFF initialization from being automatically retried by queued foreground/online events, avoiding repeated SDK success prompts. Preserve user-initiated retry (Issue #32; real-device acceptance pending).
- Align personal balance history filtering and monthly summaries with the Taipei time zone.
- Preserve the original `item_name` order snapshot in Admin summaries while rendering the shared effective label through `display_item_name` across detail, floor, and total tabs (Issue #103).
- Hide all inactive and explicitly invalid employee rows from the default Admin member list; allow only a LINE Admin outside View As to include them (Issue #111).

### Added

- Add a loopback-only Windows UAT launcher for the isolated Wrangler Worker and disposable D1, with generated local credentials, repeatable schema/seed reset, real HTTP acceptance checks, and optional USB ADB forwarding for Android. Local CORS excludes the formal frontend origin. The local test bundle has no Cloudflare account credentials, production bindings, cron triggers, or public login secrets.
- Protect the reserved vendor's existing LINE account through a controlled server-side mapping; fail closed with HTTP 503 until it resolves to exactly one active, valid, verified, LINE-bound canonical user, then block employee-only login, guest-session replay, rebinding, administrator reassignment, identity repair, and View As; redact its LINE ID from API responses and record deidentified denials without changing account or ledger records (Issue #122).
- 以鈴鐺收件匣取代首頁固定公告卡；載入失敗只提供重試、不顯示無公告，管理頁刷新也不觸發入場彈窗；舊公告不因功能上線或編輯而彈出（Issue #121）。
- 新增 Vendor 專用伺服器端身份與多店家成員範圍；角色及可用店家由 canonical principal 與有效 membership 派生，未新增真實帳號映射（Issue #123）。
- Add a Vendor daily-order and transfer reconciliation portal scoped by canonical vendor membership. Cutoff snapshots are append-only; Admin records completed manual transfers with multi-date/partial allocations, reasoned corrections and atomic reversals; Vendor acknowledgement/dispute events stay separate from order fulfillment, and no vendor settlement touches the employee balance ledger (Issues #123–#125).
- Add an isolated browser-memory mock fixture and Windows local UAT steps for #103, #108, and #111. Mock repair changes are discarded on reload.
- Add explicitly labeled, browser-memory-only Vendor and Admin settlement fixtures for local order, partial-transfer, dispute, correction, and reversal UAT; these do not authenticate with LINE or call the Worker or a bank (Issues #123–#125).
- Add a read-only formal Worker/D1 drift report and make the direct release runner stop when D1 migration state is not in sync; formal deployment remains a direct Wrangler or Cloudflare API action.

## [0.19.25] - 2026-10-30

### Fixed

- Return a retryable 503 `LINE_PROFILE_UNAVAILABLE` when the LINE profile request fails or LINE answers with a server error or rate limit, instead of a 401 token rejection, and retry the startup identity request once with a fresh LIFF token so a brief LINE hiccup no longer requires reopening the app.

## [0.19.24] - 2026-10-30

### Added

- Throttle repeated failed employee-code logins per client address (10 per 15 minutes, `LOGIN_RATE_LIMITED`, migration 0030); when `LINE_CHANNEL_ID` is set, the Worker also requires LINE access tokens to be issued to this app's channel; the login screen states what LINE data is read.

## [0.19.23] - 2026-10-29

### Added

- Show a one-time warning popup after login when the member balance is negative.

## [0.19.22] - 2026-10-29

### Changed

- The vendor 18:00 close notification (bell and LINE) now lists each dish with its portion count, largest first, after the order and portion totals.

## [0.19.21] - 2026-10-29

### Added

- Send each vendor principal a LINE push after the 18:00 close with the day's order and portion totals (bell unchanged). Vendors can switch it off in a new 「LINE 結單通知」 card in the vendor workbench; default on, stored as a `VENDOR_CLOSE` preference (migration 0029). Skipped without `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` or a LINE binding.

## [0.19.20] - 2026-10-29

### Changed

- Make unopened days on the Vendor ordering calendar stand out with red bold text, a red border and a light red background, add a calendar legend, and darken other vendors' text for contrast, so days that may become 禾拾 groups are easy to spot.

## [0.19.19] - 2026-10-29

### Added

- Let Admin promote a User to ProxyAdmin or demote a ProxyAdmin to User from the user details dialog. The role API now only moves User and ProxyAdmin accounts, rejects granting Admin or changing any Admin (including the caller), and keeps the `ROLE_UPDATED` audit record.

## [0.19.18] - 2026-10-29

### Fixed

- Skip the order reminder cron when `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` is not configured, without writing `order_reminder_log` rows, so fixing the secret does not leave users marked as already reminded.

## [0.19.17] - 2026-10-28

### Changed

- Show the 管理 entry to every registered non-vendor account; ordinary users see only 「LINE 通知設定」 there. Remove the LINE reminder block from the order page so the settings live in one place.

## [0.19.16] - 2026-10-28

### Changed

- Default the official-account add-friend button to the production account link; `VITE_LINE_OA_ADD_FRIEND_URL` still overrides it.

## [0.19.15] - 2026-10-28

### Added

- Move the LINE reminder switches for Admin/ProxyAdmin to a new 管理中心 「LINE 通知設定」 item (ordinary users keep them under the order calendar), add an official-account add-friend button (`VITE_LINE_OA_ADD_FRIEND_URL`), and let Admin/ProxyAdmin switch off the 10:00 蔡老師 close LINE push (bell unchanged, default on). Migration 0028 allows the `ADMIN_CLOSE` preference.

## [0.19.14] - 2026-10-28

### Added

- Add opt-in LINE order reminders: users can switch on a reminder per group type (蔡老師 same-day 10:00, and the previous-day 18:00 vendors such as 禾拾). A cron 10 minutes before each deadline (01:50 and 09:50 UTC) sends one LINE multicast to opted-in, LINE-bound users who have no active order yet. Reminders are deduplicated in `order_reminder_log`. Migration 0027 adds `user_reminder_prefs` and `order_reminder_log`; the two close-notification crons now share `0 2,10 * * *` to stay within five cron triggers.

## [0.19.13] - 2026-10-27

### Added

- Notify Admin and ProxyAdmin when the 蔡老師 group closes: a new 02:00 UTC (10:00 Taipei) cron writes a bell notification with the day's order and portion totals and sends one LINE Messaging API multicast when `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` is set (bell only otherwise). Migration 0026 adds the `ADMIN_ORDER_CLOSED` notification kind.

## [0.19.12] - 2026-10-26

### Fixed

- Keep an explicit HALF (半飯) variant on 禾拾 H-codes when normalizing the compatibility baseline, so a half-rice order stores its own menu item ID instead of NULL and no longer shows as an unresolved/ambiguous line in Admin and vendor order views. Also resolve existing lines saved without a menu item ID or variant when their snapshot label and price exactly match that code's HALF variant, so earlier half-rice orders display correctly without a data rewrite.

## [0.19.11] - 2026-10-24

### Fixed

- Start LINE login with a clean `redirectUri` (stale OAuth callback parameters removed) and show a hint when the WebView does not navigate within 6 seconds, addressing the Android LINE login "continue" button doing nothing (Issue #32; real-device acceptance pending).

## [0.19.10] - 2026-10-24

### Fixed

- Show 已截止・管理者可修改 instead of 訂餐中 on the order page when the cutoff has passed but an Admin's cutoff bypass still allows edits, so past days no longer look open.

## [0.19.9] - 2026-10-24

### Changed

- Show the order cutoff on the order page (for example "今天 10:00 截止・剩 1 小時 20 分", red in the last hour), refreshed every 30 seconds from the server deadline. The pickup floor and note fields stay on one row with a narrower floor column.

## [0.19.8] - 2026-10-24

### Changed

- Add shared `PageHeader`, `LoadingNote` and `ErrorNotice` components and use them on the Vendor hub; unify loading copy on 〇〇載入中…, drop decorative emoji from buttons and headings, and document the copy, button and icon rules in `docs/UI_GUIDELINES.md`.

## [0.19.7] - 2026-10-24

### Changed

- Merge the header name and default pickup floor into one tappable profile button, regroup the Admin management hub with daily tasks first (訂單總覽, 開團管理, 廠商對帳), and add a consistent ← 管理中心 link on every Admin sub-page.

## [0.19.6] - 2026-10-24

### Changed

- Rename the bottom-navigation entries to 我的足跡 (employee) and 售出足跡 (Vendor) so the two are no longer both labelled 足跡.
- Enlarge the order quantity buttons to a 40px touch target, unify empty-state wording on 尚無…, add a next step to the empty monthly order list, and use 重試 for inline error retry buttons.
- Replace the browser confirm dialog for deleting an announcement with the shared warning popup (cancel focused by default).

## [0.19.5] - 2026-10-24

### Fixed

- Restore the month picker on the Vendor 訂單總覽 and 對帳 tabs, which 0.19.3 hid together with the name-only heading card.

## [0.19.4] - 2026-10-24

### Changed

- Show the vendor name in the header, to the left of the logout button, on every Vendor screen, and drop the name-only card from the Vendor workbench. `GET /api/vendor/context` now also returns the vendor names the account may use.

## [0.19.3] - 2026-10-24

### Changed

- Remove the 廠商工作台 wording and the 重新整理 button and last-updated line from the Vendor screens: the header and card show only the vendor name, and switching tabs reloads the data.
- Show the vendor login code in the Admin member list (user management) in place of an employee ID for Vendor accounts, only to a LINE Admin.

## [0.19.2] - 2026-10-24

### Changed

- Cut D1 reads of the Vendor pages: vendor order attribution for legacy orders is now read from a cache table (migration 0025) that the Worker rebuilds lazily after a reviewed mapping or line identity is added, and the vendor month queries filter by date inside the attribution lookup. The full computation stays available as `vendor_order_vendor_attributions_live`. The calendar order-quantity totals also honor the requested date range.

## [0.19.1] - 2026-10-23

### Added

- Report D1 rows read and query count per request in the `Server-Timing` header (`d1-rows`) and log a `d1_rows_read` line for requests that read 5,000 rows or more, to find the endpoints that consume the daily D1 read quota. Rows from `first()` queries are not counted.

## [0.19.0] - 2026-10-23

### Added

- Show bell notifications for system events beside announcements: an Admin group cancellation with refund notifies each refunded buyer and the assigned vendor, and the 18:00 order close sends each vendor one summary of tomorrow's orders. Vendors now have the bell too. Migration 0024 adds `user_notifications`, and a new 10:00 UTC cron sends the vendor notice (`GET /api/me/notifications`, `POST /api/me/notifications/:id/read`).

### Changed

- Move the bell to the far right of the header and show the LINE binding badge only while the account is unbound.

## [0.18.0] - 2026-10-23

### Added

- Add a read-only vendor ordering calendar and a vendor sales footprint (全部／今年／本月, through yesterday, by dish and quantity, with amounts) beside the Vendor workbench; the Worker exposes only an allow-listed calendar shape and `GET /api/vendor/footprints` to Vendors (PRs #165 and #179).
- Split the Vendor workbench into Today, Orders and Settlement tabs, and let an Admin preview the Vendor layout read-only without Vendor actions (PRs #156 and #162).
- Add an Admin-reviewed history import for a vendor's pre-launch orders: a preview, a confirmation that records append-only menu-version and shop-name mappings (migration 0022 adds `vendor_legacy_name_mapping_events` and rebuilds the vendor attribution view), and a 歷史已結清 display for legacy-only days with no payment records or cutoff snapshots (PRs #166 and #170).
- Add a temporary, read-only Vendor code login behind `VENDOR_CODE_LOGIN_ENABLED` for testing; confirmation and dispute actions stay disabled and it can be locked by turning the flag off (PRs #163 and #164).
- Add a one-click Windows Vendor preview launcher for local Mock UAT and make local Worker UAT pick free ports (PRs #160 and #161).
- Add read-only legacy order line identity reports and a reviewed canonical identity overlay so old order lines read through verified identities in footprints, Admin summaries and the vendor month (PRs #171–#175).

### Changed

- Show dish names with Chinese variant labels (半飯, 加量) instead of `BASE`/`HALF` codes in footprints, Admin summaries and Vendor screens, and show the current menu name for the same dish everywhere (PRs #167, #175 and #177).
- Speed up footprint statistics and authentication by batching and parallelising D1 reads, skipping unused guest-session reads and adding `Server-Timing` (PRs #152–#155).
- Read a Vendor month in batched, concurrent D1 queries: about 170 sequential statements for a 20-day month become a few reads, cutting a 17 s simulated load to about 1 s (PR #169).

### Fixed

- Count COMPLETED imported legacy orders on past days in Vendor reads and the history import preview, matching the Admin summary, so vendors no longer see fewer portions than Admin (PR #178).
- Group unverified footprint lines by their raw label and count old base-code 半飯 lines as the HALF dish in footprints only, leaving Admin summaries and vendor settlement unchanged (PRs #158 and #159).
- Align the local Worker UAT seed with migration 0021 (PR #157).

## [0.17.3] - 2026-10-20

### Fixed

- 同店家、有效日期、legacy 品項碼與 variant 對應到多筆菜單時保留歧義；不以價格猜測身份，摘要與足跡各自保留未確認訂單列（Issues #103、#108）。
- Keep unresolved order snapshot lines in separate identity groups and expose a diagnostic in order summaries and footprints instead of merging by matching text (Issues #103 and #108).
- Recompute footprint portions, ranks, and meal-type counts from the effective menu identity, vendor, and variant; merge renamed entries across menu versions only when their stable identity is verified (Issue #108).
- Preserve each source order-name snapshot; after menu identity is verified, show the same effective name across detail, floor, and total views (Issue #103).

## [0.17.2] - 2026-10-17

### Added

- 管理端使用者明細新增誤建員編修復預覽、姓名二次確認、來源停用與管理員稽核查詢；保留目標帳號綁定與歷史資料（Issue #111）。

### Fixed

- 訂單總覽三個頁籤及便當足跡統一依店家、有效日期、穩定品項與規格解析餐點名稱；歧義時保留原快照，不改寫訂單、價格或帳務（Issues #103、#108）。

## [0.17.1] - 2026-10-16

### Fixed

- Honor the authorized read-only View As subject in personal bento footprints, clearing stale data when switching identities (Issue #101).

### Changed

- Animate the vendor pie chart as a one-time draw-in on data load, respecting reduced-motion accessibility settings.

## [0.17.0] - 2026-10-16

### Added

- Add a personal bento-footprints dashboard with Taipei-time statistics for portions, order days, meal types, vendor distribution and meal ranking (Issue #98).

## [0.16.9] - 2026-10-15

### Changed

- Show the pickup floor as a compact badge beside the vendor on My Orders cards, removing the standalone floor row (Issue #95).

## [0.16.8] - 2026-10-15

### Changed

- Simplify My Orders to one selected month with always-visible order details, without the all-month toggle or expand/collapse controls (Issue #93).
- Remove repetitive booked-status and change-order guidance; preserve nonstandard states, floor, items, amounts and optional notes.

## [0.16.7] - 2026-10-15

### Changed

- Reduce monthly ledger history work by querying transaction details within the requested Taipei-month range and loading only order details needed for that month (Issue #88).
- Keep immutable full-history sequence reconciliation intact using a lightweight history projection and preserve historical balance semantics.
- Use direct indexed date-range SQL predicates; add full Worker regression and repeatable synthetic SQLite benchmark.

## [0.16.6] - 2026-10-15

### Changed

- Defer offscreen calendar flavor thumbnails and decode images asynchronously without changing order/calendar behavior (Issue #89).
- Introduce reproducible JS/CSS asset size comparisons and opt-in Chrome Lighthouse mock-browser benchmark; report measurements without claiming real-device speedups.

## [0.16.5] - 2026-10-15

### Fixed

- Show actual order date for order and refund ledger entries from existing order-linked history data, distinct from the transaction timestamp; label missing historical dates as unavailable.
- Color positive ledger movements green and negative movements red, keeping zero neutral.
- Localize GROUP_CANCELLED and related internal transaction-description codes without rewriting ledger data.

## [0.16.4] - 2026-10-15

### Changed

- Reduce unnecessary calendar footer spacing while preserving the fixed bottom-navigation safe area.
- Remove the redundant wallet transaction-history refresh button; opening the wallet and changing months still load the ledger automatically.
- Hide the empty User and Accounts management section from roles with no authorized actions, without changing existing access permissions.

## [0.16.3] - 2026-10-14

### Changed

- Simplify the calendar status badges: ordered-and-closed displays 「已訂」, closed without an order displays 「截止」, and dates accepting orders display 「可訂」; preserve all existing status and cutoff logic.
- Add a visible 「返回」 action to the active order footer, returning to the same calendar month using the existing safe order-editor exit handler without submitting or cancelling an order.
- Remove the redundant My Orders refresh button; entering the My Orders tab still requests the latest data, with a retry action only after loading errors.

## [0.16.2] - 2026-10-14

### Changed

- Group the management hub into ordering, user/account, and settings sections without altering role permissions or action handlers.
- Rename the calendar switch section to Calendar Style and its user-management link to User Management. Retain Classic / Minimalist selector values and behavior.

## [0.16.1] - 2026-10-14

### Changed

- Rename the management UI-mode buttons from Classic Interface / New Interface to the concise labels Classic / Minimalist; keep the existing stored classic/modern mode keys and behavior unchanged.

## [0.16.0] - 2026-10-14

### Changed

- Consolidate the v0.15.24–v0.15.27 four-tab, classic/new UI switch, order history, live balance and administration experience into the next minor-version milestone without rewriting their original release history.
- Remove the visible system-title row from the mobile header and right-align the compact user, floor and LINE status. Retain an accessible screen-reader heading and View As / delegation banners.
- This release version is a source milestone only until the frontend is actually published and user / LINE device acceptance evidence is recorded.

## [0.15.27] - 2026-10-14

### Changed

- Remove the redundant vendor-menu link from the ordering calendar; the vendor area remains available in the management hub.
- Default My Orders to the current Taipei month, preserve month picker and show-all months control, and remove redundant descriptive text.
- Simplify wallet and management copy; hide View As and Delegate Order shortcuts from the Admin management hub while retaining their authorized user-center operations and ProxyAdmin actions.

## [0.15.26] - 2026-10-14

### Changed

- Simplify the top header to the system title and personal identity, remove duplicate top balance and management shortcuts, and keep vendor menus accessible from the order calendar.
- Show the authorized latest known numeric balance directly in the bottom wallet tab (without the word Balance); negative amounts appear red, and tapping still opens balance history.
- Consolidate management operations into a dedicated hub, including vendors, summaries, user center, proxy/view-as actions, announcements, menu maintenance and opening management according to role.
- Move the persistent classic/new calendar UI switch into management; no separate conflicting UI preference storage.

## [0.15.25] - 2026-10-14

### Added

- Automatically rank Cai Teacher menu items by confirmed order quantities: 70% recent 30-day popularity and 30% recent 90-day popularity, normalized across the active menu. Flavor Meal remains pinned ahead of the ranked items.
- Group post-migration normalized BASE/HALF variants (such as S and C) under one main-item popularity rank without modifying prices, selection IDs, historic orders or ledger.
- Ignore cancelled orders, other vendors and synthetic fee/refund/ancillary order rows; seed the requested S/C display order when no post-migration sales data is available.

### Changed

- Order-page Worker API includes per-item popularity ranks; React preserves the server order and keeps variants adjacent. Other vendors and historical order dates retain their existing order.
- Popularity is computed only from order dates on or after the normalized menu start (2026-09-17), using read-only D1 aggregation at request time; no schema change, migration or remote mutation is required.

## [0.15.24] - 2026-10-14

### Added

- Replace the initial bottom-button preview with four real mobile-first destinations: calendar ordering, canonical historical order snapshots with date filtering, personal balance/ledger, and permission-checked management.
- Add authenticated Worker order-history listing from the existing D1 orders and order-items records, including historical item names, quantity, price and status. Read-only View As and delegated target authorization reuse the current canonical identity rules.

### Changed

- Preserve the selected day when switching modern-calendar tabs; keep the order editor and its checkout controls separate from the tab bar.
- Support Android/iOS bottom safe-area, keyboard navigation, accessible active-tab states and explicit refresh/error/empty states.
- Reuse the existing Worker balance-history contract and admin center; no GAS fallback, no ledger mutation or historical rewrite.

### Verification boundary

- The User / Admin / ProxyAdmin and View As authorization paths require Worker contract and real-device acceptance. Frontend Netlify and backend Wrangler production deployments are independent and must be verified with external evidence.

## [0.15.23] - 2026-10-14

### Changed

- Open Admin member name editing and transaction details in modal dialogs so the user-management table stays in place.
- Return Admin to the unified user management center after finishing View As or delegated ordering when member-balance permission is available.
- In the modern calendar, unopened dates display the projected Cai Teacher daily flavor name when one exists, while status remains 未開團.

## [0.15.22] - 2026-10-14

### Changed

- Let Admin click an existing member name to change it via an audited, authenticated endpoint (no View As or guest mutation).
- Shorten the user-center bound-LINE badge to 已綁定 and unify member actions to icon-free, compact labels.
- Keep Cai Teacher's daily flavor name and image in modern calendar day details; display HeShi only by vendor name without extra menu lookups or images.

### Verification boundary

- User-name edit adds a formal Worker endpoint and needs Wrangler production deployment and post-deployment verification; Netlify frontend publication and Android acceptance are separate gates.

## [0.15.21] - 2026-10-14

### Changed

- Consolidate the user management desktop table into five columns: employee ID/name, role/LINE binding, floor, balance, and actions; keep balance ascending by default and sortable.
- Place the read-only transaction history action alongside each user and retain the existing Admin ledger authorization.
- Hide duplicate Admin View As and delegate-order header shortcuts; keep ProxyAdmin delegate-order access and existing per-user privileged actions.

## [0.15.20] - 2026-10-14

### Fixed

- Restore visible User Management Center naming on the existing balance-management entry; retain the unified member list and original authorization.
- Remove the modern calendar next-orderable-day card, show meal/vendor labels in date cells, and display the weekday with selected dates.
- Read vendor-specific daily menu items and images through the existing authenticated order-page API, avoiding Cai Teacher daily-flavor content for HeShi.

### Verification boundary

- Admin-only preview and classic fallback remain unchanged; front-end deployment and Android LINE acceptance must be verified separately.

## [0.15.19] - 2026-10-13

### Added

- Add an Admin-only modern calendar preview with a compact weekday grid, full selected-day details, menu image, clearer order states, and a next-orderable-day shortcut.
- Allow Admin to switch between classic and modern calendar experiences while retaining the classic calendar for all other users; persist only the presentation preference locally.

### Verification boundary

- Both views reuse the existing date-selection/order workflow and Worker/D1 identity, order and wallet contracts. Admin group-management mode uses the classic calendar.
- Android LINE real-device acceptance, frontend deployment and automated CI evidence are separate delivery gates.

## [0.15.18] - 2026-10-13

### Added

- Add read-only Admin user balance and monthly transaction history, guarded by canonical Admin authorization and audit logging (Issue #46, PR #47).
- Allow Admin to open a user's monthly ledger directly from the existing View As user picker, without switching identity (PR #50).
- Add employee-number filtering to the View As user picker; reuse the same search behavior as delegated ordering (PR #51).
- Introduce a unified user management center that shares the member search/list and surfaces existing View As, delegated ordering, top-up, LINE binding, and ledger actions according to their original permissions (first-stage coexistence, without removing legacy entrances).

### Changed

- Hide repetitive identity-state labels in balance management, View As, and delegated-order user listings, retaining LINE binding badges, underlying identity state and authorization (PR #51).
- Replace the All/Negative balance chips with sortable user-management columns, defaulting to ascending balance, with the same order on mobile (PR #52).

### Verification boundary

- These entries retrospectively document merged Admin UI/API changes from PR #47, #50, #51 and #52 as well as the new first-stage management center.
- New unified entry points continue to invoke existing privilege-checked handlers. Existing separate entry points remain during acceptance; this release does not claim completed production Netlify deployment or manual acceptance.

## [0.15.17] - 2026-10-12

### Fixed

- Retain Android LINE LIFF foreground-return signals during an ongoing login selection and drain them after authentication boot settles (Issue #32; Android device acceptance pending).
- Reduce the overall authentication boot timeout from 60 seconds to 30 seconds; preserve bounded retry behavior and regression coverage.

Repository convergence (2026-10-10): preserve dated MaiFood feasibility research and its superseding Not planned decision for Issue #36. Internal MANUAL implementation PR #38 and UI PR #39 are paused/closed without merge or deployment, retaining their branches and commits. Previously merged identity/LIFF/month-filter fixes are not reapplied; real LINE acceptance remains pending. This is repository documentation and maintenance, with no new runtime release or production data mutation.

## [0.15.16] - 2026-10-11

### Fixed

- Preserve the selected BASE/HALF menu variant when creating an admin menu change (Issue #41).

## [0.15.15] - 2026-10-10

### Fixed

- Project canonical `lineBound` independently of login channel in Worker identity/bootstrap and guest responses, without exposing the bound LINE ID through employee sessions (Issue #34; regression coverage for Issue #1).
- Use the same binding badge in the home header and member cards; offer LINE binding only to a confirmed unbound employee session, with unknown state shown as awaiting confirmation.
- Clear stale employee credentials after successful LINE-first binding, and revoke expired/rejected sessions from the displayed identity.
- Refresh registered binding state on foreground/network return using a bounded, coalesced GET; stale attempts cannot replace newer login choices, balances, profiles or View As subjects.

### Verification boundary

- Implementation and local automated verification are independent of real LINE browser validation. Windows external/local LINE OAuth and Android LINE acceptance remain NOT VERIFIED without platform evidence.
- Initial merge snapshot: this release was merged as code only by explicit request, with no frontend or formal Worker deployment, no production D1 mutations, and no claim that the UI/API change was live at that stage.

Subsequent deployment update (2026-10-10 00:55 UTC): [Issue #34 deployment evidence](https://github.com/henryfir456/bento-order-app/issues/34#issuecomment-6091882504) records formal `bento-api-poc` Worker version #68 `c4ea0453-5ce8-4333-b919-8a58a6b38fab` deployed from main `5dd8667360f522c012a338641bd7ec584dab1ef4` (deployment `6d98a02d-a0f5-49b4-8a7f-b3a5f614d8c2`, 100% traffic), with bounded read-only health/auth/CORS smoke PASS. The frontend remained undeployed and real Windows/Android LINE and View As acceptance remained NOT VERIFIED. Later repository convergence does not deploy or mutate production data; this note records the historical deployment rather than a new live-version check.

## [0.15.14] - 2026-10-09

### Fixed

- Bound LIFF initialization, Worker request headers/body, and the complete authentication boot so a stalled startup exits loading and offers reconnect without closing the page (Issue #32).
- Retain and coalesce OAuth/background return and online recovery events, with attempt ownership preventing old results or cleanup from replacing a newer LINE or employee entry.
- Preserve explicit employee guest selection, avoid automatic login redirect loops, and consume explicit LINE binding intent before POST so ambiguous failures are not automatically replayed.
- Bound the formal Worker's LINE profile verification, including its response body; timeouts fail closed with retryable HTTP 503 instead of waiting indefinitely.

### Verification boundary

- Automated startup simulations exercise the actual App orchestration; Android LINE first-open behavior remains pending real-device verification.
- Frontend source is updated and merged only. Frontend deployment is excluded by user instruction; Worker deployment is reported separately.

## [0.15.13] - 2026-10-06

### Changed

- Treat Admin 「不開團」 as a full group cancellation: all ACTIVE orders for that date are cancelled and fully refunded, including after the normal ordering cutoff.
- Show a destructive-action confirmation before closing a group, including order count, meal quantity, total amount, and an explicit full-refund warning.

### Fixed

- Keep group cancellation atomic across refunds, order status history, order cancellation, calendar closure, and Admin audit logging.
- Prevent repeated group cancellation from issuing duplicate refunds; dates with no active orders still close normally.

## [0.15.12] - 2026-10-05

### Fixed

- Show the matching daily flavor image on unopened dates that have an explicit empty-vendor calendar setting, while preserving holiday and other-vendor image guards.

## [0.15.11] - 2026-10-05

### Fixed

- Show the matching Cai Teacher daily flavor image on unopened calendar dates as well as open dates, while continuing to hide holiday and makeup-holiday images.

## [0.15.10] - 2026-10-05

### Added

- Added Cai Teacher daily flavor thumbnails to calendar dates when the matching date is open for that vendor; official holidays, makeup holidays, and unopened dates do not show a thumbnail.
- Added click-to-enlarge calendar image previews with Escape, backdrop, and close-button dismissal.

## [0.15.9] - 2026-10-04

### Added

- Added Cai Teacher daily flavor synchronization for date-specific meal names, descriptions, and images without changing canonical menu item IDs or prices.
- Added optional ordered image snapshots to announcements and rendered them in Admin management and public announcement detail.
- Added employee-ID search to balance and identity management.
- Added previous/next navigation between configured order dates directly on the order page.
- Added the date-specific Cai Teacher flavor name to calendar cells for unopened dates and Cai Teacher groups so users can decide whether to vote/order without opening the order page.
- Simplified the order-page date header by removing the redundant "預訂日期" label.

### Changed

- Persist eligible LINE ownership after employee resolution so subsequent LINE sign-ins resolve directly to the canonical User.
- Refresh public announcement state after Admin announcement changes so image edits appear in the same session.
- Hardened Cai Teacher source synchronization with browser-compatible request headers after the official site rejected minimal Cloudflare fetches.

### Refactored

- Extracted low-risk pure helpers from App.jsx into auth, bootstrap, order, and balance feature modules.


## [0.15.8] - 2026-10-03

### Fixed

- Restored order-summary read access for normal Users signed in through employee ID (`employee_guest`) so employee-ID and LINE entry points expose the same read-only order overview.
- Added regression coverage for employee-guest order-summary access while keeping privileged administration capabilities denied.

### Changed

- Renamed the user-facing 「訂單管理」 surface to 「訂單總覽」 to reflect that the page is read-only.

### Security

- Kept member balances, top-up, calendar/vendor administration, role management, announcements, and View As unavailable to employee-guest sessions.

## [0.15.7] - 2026-09-18

### Added

- Added a real-world README showcase with representative calendar, ordering, and Admin order-management screens.
- Added optimized screenshot assets under `docs/screenshots/` so the end-to-end lunch-ordering workflow is easier to understand at a glance.

## [0.15.6] - 2026-09-17

### Changed

- Added ordered tabs for admin order management: 全部明細, 樓層明細, and 餐點匯總, with 全部明細 as the default while preserving the existing view content and aggregation logic.
- Set 台灣 Pay as the default top-up method and initialized the editable note with the current Taipei date in M/D收款 format.

## [0.15.5] - 2026-09-17

### Fixed

- Fixed fresh employee-ID onboarding continuing into the LINE binding flow after the canonical normal User and employee guest session were created.
- Normal Users registering for the first time with employee ID can now enter the main UI and use general ordering without mandatory LINE binding.
- Kept LINE binding optional while preserving strict Admin / ProxyAdmin identity and authorization protection.

## [0.15.4] - 2026-09-17

### Changed

- Compact the mobile personal balance and transaction summary by default while preserving month navigation and balance semantics; the complete four-card summary remains available on expansion.
- Relaxed normal-user authentication so a `User` can use LINE or employee ID, alternate between both entries, and resolve both entries to the same canonical user without creating duplicates.
- Removed LINE binding as a prerequisite for normal-user employee onboarding; LINE binding remains an optional identity enhancement.
- Extended ProxyAdmin delegated ordering to today and future eligible open dates while retaining calendar, menu, cutoff, authorization, and mutation protections.
- Added the canonical calendar-derived last-order time to Vendor Hub list and detail views.

### Security

- Kept Admin and ProxyAdmin on strict verified identity authentication; employee-only and `employee_guest` paths cannot obtain elevated roles, capabilities, or admin bootstrap.
- Kept existing LINE ownership immutable during normal-user session resolution, including ownership conflicts.

### Fixed

- Fixed residual employee-login routing and state precedence that could incorrectly require LINE binding for a normal User.
- Preserved the existing LINE ownership, calendar/menu, and mutation protections while applying the bounded changes.

## [0.15.3] - 2026-09-17

### Changed

- Relaxed normal-user authentication so a `User` can sign in with either LINE or employee ID, alternate between both entry points, and resolve both paths to the same canonical user without creating duplicates.
- Allowed a normal User with an existing LINE binding to continue using employee-ID login, and allowed employee-authenticated users to use LINE without making LINE binding a mandatory application prerequisite.
- Kept existing LINE ownership immutable when a normal User session is resolved through an employee-ID or LINE employee entry, including ownership conflicts.
- Allowed normal Users to access general ordering after completing employee onboarding with an employee lookup, display name, and pickup floor.

### Security

- Kept Admin and ProxyAdmin on the strict verified LINE and identity policy; employee-only and `employee_guest` authentication cannot obtain elevated roles, capabilities, or admin bootstrap.

### Fixed

- Fixed the LIFF completion callback/state refresh so the same session enters the normal main UI after completion, and corrected the `lineUserId` state refresh.
- Fixed the 2026-09-21 normalized menu overlay to retain the persisted `menu_item_id`, avoiding synthetic menu-item IDs that caused order foreign-key failures to surface as `MUTATION_CONFLICT`.
- Preserved the existing mutation and optimistic-concurrency protections.

## [0.15.2] - 2026-09-16

### Added

- Added live employee ID filtering to the delegated ordering member selector.

### Changed

- Changed balance management to provide `全部／負餘額` filtering.
- Adjusted Admin / ProxyAdmin role display in the header.
- Extended personal profile maintenance to edit display name and default pickup floor.
- Added quick previous/next date navigation to order management.
- Grouped the purchase summary by pickup floor.
- Improved Vendor Hub card layout so the description has more available width.

## [0.15.1] - 2026-09-16

### Added

- Added migration 0011 for explicit legacy/raw and normalized menu identity versions with persisted append-only revision ordering.
- Added normalized BASE/HALF/PLUS menu correction support from the 2026-09-17 effective-date boundary, including atomic normalized variant moves.

### Changed

- Kept historical menu changes, menu snapshots, orders, and order items immutable while resolving legacy codes into future normalized projections only.
- Made Admin current-menu selection auto-load by vendor/date, kept ordinary item codes read-only, and removed the manual query action.

## [0.15.0] - 2026-09-16

### Added

- Added Vendor Hub for browsing vendor details, menu images, and external menu links.
- Added vendor metadata management for Admin and ProxyAdmin users.
- Added canonical vendor handling to avoid duplicate vendor entries.

### Changed

- Added click-to-zoom lightbox viewing for Vendor Hub menu images.
- Added menu thumbnails to vendor cards for quick click-to-zoom menu viewing.
- Improved menu preview and close interactions across desktop and mobile layouts.

## [0.14.2] - 2026-09-15

### Added

- Added separate Admin current-menu and append-only change-history views, with the current menu using the same effective-date canonical resolver as customer ordering.
- Added Worker-backed canonical vendor options for menu maintenance filters and entries.

### Changed

- Removed the redundant vendor column from the menu change-history view because vendor is selected above the table.
- Reworked menu maintenance tables into responsive desktop tables and mobile compact cards to avoid unnecessary horizontal scrolling.

### Fixed

- Fixed imported baseline menu items, including `咖哩鷹豆泥`, being absent from the primary Admin maintenance view even though they were available to customers.

## [0.14.1] - 2026-09-15

### Changed

- Added delegated-order support for valid active canonical members without a LINE binding.
- Added Chinese personal transaction labels and historical order date, vendor, item, and quantity details.
- Fixed stale header balances after creating or cancelling an order.

## [0.14.0] - 2026-09-15

### Added

- Added explicit delegated ordering for Admin and ProxyAdmin with server-authoritative target, role, date, and cutoff enforcement.
- Added target discovery and delegated-order controls while keeping View-As read-only and separate.

### Changed

- Admin self-ordering and delegated ordering bypass ordinary date and cutoff restrictions; ProxyAdmin delegation is limited to today in Asia/Taipei and bypasses the cutoff while self-ordering keeps the normal rules.
- Delegated orders retain target ownership and target balance debit/refund, leave the actor balance unchanged, and preserve actor/target provenance in existing audit and ledger records.
- Kept COMPLETED, readOnly, and finalized historical orders immutable for every role.

## [0.13.0] - 2026-09-11

### Added

- Added Worker + D1 authoritative identity projections for `authSource`, `identityState`, and the informational legacy `verificationStatus` in Admin member and View As reads.
- Added the Admin-only `POST /api/admin/users/:userId/employee-binding` contract with registered-LINE capability checks, canonical employee-ID uniqueness, idempotent same-user retries, and audit logging.
- Added the guarded atomic provisional employee claim: historical employee_guest provenance, dependency checks, SQL-level rollback assertions, session revocation, retirement, and `PROVISIONAL_EMPLOYEE_CLAIMED` audit lineage.
- Retained `employee_roster` and `verification_status` as compatibility data without making them active LINE access prerequisites.

### Changed

- Active LINE canonical users with `employee_id` are immediately registered and receive their stored canonical role capabilities, regardless of historical verification status.
- Active LINE users without an employee ID remain in `EMPLOYEE_BIND_REQUIRED`; employee_guest users remain guest-only even when their stored role is privileged.
- Provisional ownership is claimable only through the server decision tree; every other existing owner remains `EMPLOYEE_ID_ALREADY_BOUND`, and unsafe business ownership fails closed.
- Made Worker + D1 the only production transport for this feature. GAS remains retired legacy regression evidence and receives no new identity contract.

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
