# 2026-10-20 — Issue #121 公告通知收件匣
- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`，基於 `9bb9e2653e3d85ad8b8646d4968fe193e9859bd6` 的 `codex/issue-121-announcement-inbox`；未建立 PR；本回顧隨程式提交納入，精確 SHA 以其所在 Git commit 為準。
- 本輪目標／實際修改：移除首頁常駐公告卡，新增可存取的通知鈴鐺、未讀數與清單；以 Worker/D1 為正式實作，依 canonical 使用者保存已讀與停止自動彈出時間；保留合成 Local Mock 驗收路徑。新增 formal migration `0016_announcement_user_preferences.sql`，僅提交 migration 檔案，沒有套用 migration。
- 交付狀態：PARTIAL（程式與本機驗證完成；真實 LIFF、隔離 Worker API、D1 與部署均未驗證，且本輪範圍明確排除部署及 migration 套用）。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 第一輪 changelog migration 測試未接受新增的繁中 Added 項目 | 測試期待未更新 | `tests/changelog-migration.test.cjs` 的 Unreleased Added 期待清單少了本輪一行 | 將測試期待更新為與實際單行 CHANGELOG 相同，重跑宣告命令後 90 passed、3 skipped、0 failed | 已驗證為新增合法 changelog 後的舊期待，不是功能失敗 |
| 真實 LIFF 身分、隔離 Worker API 與 D1 行為 | 外部驗收未執行 | `agent.yaml` 將 LIFF、View As、Worker 部署及遠端 D1 列為人工驗證；本輪只跑 Local Mock 瀏覽器驗收 | 未部署 Worker、未套用 migration、未使用真實帳號或資料；API 單元測試使用合成身分 | 已知本輪授權範圍未含部署／migration；真實外部行為 NOT VERIFIED |

## 個資發布檢查
- PII_SCAN：PASS（完成後記錄兩項宣告掃描的實際輸出；只使用合成 fixture，未匯出／上傳正式個資，未附真實截圖或識別值）。
- Issue／PR／commit／測試輸出／截圖／評論均使用合成資料，確認者：本輪作者；仍待獨立 Reviewer 覆核同一 commit。

## 驗證
- `npm ci --cache /tmp/bento-issue121-npm-cache`：PASS，退出碼 0；`worker-poc/` 的 `npm ci --cache /tmp/bento-issue121-npm-cache`：PASS，退出碼 0。未修改依賴版本。
- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs`：PASS，退出碼 0；90 passed、3 skipped、0 failed。
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`：PASS，退出碼 0；各子套件 9、13、14、2 項通過。
- `npm test --prefix worker-poc`：PASS，退出碼 0；539 passed、0 failed；包括公告 inbox、遷移 schema 與 runtime-config 預期。
- `node --test tests/invalid-employee-repair-ui.test.cjs tests/effective-order-item-name-ui.test.cjs tests/line-binding-transfer-ui.test.cjs tests/order-statistics-ui.test.cjs tests/local-mock-responsive-uat.test.cjs`：PASS，退出碼 0；27 passed、0 failed。實際 Local Mock Chromium 驗收涵蓋 375px 與 1280px、兩公告依序彈出、每次 session 避免重複、舊公告不自動彈出、清單／已讀與保留日曆／訂購畫面。此結果是 Mock UI 證據，不代表 Worker API 或真實 LIFF 驗收。
- `npm run lint`：PASS，退出碼 0；輸出有 warnings（包括 App 與其他既有區塊），新增公告元件與 Worker inbox 檔案沒有 lint warning。
- `npm run build`：PASS，退出碼 0；Vite 提示 bundle 超過 500 KB，未阻擋 build。
- `node --test tests/announcement-images-ui.test.cjs tests/app-pure-helpers.test.cjs tests/strict-identity-ledger.test.cjs`：PASS，退出碼 0；93 個結果中 90 passed、3 skipped、0 failed。
- `git diff --check`：PASS，退出碼 0。
- `git diff --unified=0 origin/main | node scripts/pii-scan-public-artifacts.mjs --diff-stdin`：PASS；未發現設定的個資／憑證樣式。
- `git ls-files --others --exclude-standard | xargs -r node scripts/pii-scan-public-artifacts.mjs`：PASS；掃描新增文字檔，未發現設定的個資／憑證樣式。
- 真實 LIFF、真實 View As、隔離 Worker 遠端 API 與 D1 migration：NOT VERIFIED／NOT RUN；Local Mock 不等同實際 API。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 在獲得隔離 Worker 與 D1 授權後，套用 migration 至隔離資料庫並用真實 Worker transport 驗收 canonical identity、View As fail-closed、讀取與偏好寫入 | P1 | 本輪不執行；保留待後續隔離驗收 | Issue #121 | 使用合成帳號完成 API contract 測試，確認不接觸正式環境或正式個資 |
| 評估大型前端 bundle 分割 | P2 | 本輪觀察，不影響本功能 build | 無 | 針對主要路由 lazy loading 後量測 bundle 與載入行為 |

## 下一輪預防
- 觸發條件：任何對外宣稱隔離 Worker／正式交付，或套用 schema migration 前。
- 應追加的前置檢查／測試／規範：先取得明確隔離環境與授權，依 migration/備份政策確認目標及復原證據；以同一 commit SHA 驗證 Worker transport、LIFF/View As 與遠端行為，分開記錄 Local Mock、整合與人工驗收結果。
