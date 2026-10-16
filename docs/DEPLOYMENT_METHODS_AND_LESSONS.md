# 正式 Worker 部署方式比較與踩雷紀錄

> 範圍：`bento-order-app` 正式後端 `bento-api-poc`（Cloudflare Worker + D1）。本檔提供**方式選擇與歷史教訓**；具體發版命令、設定與驗證以 [FORMAL_WORKER_RELEASE.md](FORMAL_WORKER_RELEASE.md) 為準；安全底線以根目錄 [AGENTS.md](../AGENTS.md) 為準。
>
> 最後整理：2026-10-16。**歷史敘述分級**：`REPO_CONFIRMED`（目前儲存庫文件／Issue 有明確證據）、`USER_REPORTED`（對話／操作回報，尚未取得完整 Cloudflare 原始證據）、`NOT_VERIFIED`（尚無足夠證據）。不要把推測寫成已驗證根因。

## 1. 永遠先確認交付目標

- GitHub `main` 必須是**已合併、已審查的最新正式來源**；fresh build 的來源 SHA 要與該 main 一致。避免從 PR head、個人暫存或先前產物發布。
- 目標為正式 Script `bento-api-poc`，正式 D1 `DB` → `bento-formal`（UUID 以 `wrangler.jsonc` 和 Cloudflare 現況雙向核對）；Secrets、所有 bindings、cron、compatibility date、路由與權限不得遺失。
- 「CI PASS」、「本機 build PASS」、「dry-run 產物生成」、「Cloudflare 新 Version 上傳」、「Deployment 建立」、「100% traffic」、「HTTP smoke PASS」是**不同狀態**。不得互相代替。
- 正式部署禁止透過 GitHub Actions（含 push、workflow_dispatch、re-run、排程及間接調用）。前端 Netlify Published commit、手機/LINE 實機驗收另設獨立 Gate。
- 沒有必須的工具、權限、fresh bundle、設定保留證據時 **fail closed**，回報 `WAITING_FOR_DELIVERY`，不得偷偷改走不安全替代途徑。

## 2. 方式比較：建議順序、適用條件、禁忌

| 方式 | 性質與優點 | 何時選用 | 已知風險／踩雷 | 現況與證據 |
| --- | --- | --- | --- | --- |
| **A. Cloudflare 原生 Git 整合／Build Trigger** | Cloudflare 平台直接從 Git 取得來源並執行建置，不需要 GitHub Actions runners 或其額度；適合標準化 Git→Cloudflare | 已確認 Cloudflare Git 連線、目標 branch、root/build/deploy 命令、授權與設定保留，且能取得新版本及 deployment 的真實證據時可優先使用 | **Git integration ≠ GitHub Actions**；Build PASS 不代表正式 Worker 部署、100% 流量、最新 SHA、bindings 安全或 Smoke PASS；不可只看到綠燈即關 Issue | **USER_REPORTED**：2026-10-16 對話回報已建立原生連線、Build Trigger 及成功測試；在本次文件整理所讀 Issue #104 仍保留未勾的 API 發版驗收項，**不能據此宣稱 #104 每個 API gate 皆通過**。要補 Cloudflare build/deploy/run URL、SHA、Version/Deployment ID 才可升級為 CONFIRMED |
| **B. Wrangler CLI 直接部署** | Wrangler 自行從完整原始碼建置、發布；避免 Actions 額度及 API multipart 手工處理 | 存在已授權可執行 shell、Cloudflare 身份與符合版本的 Node/npm/Wrangler，且 clean main 能執行完整驗證時 | ChatGPT 對話沒有取得本機執行能力時，不能假稱已在 Windows 本機部署；錯誤工作目錄、套件/環境差異、Secrets 覆蓋、錯誤 account 會出事 | **REPO_CONFIRMED**：AGENTS 與 runbook 記載正式 CLI 路徑及 `--keep-vars`；**NOT_VERIFIED**：本次未取得特定歷史 CLI 成功部署的原始回執 |
| **C. Cloudflare API 新 Version → Deployment** | 可由具權限 connector/API 執行，不要求本機 Wrangler deploy；可先上傳未發布版本，完成 before/after 比對再切 100% | 已取得 clean main fresh-build **全部**模組、實際 upload schema、授權身份、strict binding inheritance 及可讀回比較的資源 | multipart metadata 猜測、漏上傳模組、Secret/D1/cron 遺失、source=api 誤報 Wrangler；上傳 Version **不等於** Deployment | **REPO_CONFIRMED**：#104 與 runbook 有設計和受保護 uploader；runbook 明示 uploader **尚未實作正式 Deployment 建立**，API 回讀 schema 待真實驗證。不能把 dry-run 或新 Version 上傳當作已部署 |
| **D. GitHub Actions 執行 Wrangler／API 發版** | 一般專案常見 GitHub CI/CD 路徑 | **本專案不適用於正式後端發版**；非部署 CI 可繼續使用 | 曾遭遇 Actions 額度／執行環境阻塞、工作流程 job 異常；換 workflow 或追加 Secrets 不是本案解法 | **REPO_CONFIRMED**：AGENTS 已明文禁止作為正式部署通道；歷史逐次 job 失敗原因需以當次 run logs 查證，不得全部歸因額度 |
| **E. 直接重新部署既有 Worker Version／抓回舊 bundle** | 只能將已有版本重新指向流量，不會把最新 main 的修正送上雲端 | **不作為新程式交付方案**；獨立授權的版本回滾需另訂程序及證據 | 「部署成功」但程式碼仍是舊版；只 patch 單一 JS 易漏相依模組或資產 | **REPO_CONFIRMED**：AGENTS、runbook、#104 均明確禁止拿舊版本代替新建置 |
| **F. 臨時拼湊 bundle、只上傳入口 JS、複製既有 Script** | 看似繞過建置阻塞，但破壞完整性與可追溯性 | **一律不選用** | 依賴、授權流程、CORS、D1 binding、排程、compatibility 可能悄悄不一致 | **REPO_CONFIRMED**：#104 要求完整 module parts、bytes/MIME/SHA256；缺一即 fail closed |
| **G. 不具備授權的本機／聊天工具執行環境** | 是能力與環境限制，**不是發布方式** | 只做唯讀調查、編寫 runbook／產物 manifest；有真實執行權限時才使用 B/C | 不能把「我無法直接呼叫使用者 Windows shell」誤診成程式碼壞掉；亦不得因無法執行 CLI 就轉用 Actions | **REPO_CONFIRMED**：AGENTS 已要求缺工具即停止正式寫入、保留阻塞原因 |

### 特別釐清：Cloudflare 原生 Git 與 GitHub Actions

Cloudflare 在自己的建置環境對 Git commit 執行 Build Trigger，**不等於**在 GitHub-hosted Actions runner 執行 workflow。兩者應分別記錄觸發方式、來源 SHA、實際命令、憑證保護、產物及發版回執。Cloudflare 原生整合是否可以滿足本專案的完整設定保留及驗收，取決於該次實際部署證據，不能只靠「Git 已連接」推定。

## 3. Agent 直接採用的決策樹

1. **先讀本檔、AGENTS、FORMAL_WORKER_RELEASE 和最新同類 retrospective**；查 main SHA、Cloudflare 當前版本/部署、相關 Issue 的最新回執。**先查最近真正成功的方式**，禁止先重建另一套 pipeline。
2. 已有確認可用的 **Cloudflare 原生 Git** 正式發版通道？先核對 Git SHA、Cloudflare build command/root、設定保留、版本、100% deployment 及 smoke。全部可驗且符合專案政策 → 使用；只成功 build → 不得標 DONE，進入其他安全通道或記阻塞。
3. 有具權限直接 CLI 且 clean main／完整依賴／測試通過？走 **Wrangler CLI**，按 runbook 保留設定、發布、核對結果。
4. 沒有 CLI，但有 fresh-built 全部 modules、Cloudflare API 權限、嚴格繼承及完整讀回／部署能力？走 **API Version → gate → Deployment**；只具有實驗 uploader 時不得擅自發版。
5. 以上都不符合 → **WAITING_FOR_DELIVERY**，記明缺的是哪個具體 capability/產物/權限；不要改用 GitHub Actions、重發舊 Version、半套 bundle、要求再輸入已授權內容或無限制掃描所有歷史。
6. 後端完整通過後，再**獨立**核對 Netlify 前端與手機／LIFF；前端未確認時只能寫「Worker 已完成，前端 NOT VERIFIED」。

## 4. 踩雷逐項紀錄（原因與下次預防）

| 現象 | 不能直接推論 | 最小定位／解法 |
| --- | --- | --- |
| GitHub Actions 不執行、額度不足、run logs 不可讀 | 不等於 Worker 原始碼壞掉，也不代表 Cloudflare 原生 Git 不可用 | 依當次 GitHub 執行狀態分類：quota、runner、workflow、測試 FAIL；正式部署不要走 Actions |
| Cloudflare Git「已連線／Build Success」 | 不等於最新 main 已部署至 100% 正式流量 | 核對 commit SHA → Build ID → Version ID → Deployment ID → traffic → HTTP smoke |
| Cloudflare API 顯示 source=api、版本建立成功 | 不等於 Wrangler deploy、也不等於流量已切換 | 分開存 Version 與 Deployment；讀回所有 bindings／Secrets metadata、設定 diff |
| Wrangler dry-run、manifest/hash 完成 | 不等於程式已上雲；manifest 不是 Cloudflare Version | 先確認 main_module 及各 part，再由有權限的上傳／部署通道實作；dry-run 標 NOT DEPLOYED |
| 只拿到既有 Script 或單一 JS 檔 | 不能證明模組完整或包含最新 commit | fresh build 所有檔案、hash/MIME/entrypoint；缺檔就停 |
| 本機 shell／授權 connector 不可用 | 不能證明 Worker 程式錯誤 | 寫明 capability blocker，選其他**已被證明安全**的直接通道；不要無限重試同一失敗 |
| HTTP health 200 | 不能證明 View As、帳務、CORS、前端全正常 | health、匿名授權、CORS、變更 API contract 分項 smoke；需要特定憑證者 NOT VERIFIED |
| 後端修了，但使用者頁面不變 | 不一定是 Worker 失敗 | 分別檢查 Netlify published commit、Vite bundle、快取、LIFF 與 Worker API |
| 新版本保留欄位無證據 | 不能假定 Cloudflare 預設繼承安全 | 比對 before/after D1 UUID、Secrets metadata、cron、compatibility、bindings；任何不明 fail closed |

## 5. 不重踩雷的最小檢查清單

- [ ] `main` 已合併；clean checkout SHA 與 `origin/main` 相同
- [ ] 先查**最近一次真的部署成功**的 Cloudflare 回執，而非只看 GitHub PR、CI 或對話摘要
- [ ] 明確記錄選用 A/B/C、執行身份、平台及「為何其他路徑不適用」
- [ ] 核對正式 Worker 名稱、account、D1 UUID、全部 Secrets/Bindings、Cron、Compatibility
- [ ] 必要測試 PASS、fresh bundle 模組清單／hash 完整；沒有快取舊 bundle
- [ ] 新 Version ID 可查、Deployment ID 可查、100% traffic 可查
- [ ] 正式 /api/health、匿名 401、CORS、當次 API smoke；有合法測試帳號才驗 Admin/View As
- [ ] Netlify 前端 published commit、UI/LIFF 另外記錄；無證據就寫 NOT VERIFIED
- [ ] 將失敗嘗試、根因信心、證據連結和預防措施追加至任務 retrospective；不要提交密鑰、Token、含個資日誌

## 6. 每次部署嘗試的紀錄模板

```text
日期/任務/Issue：
選用方式：A Cloudflare Git / B Wrangler / C Cloudflare API / BLOCKED
選擇理由及排除其他方式理由：
來源 main SHA / clean checkout：
建置環境、Node/Wrangler 版本：
建置/測試結果（PASS/FAIL/NOT RUN）及實際輸出證據：
bundle hash / modules / main_module：
Cloudflare Build ID / URL（如適用）：
Version ID / Deployment ID / traffic：
設定 before/after（D1、Secrets metadata、bindings、cron、compatibility）：
正式 HTTP smoke（逐項 PASS/FAIL/NOT VERIFIED）：
Netlify Published commit / LIFF 驗收：
阻塞或踩雷（具體症狀、嘗試、根因信心及證據 URL）：
結論：DEPLOYED_VERIFIED / PARTIAL / WAITING_FOR_DELIVERY
後續預防／Runbook 是否需修訂：
```

## 7. 文件分工與維護

- `AGENTS.md`：強制規則、禁止事項、Agent 必讀入口。
- **本文件**：方式比較、歷史教訓、決策樹；新增成功或失敗案例時按證據等級更新。
- `docs/FORMAL_WORKER_RELEASE.md`：可執行命令、設定核對、API upload/deploy 與正式 HTTP smoke。
- Issue [#104](https://github.com/henryfir456/bento-order-app/issues/104)：完整獨立版本發版器的工程驗收；**Issue 勾選項應以實際證據更新**，不要因原生 Git 流程可用而自動判定另一條 API uploader 路徑全部完成。
- `docs/retrospectives/`：每次具體失敗與修正實證；本檔只保存可重複適用的模式。

**維護原則**：新的成功案例必須有來源 SHA、Version/Deployment、設定比對和 smoke；新的失敗案例必須標明「觀察、推論、已確認根因」三層，不得把推論當事實。