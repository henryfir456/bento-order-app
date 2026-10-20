# 2026-10-20 — Vendor portal and settlement workflow (#123–#125)

- Repository: `henryfir456/bento-order-app`
- Branch: `codex/issues-123-124-125-vendor-portal`
- PR: pending
- Base/main SHA: verified against the current remote main; exact source SHA is tracked by the PR head
- Current source state: local changes based on the verified main; final commit SHA pending
- 本輪目標／實際修改：新增獨立 Vendor principal/membership 授權、廠商每日訂單視圖、管理員手動銀行轉帳登記與分攤更正，以及 Vendor 確認／爭議流程；加入隔離 UAT Wrangler 設定與合成 Mock 瀏覽器測試。
- 交付狀態：PARTIAL；PR、獨立審查、遠端 UAT migration/deploy、合併尚未完成。

## 本輪阻礙

| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| Wrangler CLI 無遠端 API token | TOOLING_BLOCKED | UAT `wrangler d1 migrations list --remote` 因缺少 `CLOUDFLARE_API_TOKEN` 未執行遠端查詢；沒有建立或擴大憑證 | 使用已連線 Cloudflare API 做唯讀 D1／Worker 預檢；UAT Worker dry-run 成功 | 已驗證：CLI 遠端命令需要未提供的 token；Cloudflare connector 可讀取目前隔離目標。是否能安全完成 migration/deployment 仍待實作驗證 |
| UAT D1 初始 schema 落後本分支 | UAT_SCHEMA_PENDING | 遠端 `d1_migrations` 只有 0000–0015；聚合 counts：users 2、orders 0、vendors 0、announcements 0、ledger 0 | 已確認資料庫 UUID 與 UAT Worker `DB` 綁定相符；未讀取或匯出任何使用者資料 | 已驗證：尚須依序套用 0016–0019，並在寫入前再次比對目標與 migration 狀態 |
| Vendor 身分／LIFF 真人登入 | HUMAN_TEST_PENDING | 尚無經授權的 UAT Vendor LINE 身分或可用登入工作階段；mock 與 Worker API 分別驗證 | 未建立 LINE 帳號、憑證或會員對應 | 已驗證：本機 Mock 不代表 LINE 或 Worker API 身分驗證；需使用既有獲授權的 UAT Vendor 帳號完成登入驗收 |

## 個資發布檢查

- PII_SCAN：PASS；兩條 manifest 指定命令均通過。UAT Wrangler 的名稱／資料庫 UUID 以路徑與欄位型別限定例外處理；掃描器測試確認同檔其他數值身份欄位仍被阻擋。
- UAT 只讀檢查輸出僅保留 schema、migration 名稱與聚合筆數；未讀取、匯出或上傳正式個資。
- Issue／PR／commit／測試輸出／截圖／評論使用合成資料；最終公開發布檢查待執行。

## 驗證

- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/pii-scan-public-artifacts.test.cjs`：exit 0；92 pass、0 fail、3 skipped。
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`：exit 0；各套件 9、13、14、3 tests pass。
- `npm test --prefix worker-poc`：exit 0；598/598 pass。
- `node --test tests/invalid-employee-repair-ui.test.cjs tests/effective-order-item-name-ui.test.cjs tests/line-binding-transfer-ui.test.cjs tests/order-statistics-ui.test.cjs tests/announcement-images-ui.test.cjs tests/vendor-operations-ui.test.cjs tests/local-mock-responsive-uat.test.cjs`：exit 0；33/33 pass，含 Chromium 375px/1280px local Mock 瀏覽器流程。
- `node --test worker-poc/tests/runtime-config.test.js`：exit 0；6/6 pass。
- `npm run lint`：exit 0；有 repo 既存警告，無新增 Vendor feature lint warning。
- `npm run build`：exit 0；Vite bundle 799.10 kB，仍有既存 chunk size warning。
- `XDG_CONFIG_HOME=/tmp/bento-wrangler-config npm exec wrangler -- deploy --dry-run --config wrangler.uat.jsonc --outdir /tmp/bento-uat-bundle`：exit 0；bundle 421.13 KiB（gzip 82.76 KiB），僅列出 UAT D1 綁定；NOT DEPLOYED。
- `git diff --check`：exit 0。
- `git diff --unified=0 origin/main | node scripts/pii-scan-public-artifacts.mjs --diff-stdin`：exit 0，PII_SCAN PASS。
- `git ls-files --others --exclude-standard | xargs -r node scripts/pii-scan-public-artifacts.mjs`：exit 0，7 個新增文字檔 PII_SCAN PASS。
- Cloudflare UAT API 唯讀 `PREFLIGHT_MODE=FULL`：Worker 設定只綁定 UAT D1，compatibility date `2026-09-07`，`standard` usage model；目前 deployment traffic 100%；無排程。D1 最新 migration 0015；users=2、orders=0、vendors=0、announcements=0、ledger=0。只讀 probe 成功，沒有修改資料。
- MOCK_TEST_PASS：Vendor portal local Mock browser test at 375px and 1280px; visibly labeled `LOCAL MOCK · 非 LINE／非實際 API`。
- INTEGRATION_TEST_PASS：NOT RUN。
- REAL_DEVICE_ACTION_ACCEPTED：NOT RUN。
- REAL_DEVICE_OUTCOME_VERIFIED：NOT RUN。
- Worker deploy、D1 migration、UAT HTTP smoke、LINE 身分與真實帳號互動：NOT RUN；等待獨立審查後執行隔離 UAT 寫入。

## 改善建議

| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 新增或指定一個既有 UAT Vendor LINE 測試身分與授權 membership | P1 | 等待現有人類身分與安全對應流程；本輪不建立真人帳號或擴大憑證 | #123–#125 | 完成 LIFF 登入、本人 Vendor 範圍、拒絕 View As／跨店家存取的外部驗收 |

## 下一輪預防

- migration／deployment 寫入前再次以 Cloudflare API 核對 UAT Worker 名稱、`DB` UUID、migration history、受影響資料的聚合數量、部署設定與排程。
- 不將瀏覽器 Mock、Wrangler dry-run 或未驗證的 HTTP 結果寫成實際 API／LIFF 驗收。
- 正式 Worker、正式 D1、真實帳號／訂單／ledger 修復、正式備份匯出與 Netlify 發布均不在本輪範圍。
