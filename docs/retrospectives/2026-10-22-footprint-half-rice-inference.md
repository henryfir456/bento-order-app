# 2026-10-22 — 足跡：舊訂單「代碼基本款、名稱半飯」推定為半飯
- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`、`fix/footprint-half-rice`；PR／head SHA 以 PR 頁面為準。前置：PR #158（未確認品項依原始名稱合併）。
- 使用者決定：選項 2，只在足跡統計套用，不改資料，Admin 彙總與店家對帳不動。
- 實際修改：
  - `effectiveOrderItemNames.js` 新增 `footprintHalfRiceIdentity`：未解析、代碼經已審查對應為某道菜的 BASE、且該菜有 HALF 口味時，若（a）訂單行自己的菜單品項是同一道菜的 HALF（`identity_mismatch`），或（b）沒有菜單品項 ID 且原始名稱含「半飯」，就給它和已確認 HALF 品項相同的身份識別。解析器在 `identity_mismatch` 時另附 `storedMenuIdentity`，判斷結果不變。
  - `menuItemChanges.js` 把蔡老師的已審查對應表提到模組層級，新增 `legacyItemHasHalfVariant`（蔡老師 S、C、CM、B；禾拾 H1–H5）。
  - `ordersRead.js`（足跡統計）使用上述規則；推定列不覆寫已確認的菜單名稱。只有推定、沒有已確認行的列標為 `inferred_half_rice`，前端顯示「舊訂單推定為半飯」。
- 不改資料、歷史訂單或 schema；`adminSummary.js`、`vendorOperations.js` 未使用此規則。

## 個資發布檢查
- PII_SCAN：測試只用合成 ID 與公開菜單名稱；本文件不含員編、user_id 或 LINE 識別。

## 驗證
- RED：新增 2 個 Worker 測試，修改前 2 fail。
- GREEN：`npm test --prefix worker-poc` 646/646；前端 `order-statistics-ui`、`effective-order-item-name-ui` 17 pass；`vite build` 成功。
- 測試涵蓋的反例：名稱沒有「半飯」、菜單品項是別道菜的半飯、沒有對應規則的店家，都維持未確認；Admin 彙總同一天仍顯示未確認。
- 未驗證：正式資料上的實際合併筆數（前輪分析為 13＋18 筆）；正式足跡畫面。

## 已知限制
- 舊菜單的半飯品項（例：代碼 `CH`、`H3H`，口味空白）解析成功時身份仍是自己的代碼，和新菜單 C／HALF 不同列；屬前輪記錄的 P2（會改代碼的對應不合併），本輪未處理。
