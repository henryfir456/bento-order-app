# 2026-10-22 — 足跡排行：身份未確認的品項依原始名稱合併成一列
- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`、`fix/footprint-unresolved-grouping`；PR／head SHA 以 PR 頁面為準。
- 本輪目標／實際修改：`getOrderStatistics`（`worker-poc/src/domain/ordersRead.js`）對「身份未確認」的訂單行，不再以訂單編號＋行號各自成列，改以「店家＋品項代碼＋口味＋原始名稱＋單價」分組加總份數；已確認身份的品項分組方式不變，也不會與未確認品項合併。前端足跡頁標示改為「身份未確認，依原始名稱合併計算」。Admin 每日彙總（`adminSummary.js`）維持逐行不合併。不改資料、歷史訂單或 schema。
- 交付狀態：以 PR 合併與正式部署為準；正式足跡畫面實測前標 NOT VERIFIED。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 足跡排行同一道菜（例：蔡老師「特餐(半飯)」品項識別 C、禾拾「紅麴豆腐(半飯)」H3）重複多列，每列 1 份 | 顯示／分組 | 使用者截圖；`resolveEffectiveOrderItemName` 的未解析識別碼含 `fallbackKey`（訂單編號:行號） | 統計改用不含訂單編號的分組鍵 | 已驗證（程式）：未解析品項依設計每行獨立，排行因此每筆訂單一列；這些品項正是上兩輪留下的 `identity_mismatch`／無菜單 ID 案例 |
| 為何未解析 | 設計邊界 | 前一輪紀錄：訂單行代碼為基本代碼（C、H3），但名稱是半飯 | 不處理 | 名稱不是身份證據；要併入已確認的半飯品項需另行決定 |

## 個資發布檢查
- PII_SCAN：測試只用合成店家與公開菜單名稱；本文件不含員編、user_id 或 LINE 識別。

## 驗證
- RED：新增測試在修改前失敗（`order-statistics.test.js` 3 fail）。
- GREEN：`npm test --prefix worker-poc` 644/644；前端 `order-statistics-ui`、`effective-order-item-name-ui` 16 pass。
- 單價保留在分組鍵：同一舊代碼曾對應不同價格的不同菜（既有測試「重複碼舊快照」），因此不同單價仍分列。
- 未驗證：正式資料上合併後的列數；正式足跡畫面。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 代碼為基本款、名稱寫半飯的訂單行是否改認為半飯口味 | P2 | 待使用者決定 | 待決定 | 經核准的規則或資料修復，不改寫歷史快照 |
