# 2026-10-23 — 足跡與訂單明細改顯示中文規格
- Repository、分支、PR：`henryfir456/bento-order-app`、`claude/project-thread-dg7jzd`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：使用者要求足跡的餐點份數排行與 Admin 訂單明細，跟廠商畫面一樣不顯示 BASE／HALF，改在品名後顯示「（半飯）」。
- 實際修改：`formatOrderItemLabel`（Admin 訂單明細）與足跡排行改用廠商頁的 `vendorItemLabel`；店家名稱獨立顯示，規格不再顯示代碼。
- 交付狀態：PARTIAL；純前端，待使用者 Local 驗收並自行發布 Netlify，不需部署 Worker。

## 本輪阻礙
無。

## 個資發布檢查
- PII_SCAN：PASS；測試只用合成品名與店家。

## 驗證
- 見 PR 說明的實際測試輸出；正式畫面 NOT VERIFIED。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 承接 vendor-variant-labels 回顧提出的「Admin 每日彙總仍顯示 BASE」 | P2 | 本輪修 | 本 PR | 足跡與 Admin 訂單明細沿用同一套標籤 |

## 下一輪預防
- 觸發條件：任何畫面顯示品項規格。
- 應追加的前置檢查：一律經過 `vendorItemLabel`。
