# 正式 Worker 重複部署 Runbook（Issue #104）

**生產目標**：`bento-api-poc`；唯一正式入口 `worker-poc/src/formalWorker.js`。本程序只從最新 **main** 產出新 bundle，不能用舊部署/舊 Script 或單一來源檔替代。

## A. Fresh build / preflight（本階段不部署）

1. 在獨立、乾淨的 main checkout 執行 `git fetch origin main`、`git status --short`、`git rev-parse HEAD`；SHA 必須等於目前遠端 main。任何不乾淨或非 main 的狀態停止，保護使用者資料。
2. 執行 `npm ci`、`node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/order-statistics-ui.test.cjs`、`npm run lint`、`npm run build`。
3. `npm ci --prefix worker-poc`、`npm test --prefix worker-poc`。
4. `node worker-poc/scripts/prepare-formal-release.mjs`：再次驗證 branch、工作樹、正式設定、D1 UUID，執行固定版本 Wrangler 的 `deploy --dry-run --outdir`，產生 `worker-poc/.release-evidence/release-manifest.json`（SHA-256）。這是 **NOT DEPLOYED** 證據，絕不可當成正式版本號。
5. 確認 bundle 包含本次修改以及全部依賴；發布前必須取得可上傳的所有 bundle 部件（例如 Wrangler 產出的 Worker 模組、附帶二進位或靜態資產），不能只上傳第一個 JS 檔。檢查且排除 release evidence 中意外夾帶的機密。不要提交 bundle 到 GitHub。

## B. Cloudflare API（直接部署，不使用 GitHub Actions）

1. Cloudflare API 先唯讀查 `/accounts/{account_id}/workers/scripts/bento-api-poc/deployments`、Worker 設定與綁定、Secrets metadata、排程；做 **before** 快照。
2. API 上傳使用新的完整 Worker 模組與 Cloudflare API 正式 upload schema，metadata 需保留現有 D1 `DB` → `bento-formal`（ID `e75bc185-afb5-4a5d-abc9-81bd79525cff`）、Secrets、compatibility date `2026-09-07`、三個 cron（`0 16 * * *`、`0 8 * * *`、`30 0 15 6-12 *`）及 CORS 行為。**若 API 無法證實保留 Secrets 或原有綁定，停止，不可自行猜測 multipart metadata。**
3. 建立新 Version 並部署（100%），不可單純重部署舊 Version。取得並核對 source=api、Version ID、Deployment ID、流量分配、bundle 相符性、設定 **after** 快照；任何缺失保留 WAITING_FOR_DELIVERY。
4. 也可在具備授權的**本機或雲端直接 CLI** 使用 `cd worker-poc && npx wrangler deploy --config wrangler.jsonc --keep-vars`，但一樣要先完成 A，確認沒有覆蓋 bindings、Secrets 和排程。不得改走 GitHub Actions 正式部署。

## C. 有界 Runtime smoke（正式部署後）

- `GET /api/health` → 200，檢查 database ready；匿名 `GET /api/me` 和 `GET /api/orders/statistics` → 401。
- `npm run smoke:cors --prefix worker-poc` 驗證 OPTIONS 和允許／拒絕來源。
- 使用**合法專用測試身份**驗證本人讀取、Admin View As 目標 A/B、User 偽造 View As → 403、期間參數錯誤 → 400。不能使用任意生產用戶憑證，不能把 token 記錄到 GitHub。沒有合法授權時保留 `AUTH_VIEW_AS_NOT_VERIFIED`。
- 前端 Netlify published commit 與 UI/LIFF 實測是**獨立交付 Gate**；不能因 Worker success 標示整體 DONE。

## D. 最終證據與阻塞

記錄 main SHA、bundle hash/大小、測試執行及結束碼、Cloudflare Before/After 綁定比對、Version ID、Deployment ID、100% 流量、HTTP status/CORS headers、Netlify published commit、View As 實測結果；任一未取得以 **NOT VERIFIED** 標明。

**禁止：** Actions 部署、重發舊 Worker、只補一個 JS module 的部分 bundle、重建缺失的 Secrets、使用 D1 正式資料修復來掩飾 runtime 問題。

此文件是程序；實際 Cloudflare API 上傳仍需符合當前 Cloudflare API schema 及完整 source/bundle 驗證，不宣稱單憑 Runbook 即自動完成正式部署。
