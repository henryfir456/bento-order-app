# 歷史遷移及退役傳輸規範（自 AGENTS.md 原文遷移）

執行歷史資料、schema migration 或接觸 GAS 退役傳輸時由 AGENTS.md 強制載入。

## 歷史遷移延續治理
歷史遷移預設屬於執行工作，而非重新探索。除非具體驗證失敗需要，否則不得擴大成根因分析、全儲存庫分析或工作流程重設。

此規範補充 manifest 宣告的 `ap-safe-preflight` 與 `ap-verification-core`；不得修改 `.agents/skills/**`，因為這些是上游管理的 agent-platform 依賴，後續升級仍須能同步。

### 預檢模式
每次歷史遷移必須回報 `PREFLIGHT_MODE=FULL` 或 `PREFLIGHT_MODE=FAST`。

僅在以下任一條件成立時使用 `FULL_PREFLIGHT`：
- 此電腦第一次進行遷移工作；
- 電腦已更換；
- 儲存庫分支或 `HEAD` 發生非預期改變；
- schema 或 migration 版本改變；
- 遠端 D1 目標或 UUID 改變；
- 宣告的治理或技能路徑／版本改變；
- `FAST_PREFLIGHT` 發現不一致。

套用新 schema migration 前，必須先執行一次 `FULL_PREFLIGHT`。FULL 可以驗證儲存庫根目錄、分支、工作樹、`AGENTS.md`、`agent.yaml`、宣告技能與版本、遠端 D1 目標及 UUID、migration／schema，以及相關的遷移契約。若 FAST 原本已足夠但仍選用 FULL，必須回報升級理由。

在同一個已驗證環境與工作階段延續已核准的歷史匯入時，預設使用 `FAST_PREFLIGHT`，且只檢查：
1. 預期儲存庫與分支；
2. 工作樹沒有非預期修改；
3. 遠端 D1 目標與 UUID 未變；
4. migration／schema 版本符合預期；
5. 目前要修改領域的遠端重疊／筆數；
6. 此領域必要的 FK、重複與衝突檢查。

FAST 必須明確略過重複的 `AGENTS.md`、`agent.yaml`、宣告技能／版本驗證、全儲存庫文件掃描、已完成領域、無關表格／領域、已核准語義計畫的重新生成，以及廣泛歷史來源重新探索。FAST 若出現不一致，停止並升級為 FULL 後才能繼續。

### 正式 schema migration 備份閘門

正式 D1 套用任何新 schema migration 前，必須先完成並記錄獨立備份與復原驗證。D1 Time Travel bookmark 可作為額外復原資訊，但因它仍依賴同一個 D1、restore 會改動目標資料庫，不能替代獨立備份。

備份位置必須是專用、私有、與正式 D1 分離的物件儲存；確認對外網域未開啟、保留期限有明確核准、物件鎖涵蓋備份前綴，且 lifecycle 不會提早刪除備份。不得把備份放進共用或用途不明的 bucket，也不得將正式 dump、簽名下載 URL、憑證或含個資的驗證輸出放入 Git、Issue、PR、測試 log 或截圖。

備份完成後，必須以可用的最小權限讀取備份、核對 SHA-256 與保留設定，並將同一份 SQL 匯入隔離的暫存資料庫驗證 `integrity_check`、foreign keys、schema/migration 版本及聚合筆數。驗證輸出只記錄結果與聚合數值，不輸出個別資料列。完整程序見 [`docs/D1_BACKUP_AND_MIGRATION_RUNBOOK.md`](D1_BACKUP_AND_MIGRATION_RUNBOOK.md)。

任何一項備份位置、保留、讀取、雜湊或隔離復原驗證未通過時，禁止套用正式 migration。正式 migration 後若驗證失敗，先停止發布並保留證據；回復正式 D1 會覆蓋備份點之後的有效寫入，因此不得自動還原，必須先確認資料差異與取得該次回復授權。

### 已核准計畫的延續
歷史領域的語義計畫明確核准後，必須使用凍結的語義集合執行，不得每批重跑或重新解釋 planner。來源證據或序列化形式的差異不會使核准語義失效；只有會變更寫入目標、操作、值、身分／所有權、依賴或衝突狀態的實質語義漂移才需要停止審查。

### 批次與領域轉換
同一歷史匯入批次間不得執行 FULL 或全儲存庫預檢；只做有界寫入檢查與累計核對。寫入結果不明時，停止並核對遠端狀態，才可重試。

跨歷史領域（例如 Likes → Orders → Wallet）時，除非滿足 FULL 升級條件，否則對新領域執行 FAST；已完成及無關的領域不納入範圍。

新 schema migration 成功套用並驗證後，對相同 schema 的後續歷史資料匯入回到 FAST。

## GAS 驗證政策
`GAS_VERIFICATION_POLICY=NON_BLOCKING_LEGACY`

GAS 是 Worker/D1 現行流程已退役的傳輸。只有 GAS 的執行期與業務行為測試，不應阻擋 Worker/D1 schema migration 或歷史匯入；除非任務明確變更 GAS 執行行為，否則不得將 GAS 專屬測試列為必要關卡。未經明確要求，不得調查、建立 baseline、修正或歸因 GAS 專屬測試失敗。解析 `gas/bento_script.sql` 作為歷史遷移證據仍屬範圍且必須驗證。

此規範僅限此儲存庫，與上游 agent-platform 技能併用，不得修改共用技能內容。

## 已退役傳輸治理
Cloudflare Worker + D1 是身分、授權、餘額及新功能唯一正式傳輸與事實來源。前端只能將明確的 GAS adapter 保留為受限舊版回歸邊界；未提供傳輸設定時預設使用 Worker。不得為傳輸相容性重建第二套身分事實來源。
