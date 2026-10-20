# 2026-10-20 — Issue #123 Vendor RBAC 基礎切片

- Repository：`henryfir456/bento-order-app`
- 分支：`codex/issue-123-vendor-rbac`
- PR：未建立（依工作指示僅做本機切片）
- Base／目前 HEAD：已更新至 Issue #122 合併後 main；修改尚未提交（精確 SHA 保留於本機交接，不寫入公開回顧）
- 本輪目標／實際修改：新增由 Worker D1 主體與 membership 推導 Vendor 身分的唯讀 context API，限制 Vendor 權限，並阻擋員工 guest、員工訂單、身份移轉／修復與員工餘額路徑使用 Vendor 主體。
- 交付狀態：PARTIAL；本機自動驗證通過，尚未獨立審查、提交、合併或部署。

## 本輪阻礙

| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| #122 合併後需重新接合 migration 順序 | 依賴 | 已確認最新 main 含 `0017_protected_account_auth_audit.sql` | 將本機切片更新至該 main，保留 #122 安全邏輯；0018 順接，schema 與 Worker gates 重跑通過 | 已解除；未提交 |
| 尚無受審核的 Vendor principal/membership 維護流程與真實身分映射 | 範圍外前置 | 本切片僅有 schema、合成 fixtures 與唯讀 API | 沒有建立真實映射或外部資料 | 已驗證缺口 |
| Legacy GAS 不讀取 Worker Vendor principal/membership | 相容性／安全前置 | `users.role` 保留為 `User`；GAS 無法由本 migration 推導 Vendor | 本輪未修改 GAS。任何真實 Vendor 啟用前須先使其無法經 Legacy GAS 取得員工能力，並做獨立驗證 | 已驗證限制 |
| Vendor shell/UI、日常訂單讀取與收款對帳尚未實作 | 範圍 | #123 僅完成後端基礎切片；#124/#125 另有領域與資料依賴 | 本輪不擴展至 UI、結算或付款 | 已驗證未完成 |

## 個資發布檢查

- PII_SCAN：PASS；追蹤 diff 與 5 個新文字檔分別掃描，沒有命中設定的身份或憑證樣式。
- 測試僅使用合成 user/vendor/LINE 識別；沒有新增真實身份、LINE ID、個人資料或正式資料匯出。
- 確認者：本機作者；獨立 Reviewer 尚未執行。

## 驗證

- `node --test worker-poc/tests/vendor-rbac.test.js worker-poc/tests/formal-schema.test.js worker-poc/tests/permissions.test.js worker-poc/tests/roles.test.js worker-poc/tests/runtime-config.test.js worker-poc/tests/protected-account.test.js worker-poc/tests/orders-create.test.js worker-poc/tests/orders-delegated.test.js worker-poc/tests/line-binding-transfer.test.js worker-poc/tests/invalid-employee-repair.test.js worker-poc/tests/employee-claim.test.js`：PASS，146/146，退出碼 0。使用 repo fixture 建立的合成 protected-account mapping 滿足 #122 Worker readiness gate。
- `npm test --prefix worker-poc`：PASS，577/577，退出碼 0。
- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs`：PASS，90 passed、3 skipped、0 failed，退出碼 0。
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`：PASS，各套件 9/9、13/13、14/14、2/2，退出碼 0。
- `node --test tests/invalid-employee-repair-ui.test.cjs tests/effective-order-item-name-ui.test.cjs tests/line-binding-transfer-ui.test.cjs tests/order-statistics-ui.test.cjs tests/announcement-images-ui.test.cjs tests/local-mock-responsive-uat.test.cjs`：PASS，30/30，退出碼 0。這是本機 UI/mock 驗證，不代表遠端 API 或正式環境驗收。
- `npm run lint`：退出碼 0；有既存 lint warnings，包含 `worker-poc/src/domain/users.js` 的未使用 `clock` 參數及其他既存 warnings。
- `npm run build`：退出碼 0；Vite 提示 minified JS chunk 763.35 kB 高於 500 kB 建議值。
- `git diff --check`：PASS，退出碼 0。
- `git diff --unified=0 origin/main | node scripts/pii-scan-public-artifacts.mjs --diff-stdin`：PASS，退出碼 0。
- `git ls-files --others --exclude-standard | xargs -r node scripts/pii-scan-public-artifacts.mjs`：PASS，掃描 5 個新增文字檔，退出碼 0。
- Migration 0017/0018 僅在本機 SQLite migration/test harness 驗證；沒有套用正式或隔離 D1 migration，沒有部署 Worker。
- 人工獨立審查、CI、正式/隔離 API、真實 LINE 帳號及前端實機：NOT VERIFIED。

## #124/#125 依賴建議

- [Issue #124](https://github.com/henryfir456/bento-order-app/issues/124)：需先有 #123 的正式會員維護與 server-derived `vendor_id` scope。現有 orders 保存 `vendor TEXT`，vendors 才有 `vendor_id`；歷史資料不可模糊比對顯示名稱，應先核定精確 alias／canonical 對照或新增受審核的訂單 `vendor_id` snapshot。日單再按 Taipei `service_date`、有效狀態及 #103 effective item name/snapshot 聚合，並界定結帳前暫算與結帳後可稽核版本變更；支付分配交由 #125。
- [Issue #125](https://github.com/henryfir456/bento-order-app/issues/125)：依賴 #124 可重算、已界定狀態的應付金額及訂單快照；應另建不可變更的廠商收付 ledger 與分配／反向事件，支援部分款、跨月、退款、調整、爭議與 idempotency。外部轉帳由管理者線下完成後登錄，不接銀行 API；Vendor 僅能確認或提出自己資料的爭議，不得新增、修改或沖銷付款。
- 建議順序：已完成 #122 migration 0017 與本分支 0018 的本機順序核對 → 完成會員管理與 GAS deny/route 安全前置 → #124 canonical scope/日單 → #125 append-only 結算帳本與對帳。

## 改善建議

| 建議事項 | 優先級 | 本輪處置 | 驗收條件 |
| --- | --- | --- | --- |
| #122 合併後重編並重跑 schema/worker gates | P0 | 已更新本機基底並通過 local gates；待獨立 review | migration 清單無衝突，從最新 main 的全套 gates 與獨立 review 通過 |
| 真實 Vendor 啟用前完成 membership 管理稽核及 Legacy GAS deny | P0 | 未實作；前置阻擋 | 審核流程、可追溯 audit/回復路徑及 GAS/Worker 跨入口拒絕測試通過 |
| 建立 #124/#125 schema 和狀態轉換審查 | P1 | 僅列依賴，不重做規格 | canonical order vendor mapping、有效狀態、收款分配與逆向事件模型獲獨立審查 |

## 下一輪預防

- 觸發條件：本機切片交由父任務審查與後續處理。
- 應追加的前置檢查／測試：在相同精確 head 執行 PII_SCAN 與獨立 review，檢查跨角色、跨租戶、View As、GAS 與帳務邊界；若有任何修改，重跑受影響 gates。
