# 2026-10-24 — 廠商歸屬快取（降低 D1 讀取）
- Repository、分支、PR：`henryfir456/bento-order-app`、`perf/vendor-attribution-cache`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：正式資料庫單日讀取超過免費額度。用 D1 查詢分析找出前幾名都經過 `vendor_order_vendor_attributions` 視圖；它每次都重算所有舊訂單的歸屬，廠商月曆一次約讀 2.6 萬筆。
- 實際修改：
  - migration 0025：完整計算改名為 `vendor_order_vendor_attributions_live`；新增 `vendor_legacy_attribution_cache`（含訂單日期與索引）與狀態表；原名稱視圖改成「直接歸屬 ＋ 快取」；對照事件與逐行身分表有新增時，觸發器標記快取過期。migration 當下用 live 視圖填一次快取。
  - Worker：`ensureAttributionCache` 在廠商與管理員的廠商 API 驗證後檢查狀態列，過期才在一個批次內重建；匯入過往訂單後立即重建。
  - 廠商月份、日期清單、調整原因查詢加上歸屬日期範圍條件，查詢計畫改為用索引搜尋；月曆訂購份數統計依 from/to 範圍讀取。
  - 舊訂單身分報表腳本改讀 live 視圖。
- 交付狀態：PARTIAL；需套用 migration 0025（會寫入衍生的快取資料表，屬正式資料庫變更）並部署 Worker，再用 Server-Timing 的 `d1-rows` 比對前後讀取筆數。

## 本輪阻礙
無。

## 個資發布檢查
- PII_SCAN：PASS；只用合成資料。

## 驗證
- 新增 `vendor-attribution-cache.test.js`：未審核前快取為空、對照新增後延遲重建、撤銷後重建、快取內容與 live 視圖一致。worker 測試全過。
- 以 EXPLAIN QUERY PLAN 確認廠商月份查詢改為索引搜尋，不再掃描全部訂單。
- NOT VERIFIED：正式環境讀取筆數（待部署）。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 之後匯入沒有直接歸屬的舊訂單時，需呼叫快取重建（目前只有對照與身分表會觸發） | P2 | 觀察 | 待建立 | 舊資料大整理完成後移除快取或改為完整觸發 |

## 下一輪預防
- 觸發條件：新增會被大量呼叫的彙總視圖。
- 應追加的前置檢查：先用 EXPLAIN QUERY PLAN 確認沒有全表掃描，並看 Server-Timing 的 d1-rows。
