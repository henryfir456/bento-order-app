# Worker 部署強制細則（自 AGENTS.md 原文遷移）

本檔由根目錄 AGENTS.md 強制引用，對正式 Worker 修改具約束力；不可據此放寬根目錄安全底線。

## 正式後端直接部署（必要；禁止 GitHub Actions）
- **正式部署禁止 GitHub Actions**（包括 push、workflow_dispatch、re-run 或工作流程代部署）。部署只允許在已授權的直接執行環境使用 Wrangler CLI，或透過已連線的 Cloudflare 外掛/API **上傳由最新 `main` 完整來源新建置的 Worker bundle**。先依當次可用能力與最近成功紀錄選擇可靠方式；不得只因無法使用 Wrangler 就跳轉 GitHub Actions。
- 兩條直接路徑的共同前置：核對最新 GitHub `main` SHA、`worker-poc/wrangler.jsonc` 的 `bento-api-poc` 和正式 D1 `bento-formal` 綁定，使用完整來源／模組相依與鎖定依賴，通過必要 Worker 測試。保留既有 Secrets、D1 binding、排程、CORS、compatibility_date 與所有正式設定；禁止為了上傳而自行簡化或改寫 Worker 邏輯。
- **Wrangler CLI 路徑**：`npm ci --prefix worker-poc`、`npm test --prefix worker-poc`，在 `worker-poc/` 執行 `npx wrangler deploy --config wrangler.jsonc --keep-vars`。使用本機或已授權的直接 shell，不得透過 GitHub Actions。
- **Cloudflare 外掛/API 路徑**：取得相同最新 `main` 的完整 Worker 來源及可驗證的新建置產物，使用 Cloudflare Worker upload endpoint 上傳**新程式碼**並發布正式流量。要核對部署 bundle 真正包含這次修改、原本模組/授權/D1/Secrets/排程未遺失；以嚴格繼承或等效保留現存 bindings 的安全上傳方式執行。不能用舊版 script 回傳內容、少量補丁、拼湊缺漏模組或把既有 Worker Version 再部署一次代替新建置。Cloudflare 紀錄 `source=api` 應如實標為 API，不得假稱 Wrangler。
- **正式驗收**：記錄來源 main SHA、新 Worker Version ID、Deployment ID、100% 流量，執行無副作用的 `/api/health`、身分授權、CORS 與此次新增 API contract smoke；Netlify 前端正式部署與手機/LINE 實機驗收分開記錄。缺任何必需證據時不得宣稱正式交付。
- **失敗處理**：優先調查當天成功的直接 API/CLI 上傳實例及其完整原始碼建置方式；缺工具、缺 bundle、模組/設定不明時停止正式寫入，回報 `WAITING_FOR_DELIVERY` 並明列阻礙，不可改用 GitHub Actions、要求補 Actions Secrets、重發舊版本或要求使用者重複授權。

## 可重複正式 Worker 交付入口（Issue #104）
- 請先讀 `docs/FORMAL_WORKER_RELEASE.md`，依順序執行可稽核的 fresh-build、正式部署、設定保留比對與 Runtime smoke。
- `node worker-poc/scripts/prepare-formal-release.mjs` 僅在乾淨 main checkout 上進行正式 Worker dry-run bundle 準備和 SHA-256 manifest，不會上傳或部署；完整測試與獨立 Review 仍是必需關卡。
- 缺完整建置產物、API upload metadata／Secrets 保留證據、必要驗證或授權身份時應 fail closed，切勿重新發佈舊 Worker 或將 CI 測試冒充生產驗收。
