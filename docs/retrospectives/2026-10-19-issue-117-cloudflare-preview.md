# 2026-10-19 — Issue #117 Cloudflare Worker Preview

> Build UUID 與 commit SHA 以四碼分組並用 `:` 隔開，僅為避免 PII_SCAN 將技術識別碼誤判為個資；移除分隔符即可還原原值。

- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`；`issue/117-cloudflare-preview-policy`；[PR #118](https://github.com/henryfir456/bento-order-app/pull/118)；初始 evidence commit SHA `5ea2:f2bb:eb29:a471:489a:cd26:e7fa:fc68:8065:f659`。最終審查 head 以 PR 頁目前值為準。
- 本輪目標／實際修改：釐清 Cloudflare Workers Builds Preview 失敗與必要性；記錄隔離規則；停用目前未隔離的 Preview Builds。沒有修改 Worker 程式、正式 D1、正式 Worker、Secrets、Netlify 或 GitHub 權限。
- 交付狀態：PARTIAL；repo 內部 Gate 可完成；真正 Worker Preview 尚無已驗證的專用非正式 D1 與隔離 Worker environment。

## 本輪阻礙

| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| Cloudflare PR Preview build 在前端 Vite build 後失敗 | Workers Builds Preview | [PR #116 Cloudflare build 記錄與 log 連結](https://github.com/henryfir456/bento-order-app/pull/116)；head build `de8a:e087-1342-4df3-b3fb-c808:44d5:3d4e` source SHA `469d:ce88:dc0b:e6a2:8561:0f2b:9222:6e9c:3af3:09d1`；其他失敗 build `d53f:9130-e2e4-4374-b4d9-9823:d9bb:4b1d`、`fe90:24d9-cbfd-4fb8-a5ae-ff7b:d72b:20be`、`7ab4:ba73-57e4-4f54-a3a4-72d7:abc2:43b0` | 直接讀 Cloudflare build details/logs。四筆都先以 `npm run build` 完成 Vite，再由根目錄執行 `npx wrangler preview`；Cloudflare `npx` 取得 Wrangler `4.151.1`，CLI 回報缺少 `previews` 區塊，沒有 Preview URL | 已驗證直接失敗原因是配置缺少 `previews` 區塊。單純加空區塊不安全，因 Worker 頂層 `worker-poc/wrangler.jsonc` 綁正式 D1；真正 Preview 還需專用 D1、獨立 Worker environment 與無正式 Secrets 的設定 |
| Preview Build 目錄與版本可能漂移 | Workers Builds configuration | 2026-10-19 唯讀 Cloudflare Build 設定：GitHub repo 連線、production branch `main`；Preview root `/`、build `npm run build`、Preview command `npx wrangler preview`。根目錄 `package.json` 沒有 Wrangler；`worker-poc/package.json` 鎖定 `4.129.0` | 對照 Cloudflare log 與兩份 package/config。根目錄 build 實際使用臨時取得的 `4.151.1`；專案鎖定的 `4.129.0` 低於 Cloudflare Worker Previews 文件要求的 `4.135.0`，但不是上述 build 的直接錯誤 | 已驗證 Preview 命令未由 Worker 專案的鎖定 Wrangler 執行；未來若切到 `worker-poc/`，仍需先更新並鎖定 Wrangler 至 `4.135.0` 或更新版本 |
| 沒有可核實的 Preview D1／Secrets 綁定 | 安全隔離 | main SHA `b431:0159:a1c1:eb74:c17a:c3d9:b80b:bd99:0c02:2cf3` 的 `worker-poc/wrangler.jsonc` 頂層是正式 Worker `bento-api-poc` 與正式 D1 `bento-formal`，沒有 `previews` 或獨立 Preview environment；Cloudflare D1 清單中 `bento-poc` 未由 repo 設定映射，未讀取任何 D1 資料 | 不把正式 D1 複製進 Preview；不假設未映射的 `bento-poc` 僅含合成資料；不建立新 D1／Worker 或複製 Secrets | 已驗證目前來源中沒有可供 Preview 使用且已證明安全的 D1 綁定。Preview 屬可選外部環境，`agent.yaml` 沒列為 Required Check |
| Cloudflare Preview Builds 持續為所有非 main 分支觸發 | 非正式 Cloudflare 設定 | 改動前 Worker Builds API 顯示 `previews_enabled=true`；branch `main`；Preview command 如上。正式 settings 則是 root `/worker-poc`、`npm ci && npm test && npx wrangler deploy --dry-run --outdir .release-evidence --config wrangler.jsonc`、deploy command `echo BUILD_AND_DRY_RUN_ONLY_NO_VERSION_UPLOAD` | 在精確比對上述設定後，只將 `previews_enabled` 設為 `false`；讀回確認 Preview disabled，production root/build/deploy command 未改。未刪除兩筆既有 branch Preview 設定，也未觸發正式部署 | 已驗證目前可停止重複失敗而不改正式 build/deploy 路徑。Preview 狀態為 `DISABLED / NOT APPLICABLE`，不是 PASS，也沒有 Preview URL |
| 最新 main 的基礎 Preview failure | 歷史證據 | PR #116 的 final evidence 記錄：其 base/main SHA `39e9:c007:d770:93de:c662:36f7:b826:9477:5c77:a61c` 曾有同樣 Preview failure；最新 main 已前進至 `b431:0159:a1c1:eb74:c17a:c3d9:b80b:bd99:0c02:2cf3`，Wrangler Preview 設定仍未變 | 本輪重新讀取 PR #116 evidence 與目前 main Wrangler config；Cloudflare Build API 當前 history 沒有回傳該 base SHA 的 raw build row，因此沒有把它描述成已重新取得的獨立原始 log | `39e9…` 的 base failure 為既有 PR evidence；本輪直接取回的原始 Cloudflare logs 是 PR #116 head 及三個前序分支 SHA。最新 main 的確切 Cloudflare build outcome 為 NOT VERIFIED |

## 決策與安全界線

- `agent.yaml` 將 test、lint、build 列為內部必要驗證，沒有把 Cloudflare Preview 列為必要 Gate。Cloudflare branch Preview 是獨立的外部 runtime 預覽，不能和 GitHub Actions、GitHub Required Checks 或 formal main release 混記。
- 因為目前沒有可核實的隔離 D1／Worker／Preview Secrets，已停用 Preview Builds；不以空 `previews` block 或 no-op command 製造綠燈。若日後需要真實 Preview，必須先準備獨立命名的 Worker environment、專用非正式 D1 與合成測試資料，Preview config 僅綁該資料庫，絕不帶入正式 Secrets、cron、routes 或正式 Worker binding；再鎖定 Wrangler `>=4.135.0`，以來源 SHA、build log、Preview URL、bindings 與有界 smoke 驗證。
- Cloudflare 官方依據：[Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)、[Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/)、[Preview resources and isolation](https://developers.cloudflare.com/workers/previews/resources/)、[Preview setup](https://developers.cloudflare.com/workers/previews/get-started/)。
- GitHub branch `main` API 顯示 `protected=false`、Required Status Checks enforcement `off`、contexts/checks 空；Rulesets API 回傳 `[]`；Branch Protection 專用 API 因 integration 權限回 403。依維護者 2026-10-19 確認，保護規則與 GitHub Required Checks 記 `NOT CONFIGURED`，不是 PASS。Repo `allow_auto_merge=false`；此次使用者授權僅在適用 Gate 全通過時手動合併，未啟用 Auto-merge。

## 個資發布檢查

- `git diff --unified=0 origin/main | node scripts/pii-scan-public-artifacts.mjs --diff-stdin`：PASS，exit 0。
- `git ls-files --others --exclude-standard | xargs -r node scripts/pii-scan-public-artifacts.mjs`：PASS，exit 0；兩個已變更 Markdown 檔沒有設定的個資／憑證 pattern。
- 本文件只記公開 build ID、來源 commit SHA、公開 build command 與官方文件連結；未記錄帳號憑證、token、D1 UUID、真實使用者資料或 Secrets 值。
- Cloudflare build log 僅保留安全診斷摘要；沒有複製完整環境輸出或 runtime 資料。

## 驗證

- 執行環境：Node.js `v24.19.0`、npm `11.9.0`；本機 Worker dependency 的 Wrangler `4.129.0`。
- `node scripts/check-agent-policy.mjs`：PASS，exit 0（legacy policy preservation、mandatory references、local links、root safety gates）。
- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs`：PASS，2/2，exit 0。
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`：PASS，9/9、5/5、14/14、2/2，exit 0。
- `npm test --prefix worker-poc`：PASS，67/67，exit 0。
- `node --test tests/invalid-employee-repair-ui.test.cjs tests/effective-order-item-name-ui.test.cjs tests/line-binding-transfer-ui.test.cjs`：PASS，3/3，exit 0。
- `npm run lint`：PASS，exit 0；有 23 個既有 warnings，位於未修改的程式檔。
- `npm run build`：PASS，exit 0；Vite `8.2.2` 建置 135 modules，JS bundle `739.76 kB`。
- `git diff --check`：PASS，exit 0。
- changed Markdown relative link validation：PASS，2 個變更 Markdown 檔的相對連結均可解析；外部 Cloudflare 文件與 PR 連結均從官方文件工具及 GitHub API 讀取確認。
- Cloudflare historical Preview：FAIL（四筆記錄的 Vite build PASS，Wrangler Preview FAIL；無 Preview URL）。
- Cloudflare current Preview configuration：DISABLED；這不是 Preview PASS。
- GitHub Required Checks：NOT CONFIGURED。GitHub Actions workflow run 與 Cloudflare Preview Build 分開記錄；沒有 run 不代表 PASS。
- 正式 D1 mutation、正式 Worker deploy、Netlify publish、Secrets／權限變更：NOT RUN。
- 尚待人工／實機／線上驗收：真實 Worker Preview runtime NOT VERIFIED；目前最新 main 的 Cloudflare build outcome 也 NOT VERIFIED。

## 改善建議

| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 建立可重複使用的 Worker Preview 隔離環境 | P1 | 需維護者授權非正式資源建立後再處理；本輪未建立 | [Issue #117](https://github.com/henryfir456/bento-order-app/issues/117) | 新 Worker name 與 formal Worker 不同；D1 ID 與正式 D1 不同且只含合成資料；無正式 Secrets、routes、cron；Wrangler `>=4.135.0`；Preview URL 與無副作用 smoke 可追溯 |

## 下一輪預防

- 觸發條件：任何人要求重新開啟 Cloudflare Workers Preview Builds 或新增 Wrangler Preview command。
- 應追加的前置檢查／測試／規範：先取得 Preview Worker/D1/Secrets 隔離證據，檢查 Wrangler 版本與實際 root directory，dry-run 確認目的地；只有這些都可證明時才重新啟用 Preview Builds。重新發現 Cloudflare 與 GitHub 保護政策，不沿用本次快照。
