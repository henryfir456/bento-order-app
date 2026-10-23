# 2026-10-23 — D1 讀取筆數量測
- Repository、分支、PR：`henryfir456/bento-order-app`、`perf/d1-rows-read-metric`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：正式資料庫今日讀取超過免費每日額度，需要先量出哪些 API 讀最多，再決定優化。
- 實際修改：新增 `db/readMeter.js`，包住 D1 的 run/all/batch 加總 `meta.rows_read`，每個回應的 Server-Timing 加上 `d1-rows`，讀取 5,000 筆以上的請求寫一行 `d1_rows_read` 日誌。不改任何查詢與回應內容。
- 交付狀態：PARTIAL；需部署 Worker，再從瀏覽器 Network 或 Worker 日誌讀數字。

## 本輪阻礙
D1 的 `first()` 不回傳 meta，因此其讀取筆數未計入（查詢數有計）。

## 個資發布檢查
- PII_SCAN：PASS。

## 驗證
- 新增 `read-meter.test.js`；worker 測試 674 全過。
- NOT VERIFIED：正式環境的實際讀取數字。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 依量到的數字優化讀取最多的 API（索引、預先計算歸屬、快取） | P1 | 下一輪 | 待建立 | 足跡、月曆等主要 API 單次讀取降到萬筆以下 |

## 下一輪預防
- 觸發條件：新增跨月或全期間的彙總查詢。
- 應追加的前置檢查：先看 `d1-rows`，確認單次讀取筆數。
