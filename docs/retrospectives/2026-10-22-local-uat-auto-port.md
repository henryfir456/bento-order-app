# 2026-10-22 — 本機 Worker UAT 自動避開被佔用的埠
- Repository、分支、PR：`henryfir456/bento-order-app`、`fix/local-uat-auto-port`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：使用者在 Windows 執行 `local-uat-start.ps1` 時視窗瞬間關閉。以除錯用 bat 保存輸出後，錯誤為 `Port 5173 is already in use`（使用者另有開發伺服器在跑）。使用者要求改埠或做一個不搶埠的機制。
- 實際修改：啟動器改為在 5173–5199（前端）與 8787–8799（Worker）中選第一個空的埠，並把埠傳給前端與 Worker runner；Worker 以 `wrangler dev --var` 只允許該前端 origin 的 CORS；狀態檔記錄埠，停止腳本據此移除 ADB 轉送；README 說明行為。不關閉或搶佔其他程式的埠。
- 交付狀態：PARTIAL；Linux 上以同一組 Wrangler／Vite 參數驗證，Windows PowerShell 啟動器 NOT VERIFIED（本環境沒有 PowerShell）。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 啟動器視窗瞬間關閉 | 環境（埠衝突） | 除錯 bat 的 log：`Port 5173 is already in use` | 啟動器改為自動選空埠 | 已驗證：預設埠被其他程式佔用，原本設計直接 throw |
| 重跑 smoke 時公告未讀數不符 | 測試狀態 | 同一個本機 D1 第二次跑 smoke，公告已標為已讀 | 先 `reset` 再跑 | 已驗證：smoke 假設剛重建的 seed |

## 個資發布檢查
- PII_SCAN：PASS（新增 diff 與本檔）；只用合成本機身分，憑證檔未提交。

## 驗證
- Worker 以埠 8788、`--var DEV_ALLOWED_ORIGINS` 指向前端 5174 啟動：5174 的兩種 origin 都回正確的 `Access-Control-Allow-Origin`，未列入的 5199 沒有。
- `node scripts/local-uat.mjs reset` 後 `local-uat-smoke.mjs http://127.0.0.1:8788`：21/21 PASS。
- Vite 以 5174 啟動並指向 8788，Playwright 以合成廠商一登入：顯示「廠商工作台」「每日訂單與轉帳」與合成訂單／對帳。
- NOT VERIFIED：Windows 上 `local-uat-start.ps1`／`local-uat-stop.ps1` 實際執行。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 啟動器失敗時保留視窗與 log | P2 | 觀察（本輪以臨時 bat 處理） | 待建立 | 直接雙擊啟動器失敗時，使用者看得到錯誤 |

## 下一輪預防
- 觸發條件：新增本機啟動器或固定埠。
- 應追加的前置檢查：預設埠被佔用時要能自動換埠，或至少讓錯誤停留在畫面上。
