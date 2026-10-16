# Public GitHub Privacy Gate（強制）

所有 Issue、PR、commit message、程式測試 fixture、文件、回顧、review、CI/log、截圖和交接資訊皆須經此 Gate。GitHub 即使設為 private，也以最小揭露為預設；不得把專案任務授權當成公開個資授權。

## 預設禁止公開
- 真實姓名、員工編號、學號、客戶／帳戶／訂單識別、電話、Email、地址、LINE user ID、裝置識別、session/token、可連結身分的螢幕截圖／URL/query，以及能拼接反查個人的真實資料。
- 單獨遮掉部分字元不必然匿名：小範圍、連續代號、特殊金額／筆數／日期與其他公開線索可能重新識別。必要時改用完全合成的代號與測試數量。
- **不要將真實值轉成穩定 hash 後公開**，低熵員編仍可被猜測；也不要把真實值寫在 Git commit 再刪掉。

## 標準寫法
- 使用完全合成的 `SOURCE_USER`／`TARGET_USER`、`EMPLOYEE_SOURCE`／`EMPLOYEE_TARGET`、`測試使用者 A`，例子用人工生成資料，不附真實值對照。
- 真實資料與測試代號的映射只在已授權的私有管道及最小必要範圍暫時處理，不加入 repo、公開 Issue、PR、CI artifacts、回顧。
- 需要說明功能時使用角色、狀態、約束與模擬資料；證據只保留最小聚合/遮罩、不可識別資訊。截圖在上傳前遮蔽所有敏感區塊及 metadata。
- 若任務必須在正式資料上比對，以存取控管環境驗證，不把實際值寫回 GitHub；要修改生產資料仍按原有明確授權與審計 Gate。

## 開發 Loop 的執行 Gate
1. **INTAKE/PLAN**：需求進入 GitHub 前先分辨識別欄位、替換合成資料；仍能回推則停止公開。
2. **IMPLEMENT/COMMIT**：檢查 staged diff、fixtures、console/debug output、截圖、commit message 是否含個資或 Secrets；測試輸出不得附原始值。
3. **PR/REVIEW**：Reviewer 額外審查 Issue body、PR body、comments、logs、artifacts、retrospectives，未去識別化為 BLOCKED，不可合併。
4. **HANDOFF**：只報合成案例與安全聚合證據；公開報告不可提供對照表。
5. **INCIDENT**：發現外洩，立即停止再轉貼，修訂目前可編輯內容、評估 PR/comments/commit history/通知/搜尋索引及 fork/caches 的殘留，依組織流程通報；**編輯 Issue 不等於抹除歷史**。不得未經核准 force-push 或刪除稽核。

## Issue / PR / retrospective 模板
- 使用者識別：`SOURCE_USER` → `TARGET_USER`（虛構）
- 情境：測試來源沒有有效交易、目標保留歷史資料（不附真實數值）
- 安全檢查：`PII_SCAN=PASS / BLOCKED / NOT VERIFIED`
- 驗證附件：僅去識別化摘要；必要的正式比對留在權限受控系統
- Reviewer：確認已檢查 Issue、PR、評論、diff、測試資料、日誌、圖片、回顧與 commit message
