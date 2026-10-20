# 2026-10-20 — Replacement and cancellation race regression

- Repository / base: `henryfir456/bento-order-app`, latest `main`.
- Branch / PR / commit: `codex/fix-orders-concurrency-oracle`; PR #131 is open, and this record captures the verification checkpoint before merge.
- 本輪目標／實際修改：修正替換訂單與取消訂單併發測試的錯誤 oracle；production Worker 程式與資料不變。
- 交付狀態：PARTIAL；repo tests/lint/build、PR workflow 與獨立審查通過；PR 尚未合併，隔離 Worker API/CORS runtime 仍無法連線驗收。

## 本輪阻礙

| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| GitHub Actions Worker regression job 的競爭測試失敗 | CI FAIL | 實際 job log：測試執行完成，`Expected 1, actual 0`；前一斷言只對 response status 排序為 `[200, 409]` | 查閱 `orders.js` 的 expected-active-order guard；以受控 batch gate 新增 replacement-first 與 cancellation-first 兩個獨立案例 | 已驗證：原測試丟失操作身分，並把 ACTIVE=1 誤當唯一合法結果。取消先提交時，原單取消與退款成功、替換以過期 ACTIVE 條件回 409，ACTIVE=0 合法。現有 Worker transaction guard 未更動 |
| 首次 Git branch push 被 repo email privacy protection 拒絕 | REPO PRIVACY BLOCKED（已修復） | GitHub 回覆 push due to email privacy restrictions；沒有建立遠端 branch | 將尚未發布的 commit author/committer 改用 GitHub no-reply 格式；確認遠端 ref 仍不存在後再推送 | 已驗證：拒絕原因為 commit metadata 的私人 email 設定，非 repo 權限或 branch policy；未公開私人地址 |
| 隔離 Worker runtime／CORS smoke 無法抵達 | 外部網路 BLOCKED | Node DNS 回 `EAI_AGAIN`；curl CONNECT tunnel 回 403，尚未取得 Worker HTTP response | 執行 repo 的匿名 OPTIONS／401 smoke；分開確認 DNS 與 HTTP 路徑 | 已驗證：目前執行環境無法建立到 workers.dev 的連線；API/CORS runtime 結果 NOT VERIFIED，非 Worker HTTP failure |
| Cloudflare 目前 UAT Worker source SHA | METADATA UNKNOWN | 讀取現有 script settings、版本 #2 與 100% deployment；version metadata source=`api`，沒有 Git SHA annotation | 只讀盤點已部署版本與 bindings，未建立新 Worker | 已驗證目前版本／binding；該既有版本的來源 SHA 未保存，故 UNKNOWN。新版本需綁定最終整合 SHA |

## 個資發布檢查

- PII_SCAN：PASS；manifest 的 diff scan 與 new-file scan 均無命中。
- 新增的併發 fixture 僅使用既有合成 `user-1`、合成菜單與固定測試金額；沒有真實帳號、LINE ID、訂單或 ledger 資料。
- 公開 PR、commit、測試輸出與回顧不附真實截圖或正式資料對照。

## 驗證

- 原始失敗證據：GitHub Actions Worker regression job exit status 為 failure；不是額度不足。job log 對應此測試於舊行號 `142` 失敗。
- `npm ci --prefix worker-poc --cache /tmp/bento-order-app-npm-cache`：exit 0。
- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs`：exit 0，93 pass、3 skip。
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`：exit 0，38 pass。
- `npm test --prefix worker-poc`：exit 0，532 pass；含 replacement-first、cancellation-first 兩種受控交錯及帳務／ledger assertion。
- `node --test tests/invalid-employee-repair-ui.test.cjs tests/effective-order-item-name-ui.test.cjs tests/line-binding-transfer-ui.test.cjs tests/order-statistics-ui.test.cjs tests/local-mock-responsive-uat.test.cjs`：exit 0，27 pass；Chromium local Mock UAT，非遠端 API。
- `npm run lint`：exit 0；保留既有 warnings，未新增此檔警告。
- `npm run build`：exit 0；保留既有大 chunk warning。
- `git diff --check` 與兩項 PII_SCAN：exit 0。
- `tools/get-toolchain-capabilities.ps1`：NOT RUN，repo 中不存在 `tools/` 目錄或該腳本；一般 read-only `command -v` 已確認 Node、npm、npx、Chromium 可用。
- `BENTO_WORKER_BASE_URL=<existing isolated workers.dev URL> node worker-poc/scripts/remote-cors-smoke.mjs`：exit 1，fetch 未建立連線；不是 HTTP response。
- Node DNS + `/api/health` probe：DNS `EAI_AGAIN`；沒有 HTTP response。
- curl `/api/health`：exit 56，CONNECT tunnel 403；沒有 HTTP response。
- 隔離 Worker 目前 metadata：版本 #2 部署流量 100%；唯一 `DB` D1 binding 指向同名 UAT D1；無 R2 binding、Secrets、cron 或 routes。既有版本未保存來源 Git SHA。
- 未執行：真實 LINE Admin API、#103/#108/#111 authenticated E2E、正式 D1 migration／資料修復、正式 Worker 或 Netlify 部署。

## 改善建議

| 建議事項 | P0/P1/P2 | 本輪狀態 | 驗收條件 |
| --- | --- | --- | --- |
| 併發測試以可控 barrier 強制兩種提交順序，response 與操作身分保持配對 | P2 | 本輪修正 | 兩種 outcome 均逐筆驗證原單狀態、退款 reference、ORDER/REFUND 次數、ledger 順序與餘額 |

## 下一輪預防

- 觸發條件：同一訂單日的 replacement、cancel 或其他會改變 ACTIVE 狀態的操作競爭。
- 應追加的前置檢查／測試／規範：競爭測試必須保留每個 response 的操作來源，並先列全合法交易結果，再用可控同步確定重現每種 interleaving。
- 隔離 runtime gate 若因執行環境網路拒絕而未取得 response，保留 `NOT VERIFIED`；不得把 Cloudflare API metadata、Local mock 或 SQLite Worker contract 說成遠端 smoke PASS。
