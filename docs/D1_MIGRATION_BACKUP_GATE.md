# 正式 D1 Schema Migration：備份與發布 Gate

此文件補充 [HISTORY_MIGRATION_POLICY.md](HISTORY_MIGRATION_POLICY.md)、[WORKER_DEPLOYMENT_POLICY.md](WORKER_DEPLOYMENT_POLICY.md) 與 [FORMAL_WORKER_RELEASE.md](FORMAL_WORKER_RELEASE.md)，不得降低原有 FULL_PREFLIGHT 或正式資料保護要求。

## 決策順序（Fail closed）
1. 發布前唯讀比較正式 D1 migration ledger、實際 schema／index 與新 Worker 的欄位依賴。若 schema 缺漏，**不得先部署會讀取新欄位的 Worker**。
2. 分類：純加欄位／索引的 schema migration、資料轉換、個案身份或帳務修復三類分別驗證與授權；「只改 schema」不得暗中執行個案修復。
3. 先確認帳戶／專案**已核准**的獨立備份目的地。候選可以是 D1 原生可保留備份、受控的私有 R2，或獨立受控離線儲存；不能僅因 bucket 存在便判定已核准。核對最少權限、存取者、加密、保留期限、與正式 DB 隔離、匯出完整性、復原操作權限及成本。
4. 備份需具備不可混淆的時間、來源 D1 ID／migration 版本、大小與雜湊、保存位置的**非敏感識別**、可存取／可還原驗證證據。必要時在隔離環境做還原演練，不得用正式 D1 作破壞性還原測試；不得將備份或秘密上傳 GitHub。
5. 取得上述證據且完成 FULL_PREFLIGHT 後，方可執行已審核 migration；核對 migration ledger、欄位／索引、重要資料筆數、foreign_key_check、讀取與必要交易路徑。失敗停止新版 Worker 部署，記錄復原決策，不自動破壞性 rollback。
6. schema 驗證成功後，回到既有 fresh-main build → Worker 新版本／設定 before-after → 100% deployment → 有界 smoke。前端發布另依使用者授權，不因 Worker 成功直接發布 Netlify。

## Blocker 分類
- `SCHEMA_BLOCKED`：正式 schema 未滿足新 Worker 相依；禁止切換流量。
- `BACKUP_BLOCKED`：沒有已核准且可驗證還原的備份；不得執行 migration。
- `ENVIRONMENT_BLOCKED`：如 sandbox npm 安裝 EPERM；可使用乾淨受信任 runner 補做原命令，不將 ignore-scripts 冒充 npm ci PASS。
- `PRIVACY_REVIEW`：掃描命中需逐項溯源與審核；誤判可有紀錄地人工判定，不能聲稱掃描器原始 PASS。
- `RELEASE_BLOCKED`：必要部署驗證或授權缺失；記錄缺少的唯一最小資訊。

阻塞解除後應在既有授權內繼續交付，不反覆要求一般性的「繼續」指示；**不得**透過忽略 Gate、使用舊 Worker、重新寫入正式個案帳務或猜測備份位置解除阻塞。

## 本次實例（不含真實資料）
若新 Worker 需要 `users.invalid_reason` 而正式 D1 尚無此欄位，必須先完成 `0015_invalid_employee_marker.sql` 的正式備份／migration／驗證，再部署 Worker。正式個案修復是獨立作業，不能因 schema migration 自動執行。
