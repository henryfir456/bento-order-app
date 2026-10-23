# 2026-10-23 — 廠商唯讀訂餐月曆
- Repository、分支、PR：`henryfir456/bento-order-app`、`feat/vendor-calendar`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：使用者希望廠商除了「店家」之外，也有「訂餐」月曆（只能看）；點自家團的格子時，跳出那天的訂單總覽。
- 實際修改：
  - Worker：廠商可讀 `/api/calendar`，但每天只回店家名稱、模式、截止時間與口味名稱，不含訂購份數、按讚或其他會員資料；其他員工路由仍回 `VENDOR_ROUTE_FORBIDDEN`。
  - 前端：廠商底部導覽加「訂餐」。新增 `VendorCalendar`：平日格子顯示當天店家；自家團為綠色並顯示份數，可點開彈窗看當天訂單總覽（與「今日」分頁共用 `VendorDaySummary`）；其他店家的日子不能點。
  - Mock：廠商身分的月曆補上本月已過平日，與 Mock 廠商訂單一致。
- 交付狀態：PARTIAL；程式與本機驗證完成，Worker 部署與 Netlify 發布待執行。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 瀏覽器測試等不到彈窗關閉 | 測試假設 | 關閉後畫面上還有 Mock 公告彈窗 | 改為只等「訂單總覽」彈窗消失 | 已驗證：Mock 廠商也會跳公告；正式環境廠商讀公告回 403，不會跳 |
| 查正式 D1 現況（為過往訂單匯入做規劃） | 權限 | 使用者電腦的 Claude Code 擋下 `d1 execute --remote`（Production Reads） | 未執行，改請使用者決定 | 已驗證：本機權限規則 |

## 個資發布檢查
- PII_SCAN：PASS（新增 diff 與本檔）；只用合成資料。

## 驗證
- `npm test --prefix worker-poc`：652 pass／0 fail（廠商月曆欄位白名單、其他路由仍禁止）。
- `node --test tests/vendor-operations-ui.test.cjs`：8 pass（手機與桌面寬度：導覽為「店家／訂餐」、月曆無水平捲動、自家團可點且彈窗顯示備餐清單、關閉後可回店家）。
- CI 前端測試組（dual-calendar 等 8 檔）：28 pass；`npm run lint`、`vite build`：通過。
- Mock 手機寬度截圖確認月曆與彈窗版面。
- NOT VERIFIED：正式環境（待部署）。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 自家團判斷目前以店家名稱比對月曆 | P2 | 觀察 | 待建立 | 月曆設定改存 vendor_id 後改用 ID 比對 |

## 下一輪預防
- 觸發條件：讓廠商讀員工端資料。
- 應追加的前置檢查：一律在 Worker 端做欄位白名單，不把員工端回應整包轉給廠商。
