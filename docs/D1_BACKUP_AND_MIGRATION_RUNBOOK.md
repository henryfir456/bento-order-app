# 正式 D1 備份、復原驗證與 schema migration Runbook

本程序適用於正式 Cloudflare D1 的新 schema migration。它補充 [`HISTORY_MIGRATION_POLICY.md`](HISTORY_MIGRATION_POLICY.md) 與 [正式 Worker 發布 Runbook](FORMAL_WORKER_RELEASE.md)。備份與復原驗證未通過前，不得對正式 D1 執行 migration。

## 1. 備份位置門檻

正式備份必須寫入專用 R2 bucket；不要使用有其他用途、已有無關物件或用途不明的共用 bucket。備份 bucket 必須符合以下條件：

- 維持私有；停用 r2.dev 公開存取，且沒有啟用中的公開 custom domain。
- 與正式 D1 分開保存，並使用核准的儲存 jurisdiction。
- 只允許受控的備份流程存取。R2 S3 API 憑證應限於該 bucket；若使用 Worker/Workflow，R2 binding 只綁定該 bucket。D1 匯出憑證應獨立建立、限制在平台支援的最小 D1 權限，不得重用 Worker 發布憑證。憑證不得放入 Git、命令列參數、log 或聊天內容。
- 為備份物件前綴設定明確核准期限的 bucket lock；檢查 lock 規則已啟用且涵蓋實際物件 key。確認 lifecycle 不會在保留期限結束前刪除備份。不要在共用 bucket 設定全桶 lock。
- 保留期間、負責人、復原路徑與權限範圍記在受限的營運紀錄，不把實際帳號、bucket、database UUID 或物件 key 放進公開文件。

D1 Time Travel bookmark 可用於追蹤同一 D1 的時間點，但 restore 會修改該 D1，而且不會提供獨立的 R2 備份副本。因此它只是額外復原資訊，不能通過本節的獨立保存門檻。不要以正式 D1 執行 restore 來測試備份。

## 2. FULL preflight 與匯出

1. 對新 schema migration 執行 `PREFLIGHT_MODE=FULL`。在乾淨、最新的 `main` checkout 核對來源 SHA、正式 `wrangler.jsonc`、D1 名稱與 UUID、migration chain、目前遠端 `d1_migrations` 狀態及 migration SQL。若工作樹或目標不一致，停止。
2. 依核准的維護窗口準備匯出。D1 匯出可能暫時無法服務查詢；必須持續 poll 匯出工作，否則工作會自動取消。
3. 使用 Cloudflare D1 export API 的 polling 模式啟動全庫 SQL 匯出，保存回傳的 bookmark 作為私有稽核資訊，並以同一 bookmark 持續 poll 至完成。簽名下載 URL 約一小時有效，必須視為機密並直接串流到私有 R2；不得放入 log、Issue、PR 或 shell transcript。
4. 使用不含姓名、員編、LINE ID 或可反查身份的物件 key，將匯出寫入備份 bucket 的受鎖前綴。以串流方式計算 SHA-256，避免將 dump 寫入 repo 或一般 build artifact 目錄。

## 3. 驗證備份與復原能力

同一份備份需通過以下全部檢查：

1. 從 R2 以備份讀取權限取回該物件，重新計算 SHA-256，與上傳時結果相符；記錄大小與雜湊到受限營運紀錄，不公開 dump 或下載 URL。
2. 重新讀取 bucket 公開存取、custom domain、lock 與 lifecycle 設定。確認備份仍為私有、lock 規則涵蓋該物件，且 lifecycle 不會提早刪除。
3. 將同一備份匯入隔離的暫存 SQLite，不接正式流量、不連正式 Worker。執行完整 `PRAGMA integrity_check`（結果必須為 `ok`）、`PRAGMA foreign_key_check`（結果必須為零列），核對預期 schema/migration 版本及各受影響資料表的聚合筆數。若另使用暫存 D1，也不能省略這次 SQLite 完整檢查。只保留 PASS/FAIL 與必要聚合數值，不輸出資料列。
4. 保留復原演練的時間、執行環境、版本、結果及清理狀態；不得把還原資料庫或 SQL dump 當成公開測試 fixture。

任何檢查失敗、物件讀取權限不明、備份被 lifecycle 覆蓋，或無法在隔離目標完成復原，都代表 **BACKUP_NOT_VERIFIED**；停止，不得執行正式 migration。

## 4. 套用與驗證正式 migration

備份驗證通過後，再次確認遠端目標與 `d1_migrations` 未變，確認沒有其他 migration 正在執行，且待套用清單只有此次核准的 migration。專案發布命令會先驗證正式 D1 設定，再由 Wrangler 套用 migration：

```sh
npm run db:migrations:remote --prefix worker-poc
```

完成後確認：

- `d1_migrations` 僅新增預期 migration，且 `users.invalid_reason` 欄位與 check constraint、lookup index 符合 migration SQL。
- 正式 D1 執行 `PRAGMA quick_check` 為 `ok`、`PRAGMA foreign_key_check` 為零列。Cloudflare [支援的 PRAGMA 文件](https://developers.cloudflare.com/d1/sql-api/sql-statements/#compatible-pragma-statements)列有這兩項；本次 API 對 `PRAGMA integrity_check` 回傳 `SQLITE_AUTH`，不得將拒絕結果記為 PASS 或持續重試。`quick_check` 與完整 `integrity_check` 分別記錄；本節不能取代第 3 節對同一正式備份的隔離 SQLite 完整檢查。
- migration 涉及資料表的聚合筆數與 migration 前相同；此 migration 只變更 schema，不應改寫任何個別身份、訂單或帳務資料。
- 所有結果均以遮蔽或聚合方式記錄，沒有個別使用者值。

若 migration 或驗證失敗，停止後續 Worker deployment 並保留狀態供調查。不要自動 restore 正式 D1：它可能覆蓋備份建立後的有效訂單、身份或帳務寫入。任何正式資料庫 restore 都必須先評估寫入差異，並取得該次明確授權。

## 5. Worker 發布與紀錄

正式 D1 migration 驗證成功後，依 [`FORMAL_WORKER_RELEASE.md`](FORMAL_WORKER_RELEASE.md) 從最新 `main` fresh-build 並發布完整 Worker；確認 bindings、Secrets metadata、cron、Version、Deployment、100% traffic 與 HTTP smoke。禁止 GitHub Actions 部署。前端 Local UAT 與使用者自行發布 Netlify 是獨立流程；Agent 不發布 Netlify。

每次操作在受限營運紀錄保存：來源 main SHA、目標 migration、備份時間與 bookmark、私有物件位置、SHA-256/大小、lock/lifecycle 檢查、隔離復原結果、migration 前後聚合核對、Worker Version/Deployment 與 smoke。公開 retrospective 只記錄不含身份資訊的狀態、阻礙與改善措施。
