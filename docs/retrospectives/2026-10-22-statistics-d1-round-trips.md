# 2026-10-22 — 足跡統計 API 逾時（D1 往返次數）
- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`、`perf/statistics-menu-read-cache`、[PR #146](https://github.com/henryfir456/bento-order-app/pull/146)；最終 head SHA 以 PR 頁面為準。獨立審查（非作者）對 `a160663` 結論 APPROVE_WITH_NITS，無 blocker／major；其 minor 意見（prefetch 失敗時未處理的 rejection、缺少 menu_item_changes 與 50 筆以上 ID 的測試、格式錯字、本欄位）已於後續 commit 處理。
- 本輪目標／實際修改：正式 Worker 部署（main `c8b42fe`）後，Admin 開啟「我的便當足跡」時 `/api/orders/statistics` 逾時。以每次請求範圍的唯讀快取及批次查詢，減少有效餐點名稱解析的 D1 往返；不改回傳內容、不改 schema、不改歷史訂單。
- 交付狀態：PARTIAL；程式與本地測試完成，修正後的正式 Worker 部署與線上實測 NOT VERIFIED。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 足跡頁停在「正在整理便當足跡…」，前端 15 秒逾時 | 效能／逾時 | 以 Admin 本人 LINE session 在內建瀏覽器量測：`period=month` 約 8 秒回 200；`period=all` 超過 35 秒仍未完成；客戶端 `apiClientCore.js` 逾時為 15 秒 | 以正式資料備份還原到本機並套 0015–0021 後重放：Admin 全部端點回 200（本機 SQLite 無網路延遲，無法重現） | 已驗證：逾時是慢查詢，不是授權；程式端每個不同「廠商＋日期」與每個不同 `menu_item_id` 各自循序查詢 D1。**推測**：正式 D1 單次往返延遲乘以查詢數是主因，尚未直接量測正式 D1 單次延遲 |
| 先前 Admin 403 | 授權（非回歸） | D1 `protected_account_access_audit` 有 `PROTECTED_ACCOUNT_VIEW_AS_BLOCKED` 紀錄且時間吻合 | 無需修改 | 已驗證：檢視受保護帳號被擋，符合 PR #134 設計 |

## 個資發布檢查
- PII_SCAN：差異與新增文字檔掃描 PASS；僅使用合成 fixtures，未加入真實員編、姓名、LINE ID、訂單資料、憑證或簽名 URL。
- 正式資料僅用於本機重放（暫存目錄，未提交、未上傳）；本文件只記錄耗時與筆數。

## 驗證
- 修正前 RED（同一測試檔、原始碼）：`node --test tests/order-statistics-query-budget.test.js`，exit 1，2 fail／1 pass：80 個不同廠商日期使用 253 次 D1 查詢；8→60 日查詢數由 61 增至 373。
- 修正後 GREEN（同一命令）：exit 0，5 pass／0 fail。含「快取與逐日查詢的有效菜單 deepEqual」覆蓋歷史廠商 SQL 版本、GAS 版本、無菜單廠商（150 組廠商／日期），以及 admin／GAS 變更列同日平手與停用的 60 個日期；另有 120 筆（超過單批 50 個 ID）含 NULL 菜單 ID 的統計案例。deepEqual 兩項是修正後的等價性檢查，在原始碼上也會通過（原始碼忽略 `readCache`），RED 由兩個查詢預算測試提供。
- `npm test --prefix worker-poc`：PASS，625/625，exit 0（含既有 vendor-rbac、vendor-operations、effective-order-item-name、historical-menu、menu-item-changes、order-statistics）。
- 未執行：根目錄前端 lint／build（本輪僅改 worker-poc，前端未變）。
- 正式 Worker 部署、修正後正式 API 耗時、Admin 足跡頁實測：NOT VERIFIED。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 統計 API 批次查詢（本 PR） | P0 | 本輪修正 | 本 PR | 正式部署後 `period=all` 在前端 15 秒內回應，結果與修正前一致 |
| `adminSummary.js`、`vendorOperations.js` 同樣使用有效名稱解析器，已自動受惠於快取，但未加 `prefetch` | P1 | 觀察；部署後量測實際耗時再決定 | 待量測 | 量測該兩 API 正式耗時，超過目標再另案 |
| 增加正式 API 耗時 smoke（足跡統計） | P2 | 另開 Issue 評估 | 待建立 | 發版 smoke 能在不輸出資料的前提下記錄耗時 |

## 下一輪預防
- 觸發條件：任何在迴圈內逐筆呼叫 D1 的讀取路徑（尤其對有大量歷史訂單的帳號）。
- 應追加的前置檢查／測試：對 D1 往返次數加「查詢預算」測試，使用帶計數器的測試資料庫並比較不同資料量；本機 SQLite 測試無法反映網路延遲，不能單以功能測試通過推定線上效能。
