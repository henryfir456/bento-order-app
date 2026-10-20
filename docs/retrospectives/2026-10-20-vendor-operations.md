# 2026-10-20 — Vendor portal and settlement workflow (#123–#125)

- Repository: `henryfir456/bento-order-app`
- Branch: `codex/issues-123-124-125-vendor-portal`
- PR: [#137](https://github.com/henryfir456/bento-order-app/pull/137)
- Verified base/main SHA prefix: `01f3749`
- Feature head reviewed by an independent agent: `139d087`; this retrospective update requires a final-head re-review.
- 本輪修改：新增獨立 Vendor principal/membership 授權、廠商每日訂單視圖、管理員手動銀行轉帳登記與分攤更正，以及 Vendor 確認／爭議流程；加入隔離 UAT Wrangler 設定與合成 Mock 瀏覽器測試。
- 交付狀態：程式與測試完成；UAT D1 migration 與 Worker 部署完成；因執行環境無法連線 workers.dev，HTTP／瀏覽器對實際 Worker 的驗收未完成；等待最終 head 複核及合併。

## 本輪阻礙與結果

| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因／後續需要 |
| --- | --- | --- | --- | --- |
| Wrangler CLI 缺少遠端 API token | TOOLING_LIMITATION | `wrangler d1 migrations list --remote` 不能使用，未提供 `CLOUDFLARE_API_TOKEN` | 未建立或擴大憑證；改用已連線 Cloudflare API 只操作明確 UAT 資源。Wrangler dry-run 由 `worker-poc/node_modules/.bin/wrangler` 成功完成 | 不需 CLI token；不應為此建立新憑證 |
| UAT D1 migration | COMPLETED | 唯讀前檢查：migration 0000–0015；users=2、orders=0、vendors=0、balance_ledger=0；Worker `DB` UUID 與 UAT D1 UUID 相同 | 逐份套用 0016–0019，各筆 schema 與 `d1_migrations` 記錄一同寫入；全部 HTTP 200。完成後 migration 共 20 筆，`orders.vendor_id` 存在，users=2、orders=0、vendors=0、ledger=0、vendor_principals=0、vendor_memberships=0、快照=0、付款=0 | 未讀取或匯出使用者列 |
| 隔離 UAT Worker 部署 | COMPLETED | Wrangler dry-run：421.13 KiB（gzip 82.76 KiB），只綁定 UAT D1；上傳版本雜湊與本機 bundle SHA-256 相同 | 版本 3 綁定 PR head `139d087`；部署切至 100% UAT 流量 | 隔離 workers.dev URL 已記錄在 PR 與交付回覆；此為隔離測試部署，不是正式 Worker |
| Worker HTTP smoke／CORS | NETWORK_EGRESS_BLOCKED | Node fetch 回 `EAI_AGAIN`；環境 proxy 的 HTTPS CONNECT 回 403；Cloudflare connector 的 fetch 回「requests ... are not allowed」；web 工具也無法開啟 workers.dev | 已嘗試 Node smoke、無 proxy 的網路權限請求、curl、Cloudflare connector fetch 與 web 開啟；沒有收到 Worker HTTP 回應，未將其記為通過 | 需允許驗收執行器對上述 UAT URL 的 443 outbound，或由可正常連網的授權瀏覽器執行唯讀 smoke；完成 `/api/health`、匿名 401、CORS 與 Vendor UI/API 驗收 |
| Vendor LINE／真實登入 | HUMAN_IDENTITY_PENDING | 沒有既有、已核准的 UAT Vendor LINE 登入身分或有效 membership | 未建立帳號、LINE 憑證或 membership；Mock 只以合成資料測試 | 需提供／核准既有 UAT Vendor 測試身分與對應的 canonical user、`vendor_principal`、有效 `vendor_membership`，再驗收本人範圍、View As 與跨店拒絕；不可用 Mock 代替 |
| Legacy GAS Vendor 隔離 | ACTIVATION_GATE | Repo 將 GAS 標為退役，但無法從程式庫證明外部部署不可達；舊 adapter 不讀 D1 Vendor membership | 未更動或部署 GAS | 在啟用任何真實 Vendor membership 前，須確認舊 GAS 已不可達或實測其拒絕 Vendor 身分，並完成有審核的 membership 維護流程 |

## 獨立審查

- 審查對象 `139d087`；審查者唯讀檢查 RBAC、租戶隔離、帳務不變量、migration 與 PII 掃描例外。
- P0/P1：無；建議可合併程式碼整合。reviewer 確認 ProxyAdmin/User 無管理結算路徑，Vendor 由有效 membership 取得 scope，結算不寫員工 `balance_ledger`。
- P2：migration 對未知 vendor 名稱保留 `vendor_id=NULL`，不得猜測歸屬；正式套用前需盤點未對應筆數並由授權程序明確處理。本次 UAT orders=0。
- P2：Admin 結算讀取目前要求 vendor 啟用；停用 vendor 的歷史資料無法由該 API 讀取。保留為稽核可用性待辦，不影響 UAT 空資料驗收。
- Final-head independent review 尚待本文件 commit 後補做。

## 個資與資料邊界

- PII_SCAN：追蹤 diff 與新增文字檔均 PASS。UAT Wrangler 資源名／UUID 的數字掃描豁免只限精確路徑與欄位；測試證明同檔 `line_user_id` 仍會被攔截。
- UAT 前後只保留 schema、migration 名稱及聚合數量；未讀取、匯出或上傳正式個資，也未操作正式 Worker／D1。
- 未建立真實帳號、訂單或 ledger 記錄，未建立或擴大憑證權限，未付費。
- Issue #111 的 APAC 條件選擇只在適用前提下使用；本次沒有建立正式備份或正式資料匯出。

## 驗證

- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/pii-scan-public-artifacts.test.cjs`：93 pass、0 fail、3 skipped。
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`：9/9、13/13、14/14、3/3 pass。
- `npm test --prefix worker-poc`：598/598 pass。
- UI regression + `vendor-operations-ui` + responsive local Mock：33/33 pass；Chromium 375px／1280px。畫面明確標示 `LOCAL MOCK · 非 LINE／非實際 API`。
- `node --test worker-poc/tests/runtime-config.test.js`：6/6 pass。
- `npm run lint`、`npm run build`、`git diff --check`：exit 0；lint 有既存警告，build 有既存 bundle size 警告。
- UAT Wrangler dry-run：exit 0；421.13 KiB（gzip 82.76 KiB），唯一 binding 是隔離 D1。
- GitHub PR workflows 綁定 head `139d087`：5/5 completed success；傳統 commit statuses 為空，repo 尚未配置 required checks，不將其標示為 PASS。
- UAT migration 0016–0019：全部完成；末次 aggregate counts 未變，Vendor principals、memberships、settlement records 均為 0。
- UAT deployment API：新版本、100% traffic、`DB` 單一綁定、無 secret binding、無 schedule。
- 實際 Worker HTTP smoke：BLOCKED；執行環境 egress 阻擋，未驗得 health／CORS／受保護 API 回應。
- Local Mock browser PASS 不代表 Worker API、LINE／LIFF 真人登入或正式交付。

## 下一步與驗收 gate

- 完成此記錄更新後，請 reviewer 以最終 commit SHA 重做獨立複核；檢查 PR head、CI 與 main 再合併。
- 對隔離 UAT URL 完成 `/api/health` 200、`/api/me` 與受保護路由匿名 401、瀏覽器 CORS、已授權 Vendor 月訂單／付款讀取／確認與爭議實測；若本執行器仍無法連網，需明確記為外部驗收待辦。
- 真實 Vendor 啟用前：Legacy GAS 不可達／拒絕驗證、membership 維護流程已審核、歷史訂單 vendor 映射完成盤點；正式 D1 migration、備份／還原、正式部署與真實資料修改另行核准。
