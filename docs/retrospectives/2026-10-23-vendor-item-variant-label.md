# 2026-10-23 廠商訂單品項改顯示中文規格

- Repository／分支：`henryfir456/bento-order-app`／`claude/project-thread-7xhh5z`
- 需求：廠商訂單（今日、日曆彈窗、訂單列表）品項後面顯示「（BASE）」等內部代碼，改為中文。
- 實際修改（僅前端）：
  - `src/features/vendors/vendorDayFormat.js` 新增 `itemLabel`：BASE 不加後綴，HALF 顯示「半飯」，PLUS 顯示「加量」；未知代碼照原樣保留，不隱藏資訊。
  - `VendorDaySummary.jsx`、`VendorOperationsPage.jsx` 改用 `itemLabel`。
- Worker／D1：無修改，不需部署 Worker。

## 本輪阻礙
無。

## 公開紀錄檢查
- PII_SCAN：PASS（diff 與本文件不含個資）。

## 驗證
- `itemLabel` 以 node 直接呼叫：BASE／空值→「紅麴豆腐」，HALF→「紅麴豆腐（半飯）」，PLUS→「紅麴豆腐（加量）」，未知 `X`→「紅麴豆腐（X）」。
- `node --test tests/vendor-operations-ui.test.cjs tests/vendor-view-as-ui.test.cjs`：10 pass／0 fail／2 skipped。
- `oxlint src/features/vendors`：exit 0；`vite build`：成功。
- NOT VERIFIED：本機前端畫面人工驗收（READY_FOR_LOCAL_UAT）；Netlify 正式前端由使用者發布（USER_RELEASE_PENDING）。

## 改善建議
| 建議事項 | P0/P1/P2 | 處理 | 驗收條件 |
| --- | --- | --- | --- |
| 其他畫面若顯示 variant 代碼，統一使用同一中文對照 | P2 | 觀察 | 出現第二個需要時再抽共用 |

## 下次預防
- 對使用者顯示的列舉值（variant、狀態碼）預設要有中文對照，不直接輸出內部代碼。
