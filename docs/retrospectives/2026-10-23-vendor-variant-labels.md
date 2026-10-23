# 2026-10-23 — 廠商訂單品項改顯示中文規格
- Repository、分支、PR：`henryfir456/bento-order-app`、`feat/vendor-variant-labels`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：使用者測試過往訂單匯入後，希望廠商訂單的品項不要顯示「（BASE）」這類代碼，改成中文。
- 實際修改：新增 `vendorItemLabel`：一般（BASE）只顯示品名；半飯（HALF）顯示「（半飯）」、加量（PLUS）顯示「（加量）」，品名已含該字時不重複；其他自訂規格照原文。廠商「店家」頁與月曆彈窗共用。
- 交付狀態：PARTIAL；待 Netlify 發布（純前端，不需部署 Worker）。

## 本輪阻礙
無。

## 個資發布檢查
- PII_SCAN：PASS；只用合成資料。

## 驗證
- 廠商 UI 與 CI 前端測試組：24 pass；`npm run lint`、`vite build`：通過。
- NOT VERIFIED：正式畫面（待發布）。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| Admin 每日彙總仍顯示「· BASE」 | P2 | 觀察 | 待建立 | 使用者要求時沿用同一套中文標籤 |

## 下一輪預防
- 觸發條件：把內部代碼顯示給廠商或一般使用者。
- 應追加的前置檢查：畫面上一律經過中文標籤轉換。
