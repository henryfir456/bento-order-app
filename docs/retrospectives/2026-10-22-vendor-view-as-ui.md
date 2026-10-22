# 2026-10-22 — 廠商帳號「檢視身分」提示
- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`、`fix/protected-view-as-message`；PR／head SHA 以 PR 頁面為準。
- 本輪目標／實際修改：使用者管理中心對 `Vendor` 角色列停用「檢視身分」並顯示「廠商帳號不可檢視身分」（手機卡片與桌機表格共用同一元件），`handleSelectViewAs` 對 Vendor 目標直接返回。Worker 不變；仍由 Worker 拒絕受保護帳號 View As。
- 交付狀態：PARTIAL；程式與本地測試完成，前端視覺／真實瀏覽器驗收 NOT VERIFIED，前端尚未發布（USER_RELEASE_PENDING）。不升版：本輪未建立正式版本，變更與前次 Worker 效能修正一併留待下次發版時評估。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| Admin 開足跡頁出現 403 | 授權（預期行為） | D1 審計有 `PROTECTED_ACCOUNT_VIEW_AS_BLOCKED`，時間吻合 | Worker 不改 | 已驗證：Admin 檢視受保護帳號被拒；舊前端仍進入檢視並顯示泛用的「讀取失敗」 |
| 本機沒有安裝 `esbuild` | 環境／依賴 | `Cannot find module 'esbuild'`（根目錄 `node_modules` 缺套件，`package.json` 已宣告 0.28.1） | 未重裝（避免影響執行中的 Vite）；以 `NODE_PATH` 指向 `worker-poc/node_modules` 的 esbuild 執行測試 | 已驗證現象；UNKNOWN：為何本機未安裝 |
| 既有 UI 測試在本機 5 項失敗 | 環境 | 同一組 9 個測試檔在 main 基準上也是 5 fail／53 pass，修改後仍是 5 fail／53 pass | 以 stash 比對 | 已驗證與本修改無關；未調查其根因 |
| 既有 SSR 元件測試需要 `import.meta.env` | 測試基礎 | 元件匯入 API client，模組載入時讀 `import.meta.env`，bundle 成 CJS 後為空 | 新測試以 esbuild `define` 提供，並在 VM 內提供 `URL` | 已驗證 |
| 修改 `CHANGELOG.md` 使歷史保留測試失敗 | 版本規範 | 在 `[Unreleased]` 新增一行後 `changelog-migration` 第 1 項失敗，還原後通過 | 還原，不升版並在此記錄 | UNKNOWN：未釐清解析器如何處理該段 |

## 個資發布檢查
- PII_SCAN：測試只用合成資料（`Synthetic …`）；無員編、user_id、LINE 識別、截圖。

## 驗證
- RED（修改前，新測試檔）：3 項中 1 項失敗（Vendor 列仍有可點擊的「檢視身分」），2 項對照案例通過。
- GREEN（修改後）：`node --test tests/vendor-view-as-ui.test.cjs` 3 pass／0 fail；覆蓋手機卡片與桌機表格各 1 個可用控制（一般員工）、Vendor 列 2 處說明文字、沒有檢視權限時不顯示。
- 既有相關 UI 測試：5 fail／53 pass，與 main 基準相同。
- `vite build`：exit 0（既有大型 chunk 提示）。`oxlint`：只有既存 warning。
- 未執行：真實瀏覽器視覺驗證（手機窄寬度與桌機寬度）— 內建瀏覽器重新載入先前的 pinggy 測試網址時畫面空白（原因 UNKNOWN，推測通道已中斷），NOT VERIFIED。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 前端對 `PROTECTED_ACCOUNT_LINE_AUTH_REQUIRED` 顯示明確訊息並結束檢視狀態 | P2 | 觀察；目前以停用入口預防 | 待決定 | 若仍可能進入被擋的檢視（例如 role 欄位缺失），顯示說明而非「讀取失敗」 |
| 修復本機 `esbuild` 缺失與 5 項既有 UI 測試失敗 | P1 | 另開 Issue 評估 | 待建立 | 在乾淨 `npm ci` 後相關 UI 測試通過 |

## 下一輪預防
- 觸發條件：新增管理介面入口或權限相關控制。
- 應追加的前置檢查：以 SSR 測試同時覆蓋手機卡片與桌機表格；在本機先確認測試環境可執行基準測試，再區分既有失敗與新失敗。
