# 正式 Worker 重複部署 Runbook（Issue #104）

**生產目標**：`bento-api-poc`；唯一正式入口 `worker-poc/src/formalWorker.js`。本程序只從最新 **main** 產出新 bundle，不能用舊部署/舊 Script 或單一來源檔替代。

## A. Fresh build / preflight（本階段不部署）

1. 在獨立、乾淨的 main checkout 執行 `git fetch origin main`、`git status --short`、`git rev-parse HEAD`；SHA 必須等於目前遠端 main。任何不乾淨或非 main 的狀態停止，保護使用者資料。
2. 執行 `npm ci`、`node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/order-statistics-ui.test.cjs`、`npm run lint`、`npm run build`。
3. `npm ci --prefix worker-poc`、`npm test --prefix worker-poc`。
4. `node worker-poc/scripts/prepare-formal-release.mjs`：再次驗證 branch、工作樹、正式設定、D1 UUID，執行固定版本 Wrangler 的 `deploy --dry-run --outdir`，產生 `worker-poc/.release-evidence/release-manifest.json`（SHA-256）。這是 **NOT DEPLOYED** 證據，絕不可當成正式版本號。
5. 確認 bundle 包含本次修改以及全部依賴；發布前必須取得可上傳的所有 bundle 部件（例如 Wrangler 產出的 Worker 模組、附帶二進位或靜態資產），不能只上傳第一個 JS 檔。檢查且排除 release evidence 中意外夾帶的機密。不要提交 bundle 到 GitHub。
6. 在同一個 clean/up-to-date `main` checkout 執行 `npm run drift:formal --prefix worker-poc`。此唯讀檢查比對目前 main 的 Worker runtime 檔案變更、正式 deployment/version 的 `workers/commit_sha` 註記，以及正式 D1 `d1_migrations` 清單。`DRIFT` 會列出需部署或缺少的 migration，`BLOCKED` 表示 metadata 不足；兩者都不能以 CI 或 build 成功取代。Frontend-only commit 不會單獨要求 Worker 發布。

## B. Cloudflare API（直接部署，不使用 GitHub Actions）

1. Cloudflare API 先唯讀查 `/accounts/{account_id}/workers/scripts/bento-api-poc/deployments`、Worker 設定與綁定、Secrets metadata、排程；做 **before** 快照。
2. API 上傳使用新的完整 Worker 模組與 Cloudflare API 正式 upload schema，metadata 需保留現有 D1 `DB` → `bento-formal`（ID `e75bc185-afb5-4a5d-abc9-81bd79525cff`）、Secrets、compatibility date `2026-09-07`、三個 cron（`0 16 * * *`、`0 8 * * *`、`30 0 15 6-12 *`）及 CORS 行為。**若 API 無法證實保留 Secrets 或原有綁定，停止，不可自行猜測 multipart metadata。**
3. 建立新 Version 並部署（100%），不可單純重部署舊 Version。取得並核對 source=api、Version ID、Deployment ID、流量分配、bundle 相符性、設定 **after** 快照；任何缺失保留 WAITING_FOR_DELIVERY。
4. 也可在具備授權的**本機或雲端直接 CLI** 使用 `cd worker-poc && npx wrangler deploy --config wrangler.jsonc --keep-vars`，但一樣要先完成 A，確認沒有覆蓋 bindings、Secrets 和排程。不得改走 GitHub Actions 正式部署。
5. D1 migration drift 未完成備份／還原 Gate 並逐一套用前，不可部署依賴新 schema 的 Worker。正式流量切換後再次執行 `npm run drift:formal --prefix worker-poc`，應核對 Worker source SHA 與 D1 migration 清單；此結果仍不取代 API 功能驗收。

## C. 有界 Runtime smoke（正式部署後）

- 設定 `BENTO_WORKER_BASE_URL=https://<實際 Worker hostname>` 後執行 `node worker-poc/scripts/formal-release-smoke.mjs`：`GET /api/health` → 200；匿名 `GET /api/me` 和 `GET /api/orders/statistics` → 401。若有合法專用測試 Admin 憑證，可在私有 process environment 設 `BENTO_SMOKE_ADMIN_TOKEN` 和 `BENTO_SMOKE_VIEW_AS_USER_ID`，腳本僅輸出遮蔽目標的 HTTP 證據，不輸出 token；無憑證時保留 `NOT_VERIFIED`。
- `npm run smoke:cors --prefix worker-poc` 驗證 OPTIONS 和允許／拒絕來源。
- 使用**合法專用測試身份**驗證本人讀取、Admin View As 目標 A/B、User 偽造 View As → 403、期間參數錯誤 → 400。不能使用任意生產用戶憑證，不能把 token 記錄到 GitHub。沒有合法授權時保留 `AUTH_VIEW_AS_NOT_VERIFIED`。
- 前端 Local 人工驗收與 Netlify 正式發布是**獨立且依序進行的 Gate**：Worker 部署及 smoke 後先交付 Local UAT，再由使用者自行決定 Netlify 發布。Netlify 尚未發布標為 `USER_RELEASE_PENDING`，**不阻塞已完成的 Worker 交付或 Local UAT**；不能因 Worker success 宣稱整體 UI/LIFF 驗收 DONE。詳細規則見 [FRONTEND_LOCAL_ACCEPTANCE_AND_RELEASE.md](FRONTEND_LOCAL_ACCEPTANCE_AND_RELEASE.md)。

## D. 最終證據與阻塞

記錄 main SHA、bundle hash/大小、測試執行及結束碼、Cloudflare Before/After 綁定比對、Version ID、Deployment ID、100% 流量、HTTP status/CORS headers、Local UAT 交付／使用者實測結果、Netlify 發布狀態（未由使用者發布時 `USER_RELEASE_PENDING`）、View As 實測結果；未取得實測證據標 **NOT VERIFIED**，但不得把使用者尚未發布 Netlify 誤判為 Worker 交付失敗。

**禁止：** Actions 部署、重發舊 Worker、只補一個 JS module 的部分 bundle、重建缺失的 Secrets、使用 D1 正式資料修復來掩飾 runtime 問題。

此文件是程序；實際 Cloudflare API 上傳仍需符合當前 Cloudflare API schema 及完整 source/bundle 驗證，不宣稱單憑 Runbook 即自動完成正式部署。

## G. 正式版本漂移檢查

`worker-poc/scripts/detect-formal-drift.mjs` 僅讀取 Worker deployment/version metadata 與正式 D1 migration 名稱，不查詢訂單、使用者、帳本或付款資料，也不寫入 Cloudflare。輸出 `IN_SYNC`、`DRIFT` 或 `BLOCKED`，並在 Worker/D1 落後時列出直接可執行的下一步。缺少 version SHA、migration metadata、Cloudflare 唯讀憑證或 clean/up-to-date main 時 fail closed。它不觸發部署、不使用 GitHub Actions，也不代替正式資料備份 Gate、API acceptance 或獨立 Reviewer。


## E. 完整模組 API Version Uploader（Fail closed）

`worker-poc/scripts/upload-formal-version.mjs` 可讀取 `BENTO_RELEASE_MANIFEST` 指向的 bundle manifest，使用 Node `FormData` / `Blob` 原始 bytes 建構每個 module part，加上 `metadata`（main_module / bindings inherit / compatibility_date / source SHA），在送出前逐一驗證 SHA256、檔名、MIME、大小；**預設僅 dry-run，不向 Cloudflare 發出請求**。

明確設定 `BENTO_UPLOAD_VERSION=true` 並提供 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 才允許呼叫 `POST /versions?bindings_inherit=strict` 建立**未部署**新版本。先檢查最新上傳版本是否就是目前 100% 正式版本，否則阻擋繼承；API 成功後讀回 /versions/{id}、/settings、/secrets、/schedules 並執行逐項核對。任何不符立即 BLOCKED、不建立 Deployment。**目前上傳器不包含建立正式 Deployment 的操作，因此不可能因為啟用 upload 就自動切換正式流量。**

注意：Wrangler --dry-run 的實際輸出模組配置與 multipart metadata 仍應在真實環境驗證；若 dry-run 產生多個檔案但不能無歧義辨識主模組，`prepare-formal-release.mjs` 會拒絕產生可上傳 manifest。不要人工猜 main_module 或省略模組。實際 Cloudflare API 對 Version Settings 的回傳結構也需用未發布版本做實際整合驗證；在沒有這項證據前，本工具仍屬**受保護的試驗上傳器，不是已通過正式發版驗收的發布器**。


## F. 2026-10-16 Review 修正與驗證

- 主模組改由 Wrangler dry-run 輸出的 `metadata.json.main_module` 指定，檢查該檔確實存在於產物；不再以輸出 `.js` 檔數量推測入口。**尚未以正式 checkout 的 Wrangler dry-run 證實 metadata.json 會出現**，缺少時 fail closed。
- 新版設定比對改讀 Version API `resources.bindings`、`resources.script_runtime`，缺少結構即 `VERSION_RESOURCES_UNAVAILABLE`；新版本上傳仍未執行，API 讀回契約待未發布版本實測。
- 最新 PR head 的 GitHub CI（Issue #46、#98、Menu Variant）均成功，其中執行 `npm test --prefix worker-poc`，涵蓋 `formal-version-upload.test.js`；此證據僅代表測試套件 PASS，不代表 Wrangler fresh bundle 或 Cloudflare 版本上傳通過。
