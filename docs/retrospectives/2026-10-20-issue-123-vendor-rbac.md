# 2026-10-20 — Issue #123 Vendor RBAC 基礎切片

- Repository：`henryfir456/bento-order-app`
- Branch：`codex/issue-123-vendor-rbac`
- PR：[PR #136](https://github.com/henryfir456/bento-order-app/pull/136)，目前仍為 Draft；精確版本與即時審查、CI 狀態以 PR 為準。
- Base：Issue #128 PR #135 合併後 main；新增 migration `0018_vendor_principals_and_memberships.sql` 尚未套用任何遠端資料庫。
- 交付範圍：新增 Worker D1 主體與 membership 推導的 Vendor 唯讀 context API；不建立真實 Vendor 身分、membership、ledger 或 GAS 權限。

## 獨立審查與修正

前一個 PR 版本經獨立審查為 BLOCK。審查以合成 SQLite 交錯確認：Vendor principal 若在路由預查後、寫入前建立，員工 claim、LINE 綁定與管理者儲值仍可操作 Vendor 使用者。訂單寫入也有相同身分邊界風險。另發現本文件原先描述 PR 尚未建立及審查／CI 尚未執行，已與實際工作狀態不符。

目前修正將 Vendor principal 條件加到資料庫寫入邊界，涵蓋員工 claim、LINE 與員工 ID 綁定、共用餘額 ledger、訂單建立／取消、管理者員工綁定及角色更新。儲值以同一原子批次的 claim predicate 阻止競態，同時避免留下儲值 audit 或 idempotency 記錄。新增可控同步競態測試，在實際寫入前插入合成 Vendor principal，檢查身分、訂單、餘額、ledger、audit 及 session 狀態均不被改動。

每次 PR head 更新後，獨立 reviewer 與 CI 都必須對同一精確版本重新檢查；即時結果以 [PR #136](https://github.com/henryfir456/bento-order-app/pull/136) 為準。本文件不抄錄自我參照的 commit SHA。此前版本的 Actions 成功狀態不代表後續修正已驗證。

## 安全與資料範圍

- `users.role` 保持原樣；Vendor 主體與 memberships 由獨立 schema 表示，請求端不能指定 Vendor 身分、membership 或其他使用者 scope。
- Employee guest/session、員工訂單、身份轉移／修復、LINE 綁定、員工角色與帳務寫入均在 Worker 寫入條件再次排除 Vendor principal。
- 測試只使用合成 user、vendor、LINE ID 與訂單資料；沒有新增真實身份、個資、憑證、Vendor mapping 或 ledger 資料。
- Migration `0018` 僅在本機 SQLite migration/test harness 驗證；沒有部署 Worker、執行正式或隔離 D1 migration、匯出正式資料或修改正式帳務。
- Legacy GAS 尚未使用本 migration 的 Vendor principal/membership。正式啟用任何 Vendor 前，仍須先建立 GAS deny／跨入口驗證與可稽核的 membership 維護流程。

## 驗證與限制

本輪本機驗證：

- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/pii-scan-public-artifacts.test.cjs`：PASS，92 passed、3 skipped、0 failed。
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`：PASS，退出碼 0。
- `npm test --prefix worker-poc`：PASS，588/588。
- `node --test tests/invalid-employee-repair-ui.test.cjs tests/effective-order-item-name-ui.test.cjs tests/line-binding-transfer-ui.test.cjs tests/order-statistics-ui.test.cjs tests/announcement-images-ui.test.cjs tests/local-mock-responsive-uat.test.cjs`：PASS，30/30；這是本機 Mock/UI 驗證。
- `npm run lint`：PASS，退出碼 0；仍有既有 lint warnings。
- `npm run build`：PASS，退出碼 0；Vite 顯示 JS bundle 764.79 kB，高於 500 kB 建議值。
- `git diff --check`：PASS。`git diff --unified=0 origin/main | node scripts/pii-scan-public-artifacts.mjs --diff-stdin`：PASS，未命中設定的身份或憑證樣式。`git ls-files --others --exclude-standard | xargs -r node scripts/pii-scan-public-artifacts.mjs`：PASS，沒有未追蹤文字檔。
- 工具能力探測 `tools/get-toolchain-capabilities.ps1`：BLOCKED，宣告路徑不存在且執行環境沒有 `pwsh`；這不影響以上已實際執行的本機命令。遠端服務能力另行保留為 NOT VERIFIED。

PR 精確 head 的獨立 review 與 Actions 狀態以 PR 即時記錄為準，不以之前版本的 5 項成功 Actions 代替。此前版本 Worker 577/577、根目錄測試 92 passed／3 skipped 只屬於前次精確版本。

遠端隔離 Worker API 的 HTTPS CONNECT 在代理層回應 403，請求未抵達 Worker，因此本地 SQLite／Mock 測試不代表遠端 API 或正式環境驗收。不得以其他 Cloudflare 操作或替代網路通道繞過此限制。

## Issue #124／#125 後續依賴

- [Issue #124](https://github.com/henryfir456/bento-order-app/issues/124)：仍需先核定 canonical `vendor_id` 與歷史訂單對照；現有 orders 保存 `vendor TEXT`。不得模糊比對名稱或回填正式資料。日單需依 Taipei service date、有效狀態、#103 菜單快照及可追溯的 cutoff 後版本變更聚合。
- [Issue #125](https://github.com/henryfir456/bento-order-app/issues/125)：需另建不可變更的廠商收付 ledger 與分配／反向事件，支援部分付款、跨月、退款、調整、爭議及 idempotency。線下付款由管理者實際完成後登錄；不接銀行 API，不使用員工 `balance_ledger`。
- 建議順序：Vendor membership 維護與 GAS deny 前置 → #124 canonical vendor scope／日單 → #125 append-only 結算帳本與對帳。
