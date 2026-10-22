# 2026-10-22 — Admin 以廠商視角預覽
- Repository、分支、PR：`henryfir456/bento-order-app`、`feat/admin-vendor-preview`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：使用者希望 Admin 能看到禾拾（Vendor）登入後看到的畫面。現況查核：禾拾的 Vendor 登入別名已於 2026-10-22 正式轉換完成（#145），Admin 端已有「廠商每日訂單與轉帳對帳」可選廠商讀取同一份資料，但版面含管理功能，與廠商畫面不同。
- 實際修改：`VendorOperationsPage` 為 Admin 加上「以廠商視角預覽（唯讀）」切換。預覽時使用廠商版標題與版面、隱藏所有管理功能（登記轉帳、爭議處理、分攤更正、沖正），並顯示「確認收到」「提出爭議」但一律停用。資料仍走 Admin 讀取 API；不新增 Worker 路由、不借用或模擬廠商身分、不動正式資料。顯示規則抽成 `vendorOperationsView`。
- 交付狀態：PARTIAL；程式與本機測試完成，前端尚未發布（USER_RELEASE_PENDING，由使用者發布 Netlify）。版本：延後至下次發版批次，本 PR 不升版。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| `tests/vendor-hub.test.cjs` 第 4 項失敗 | 既有測試 | 以 `git stash` 在 main 基準執行同樣失敗（找不到「🏪 店家專區」字樣） | 未修改 | 已驗證與本修改無關；未調查其根因 |
| 本機 Mock 瀏覽器首次點擊被公告彈窗擋住 | 測試操作 | Playwright 回報彈窗攔截點擊 | 先關閉彈窗再操作 | 已驗證；屬預期的登入公告 |

## 個資發布檢查
- PII_SCAN：PASS（新增 diff）；測試與截圖只用 Mock 合成資料，未附加真實員編、user_id、LINE 識別。

## 驗證
- `CHROME_BIN=<本機 Chromium> node --test tests/vendor-operations-ui.test.cjs`：8 pass／0 fail（含新測試：Admin 預覽、Vendor、一般 User 的顯示規則，以及廠商動作停用）。
- `node --test tests/vendor-view-as-ui.test.cjs`：通過。
- 本機 Mock（Admin，手機寬度 390px）以 Playwright 截圖：預覽開啟後顯示「每日訂單與轉帳」與預覽說明，登記轉帳表單消失；關閉後恢復管理版面。Mock 當月無已登記轉帳，「確認收到」停用狀態只以單元測試驗證，畫面 NOT VERIFIED。
- `oxlint src/features/vendors`：exit 0。`vite build`：exit 0（既有大型 chunk 提示）。
- 未執行：正式環境 Admin 實測（前端未發布）。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 廠商本人真實 LINE 登入驗收 | P1 | 觀察（需廠商本人） | #145 | 禾拾以綁定的 LINE 登入後直接進入廠商工作台，只看到自己的資料 |

## 下一輪預防
- 觸發條件：使用者要求「Admin 看到某角色的畫面」。
- 應追加的前置檢查：先確認是否已有 Admin 讀取同一資料的入口，優先做唯讀版面切換，不借用或模擬對方身分。
