# 2026-10-22 — 一鍵檢視廠商畫面（Mock）
- Repository、分支、PR：`henryfir456/bento-order-app`、`feat/vendor-preview-launcher`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：使用者只想看廠商登入後的畫面；隔離 Worker UAT 啟動器在 Windows 上 Worker 健康檢查逾時，瀏覽器沒有開成功。
- 實際修改：新增 `vendor-preview.bat` 與 `scripts/vendor-preview.ps1`。以本機 Mock 模式、合成廠商身分啟動 Vite（5180–5199 第一個空埠，綁 127.0.0.1），等伺服器回應後自動開瀏覽器；以非空的環境變數覆蓋 `.env*` 設定；輸出另存 `vendor-preview.log`。README 補一段說明。不碰 Worker、正式資料或身分。
- 交付狀態：PARTIAL；Linux 上以 PowerShell 7 執行同一腳本驗證，Windows PowerShell 5.1 雙擊 NOT VERIFIED。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 隔離 Worker UAT 在 Windows 健康檢查逾時 | 環境 | 使用者 log：`Worker HTTP health endpoint did not become ready`（前端已改用 5174） | 本輪不處理，改提供不需要 Worker 的 Mock 一鍵檢視 | UNKNOWN：Worker 視窗的實際錯誤未取得；推測與 `localhost` 解析到 IPv6 而 Worker 綁 127.0.0.1 有關，未驗證 |

## 個資發布檢查
- PII_SCAN：PASS（新增 diff 與本檔）；只用 Mock 合成資料。

## 驗證
- Linux + PowerShell 7.4：在 `.env.local` 與環境變數都設成 `VITE_API_TRANSPORT=worker` 的不利條件下執行腳本，仍以 Mock 啟動於 5180；Playwright 開啟後顯示「廠商工作台」「DEV · MOCK VENDOR」與合成訂單／對帳。
- NOT VERIFIED：Windows 雙擊 bat、自動開瀏覽器（Linux 上 `-WindowStyle` 不支援，該行僅影響隱藏視窗）。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 查明 Windows 上隔離 Worker 健康檢查逾時 | P2 | 觀察 | 待建立 | 啟動器在 Windows 上 Worker 與前端都就緒並開啟瀏覽器 |

## 下一輪預防
- 觸發條件：使用者只需要「看畫面」。
- 應追加的前置檢查：先提供最少依賴的方式（Mock 前端），再處理完整環境。
