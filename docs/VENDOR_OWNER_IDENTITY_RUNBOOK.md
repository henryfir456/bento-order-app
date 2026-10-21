# 禾拾廠商專屬登入身分轉換 Runbook

本文件和 `worker-poc/scripts/configure-vendor-owner.ps1` 定義未來的正式轉換程序。本次程式修改、合成測試與 PR 不會執行正式 D1 migration、正式資料轉換或 Worker 部署。

## 身分模型與 0017 保護對象

`RESERVED_VENDOR_OWNER` 是 Issue #122 所保護的既有禾拾 LINE 帳號持有人，屬於 **A：保護舊員工帳號所屬 canonical user 與其 LINE 所有權**。它不是 Vendor principal 本身的通用授權機制，也沒有證據顯示它服務另一項獨立帳號需求。保護 mapping 以 `users.user_id` 指定持有人；員編可保留作歷史與員工資料，不再作為 protected owner 的 canonical key。

禾拾的專屬登入別名由腳本中的字首 `V000` 和尾碼 `01` 組成，存於 `vendor_principals.vendor_login_id`，與 `users.employee_id`、`users.role`、`vendors.vendor_id` 分開。既有 `users.user_id`、`users.employee_id` 和 `users.line_user_id` 維持原值，`users.role` 仍是 `User`。公開身分投影只有在 Vendor principal、active membership 與 enabled canonical Vendor 同時成立時才回傳 Vendor；Vendor API 的 scope 只取自同一 canonical `user_id` 的 active membership。

經 LINE OAuth 驗證後，這個 Vendor 別名只會解析到已有該 LINE binding 的同一 canonical user。LINE 查找／綁定路徑只回報現況，不移動或建立 LINE binding。舊員編仍保留在受保護 owner mapping，員工 guest 登入與直接 guest-session 建立都會拒絕該舊員編；Vendor 別名也不能建立員工 guest session。`UNVERIFIED` 狀態不會由 mapping 或 Vendor conversion 自動提升。

`0017`、`0018` 尚未套用正式 D1：最近確認的正式 migration 是 `0014`。因此這次可修正未套用的 migration 定義。若任一目標資料庫已記錄 `0017` 或 `0018`，必須停止；不得重寫已套用 migration，需另立 forward-only migration 並重新審查。

mapping 尚未設定時，普通員工與一般業務 API 不會被全域 readiness 503 擋住。正式切換 Gate 要求在新 Worker 對外服務前先完成轉換並讀回 mapping；若 preflight／conversion 失敗，停止切換，不部署新 Worker。設定 mapping 後，以 `users.user_id` 作為 canonical protected identity，舊員工登入與一般員工 session 會被該 mapping 擋下。Vendor 登入、membership 與訂單隔離仍由 canonical LINE identity、Vendor principal、membership 和 API 授權共同檢查。

## 執行前條件

1. 變更已 squash merge 到 `main`，工作目錄為乾淨的 `main`，且本機 `origin/main` 與 `HEAD` 相同。
2. 使用者已確認禾拾是目前受保護員工帳號 LINE binding 的合法持有人。腳本仍要求執行者在正式寫入時明確重申這項確認。
3. 正式 D1 備份、R2 讀回與 SHA-256、SQLite `integrity_check`、`foreign_key_check`、八個主要表筆數，以及 90 天 Bucket Lock／Lifecycle 證據已由使用者提供。本輪沿用該證據，不重問或要求重做同一檢查。若備份後正式 D1 已有新寫入、schema 變更或備份不再代表本次變更前狀態，則 migration 前需按既有 [D1 backup and migration runbook](D1_BACKUP_AND_MIGRATION_RUNBOOK.md) 取得新備份與隔離復原證據。
4. Windows PowerShell 7 或 5.1、Node、Repo 鎖定版本 Wrangler 及正式 D1 所需既有授權可用。不要把 launcher 故障當 Windows 故障；若 `CODEX_EXECUTOR_BLOCKED`，停止重試相同 launcher，直接在已授權 Windows PowerShell 執行下列本機步驟。
5. 本次 PR 的程式／schema Gate、獨立 Reviewer、PII scan 和 squash merge 全部通過。這份文件或 SQL 腳本存在不表示任何 D1 操作已執行。

## Windows PowerShell 7／5.1 程序

以下命令從 Repo root 執行。操作需安排在既有正式維護窗口；migration、conversion、Worker deployment 分別記錄證據。正式 D1 應先套用 schema，再執行 identity conversion，最後依 [Formal Worker Release Runbook](FORMAL_WORKER_RELEASE.md) 部署使用新 schema 的 Worker。不可讓舊 Worker 長時間服務不相容 schema；如無法在核准窗口內完成整組程序，先停止並維持現有狀態。

```powershell
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'GIT_FETCH_FAILED' }
git switch main
if ($LASTEXITCODE -ne 0) { throw 'GIT_SWITCH_FAILED' }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'GIT_UPDATE_FAILED' }
$expectedMainSha = (git rev-parse origin/main).Trim()
if ($LASTEXITCODE -ne 0 -or $expectedMainSha -notmatch '^[0-9a-fA-F]{40}$') { throw 'MAIN_SHA_UNAVAILABLE' }
git status --short
if ($LASTEXITCODE -ne 0) { throw 'GIT_STATUS_FAILED' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'HEAD_SHA_UNAVAILABLE' }
```

確認 `git status --short` 空白，且 `HEAD` 等於 `$expectedMainSha`。接著進入 Worker 專案並查遠端 migration 狀態：

```powershell
Set-Location .\worker-poc
npm ci
node .\node_modules\wrangler\bin\wrangler.js d1 migrations list bento-formal --remote --config .\wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'D1_MIGRATION_LIST_FAILED' }
```

目標狀態必須符合已知正式 D1 在 `0014_taiwan_government_holidays.sql`，且 `0015` 至 `0021` 尚未套用。若狀態與此不符、已套用修改過的 `0017`／`0018`、目標名稱／UUID 不符，或 Wrangler 回報授權／連線錯誤，立即停止並保留原始錯誤類別；不得繼續 conversion 或改用其他未核准路徑。

備份與 migration Gate 通過後，依照正式部署政策套用目前 main 內全部待套用 migration：

```powershell
node .\node_modules\wrangler\bin\wrangler.js d1 migrations apply bento-formal --remote --config .\wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'D1_MIGRATION_APPLY_FAILED' }
node .\node_modules\wrangler\bin\wrangler.js d1 migrations list bento-formal --remote --config .\wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'D1_MIGRATION_READBACK_FAILED' }
```

第二次清單必須以 `0021_verified_vendor_settlement_sources.sql` 結尾。此處套用 migration 是未來正式程序，**本次開發沒有執行**。

先執行不寫入的 identity preflight：

```powershell
.\scripts\configure-vendor-owner.ps1 -ExpectedMainSha $expectedMainSha
```

腳本會要求執行者在遮蔽輸入提示中輸入從受控正式 D1 檢查取得的 canonical `user_id` 和現有 `employee_id`；輸入值不會顯示或寫入 Repo。Vendor login ID 由已審查的腳本常數產生，Apply 時仍需明確確認。只有三組 preflight `PASS` 且結尾 `DRY_RUN`，才進行正式 identity 寫入。Apply 需要明確參數、PowerShell `-Confirm` 互動核准，並由執行者確認 owner 權利：

```powershell
.\scripts\configure-vendor-owner.ps1 `
  -ExpectedMainSha $expectedMainSha `
  -Apply `
  -ConfirmLegalLineOwner `
  -ConfirmLegacyEmployeeLoginDisabled `
  -ConfirmVendorLoginId `
  -Confirm
```

腳本會再次核對 main SHA、乾淨工作樹、正式 Worker／D1 config、最新 migration、唯一 active owner、既有唯一 LINE binding、`UNVERIFIED` 狀態、禾拾 canonical Vendor、alias／membership 碰撞與 scope。它只會執行版本控制中的 `configure-vendor-owner.sql`，其操作限於新增 protected user mapping、Vendor login alias 與 canonical Vendor membership。腳本不輸出 canonical `user_id`、employee ID、LINE ID 或 Vendor login ID，不更新 `users`、`orders`、`balance_ledger`、付款資料或驗證狀態；同一操作可安全重跑。任何不匹配均停止，不應手動補欄位後繼續。

只有成功讀回下列條件後，腳本才輸出 `USER_EXECUTION_VERIFIED`：唯一 `RESERVED_VENDOR_OWNER` 對應既有 canonical user；該 user 有唯一 active `Vendor` principal 且腳本指定的專屬 login ID 唯一；唯一 active membership 指向資料庫中禾拾的 canonical `vendor_id`；沒有其他 active Vendor membership；canonical user、LINE binding、`UNVERIFIED` 狀態與訂單／ledger 聚合快照不變。後續需按正式 Worker release Gate 部署程式，並由合法測試身份驗證 Vendor API 只能讀取自己的訂單與對帳。

## 執行證據狀態

- **本次開發**：`AGENT_EXECUTION_NOT_RUN`。Agent 未執行正式 migration、PowerShell conversion、Worker deploy、正式資料讀寫或付款操作。
- **使用者既有證據**：正式 D1 export／R2 readback／雜湊／SQLite integrity 與 foreign key／主要表筆數／Bucket Lock 與 Lifecycle 均為 `USER_EXECUTION_VERIFIED`，沿用於本次評估，不重複要求同一驗證。
- **未來程序**：腳本生成不等於執行成功；只有 PowerShell 實際執行和腳本成功完成 readback 時，才能記錄 `USER_EXECUTION_VERIFIED`。Dry run 只能記錄 preflight，不能記為 migration 或 conversion 通過。
