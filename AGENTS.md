# AGENTS.md

本檔僅適用於 `80_bento-order-app` 儲存庫；規則必須自足，不得依賴上層 AI 工作區。

## 公開紀錄個資保護（強制）
任何 Issue、PR、commit、review、測試資料、回顧、日誌及截圖在寫入 GitHub 前，必須遵守 [docs/PRIVACY_PUBLICATION_GATE.md](docs/PRIVACY_PUBLICATION_GATE.md)：預設使用完全虛構代號與測試資料，禁止真實姓名、完整或可反查員編、LINE 識別、憑證及關聯敏感資訊；檢查未通過時阻擋發布與合併。Agent 開發 Loop 每階段執行 PII_SCAN，Reviewer 獨立覆核，歷史殘留另作事件處理。


## 啟動程序
1. 找出此儲存庫的 Git 根目錄。
2. 修改前先讀取根目錄 `agent.yaml`。
3. 閱讀 `PROJECT_STATE.md` 確認現況，並閱讀 `DECISIONS.md` 理解長期決策。
4. 驗證支援的 schema，僅解析 `agent.yaml` 明確宣告的儲存庫相對技能路徑。
5. 遵循宣告的 `ap-safe-preflight` 與 `ap-verification-core` 技能流程。

## 安全底線
- 保護任務開始前所有已暫存、未暫存與未追蹤的修改。
- 不得重設、還原、覆寫或清除無關的使用者工作。
- 缺少 `agent.yaml`、schema 不支援、欄位未知、路徑無效或必要技能不存在時，只能進行唯讀診斷。
- 不得用全域、上層、外掛、最新版或其他位置的技能取代 manifest 宣告但缺少的技能。
- `agent.yaml` 所列命令不代表已獲執行授權。
- 任務的實作流程需要時，可以提交及推送。
- 便當系統正式後端工作預設必須合併至 `main` 並部署正式 Cloudflare Worker，除非使用者明確要求不合併或不部署。
- **正式後端部署禁止 GitHub Actions**：可由已授權 Cloudflare API 新 bundle 上傳或直接 Wrangler CLI 部署；不可透過 `push`、`workflow_dispatch`、re-run、排程或任何 GitHub Actions job 執行 Cloudflare Worker 上傳、部署或版本切換。GitHub Actions 如存在，僅可用於非部署性的 CI 測試與檢查。
- 自動驗證與人工驗證必須分別記錄為 PASS、FAIL、NOT RUN 或 NOT VERIFIED。

## 交付關卡
本專案對外宣稱「完成／已交付」的依據是正式交付，而非分支或 PR 狀態。

凡涉及正式 Worker／後端程式路徑的任務：
1. 實作並執行必要的自動驗證。
2. 提交並推送變更。
3. 將經審查且通過驗證的變更合併至 `main`。
4. 從合併後 `main` 的版本部署正式 Cloudflare Worker。
5. 依修改範圍執行有界的部署後 smoke／contract 驗證。
6. 完成以上步驟才可向使用者宣稱已交付。

已推送分支、開啟／Draft PR、本地測試成功、Review 通過或顯示 mergeable，都不代表已交付。任一步驟受阻時，標記 `WAITING_FOR_DELIVERY`（或同等狀態），說明具體阻礙，並在可能時繼續完成交付流程。

一般便當後端工作不得要求使用者重複指示「合併 main 並部署後端」；只有使用者明確要求「不要合併／不要部署／只開 PR／正式環境前停止」才覆蓋此預設。

資料修復屬特例：正式資料異動可先完成，但預防性程式仍須合併 main、部署 Worker 並留下驗證紀錄，才能宣稱程式交付完成。

## 連續交付與驗收次序（必要）
- 使用者提出功能修改且未明確要求停止時，視為授權**同一工作流程連續完成**實作、必要自動測試、獨立審查、PR 合併、正式 Worker 部署及部署後有界 smoke；不得每完成一步便停下要求再次確認。
- 使用者人工操作／實機驗收一律放在正式部署後，不得以「等使用者先驗收」阻擋已通過必要自動驗證的合併與部署。唯有真實安全問題、自動檢查失敗或不可取得的部署憑證／環境等技術阻塞，才可停止。
- CI 失敗不得直接忽略或改成永遠成功；應先定位相關性、修復原因並重跑，對確定無關且原已存在的失敗需保留可重現證據並由獨立審查確認，不得假稱整體通過。
- 有前端 UI 異動時，後端與前端交付狀態須各自確認；僅部署 Worker 不代表使用者在前端能看到新功能。
- 對外最終交付回報須包含 main commit、Worker 版本／部署識別、部署後 smoke，以及前端部署狀態；未取得其中證據時不得宣稱完成。

## 前端 Local 驗收與 Netlify 發布權限（強制）
- **每次任務預設**：必要自動測試與獨立審查 → 合併 main →（有 Worker 修改時）正式部署 Worker 並 smoke → 交付使用者在本機使用最新前端驗收 → **僅由使用者自行發布 Netlify 正式前端**。不得要求使用者反覆提醒。
- **禁止 Agent 擅自部署 Netlify 前端**：main 合併、Worker 部署成功、使用者要 Local 測試，均不構成正式前端發布授權；除非當次任務明確另行授權 Agent 代為發布。
- Netlify 未發布應記 `USER_RELEASE_PENDING`，不得作為 Worker 已交付或 Local 人工驗收的阻塞；本機驗收尚未執行則記 `READY_FOR_LOCAL_UAT`／`NOT VERIFIED`，不得報 PASS。
- 本機前端連正式 Worker **不代表使用測試資料庫**；正式資料寫入（含 LINE 綁定移轉）需當次明確授權，缺合法 LINE Admin session 不得直接 D1 改寫繞過。
- 強制閱讀並遵循 [docs/FRONTEND_LOCAL_ACCEPTANCE_AND_RELEASE.md](docs/FRONTEND_LOCAL_ACCEPTANCE_AND_RELEASE.md) 的階段、環境與交付模板；任何其他文件的 Netlify Gate 敘述依此區分發布責任，不改變 Worker fail-closed 安全規則。

## 正式後端部署技術細則（強制）
涉及正式 Worker 部署時必須閱讀並遵循 [docs/WORKER_DEPLOYMENT_POLICY.md](docs/WORKER_DEPLOYMENT_POLICY.md)；保留既有 GitHub Actions 禁令、完整 fresh bundle、設定不遺失、Runtime smoke 及 fail-closed 要求。

## 正式部署方式選擇與歷史踩雷（必讀）
- **凡涉及 Worker 正式部署、無法部署、切換部署通道或設定 Cloudflare Git 建置，開始前先讀 `docs/DEPLOYMENT_METHODS_AND_LESSONS.md`**，按其中決策樹選擇通道並查最近成功案例；完整實作步驟再讀 `docs/FORMAL_WORKER_RELEASE.md`。
- Cloudflare **原生 Git 整合／Build Trigger 與 GitHub Actions 是不同服務**；前者並不因本專案禁止 GitHub Actions 而自動被禁止，但必須證明符合來源 main SHA、完整新 bundle、正式 bindings/Secrets 保留、100% deployment 與 runtime smoke。單純 Build Success **不得**宣稱部署完成。
- 部署回報須記錄「採用路徑、排除其他路徑原因、來源 SHA、Version/Deployment ID、設定 before/after、smoke」；失敗原因與證據等級寫入同類 retrospective。不得反覆試用已知不適用的 Actions、舊 bundle、單模組 patch 或無授權 shell。
- 本節是既有**禁止 GitHub Actions 正式部署與 fail-closed 安全要求**的選擇指引，不放寬任何既有交付 Gate。

## 重複發版操作入口（強制）
執行正式 Worker 發版，先讀 [docs/FORMAL_WORKER_RELEASE.md](docs/FORMAL_WORKER_RELEASE.md) 與 [docs/WORKER_DEPLOYMENT_POLICY.md](docs/WORKER_DEPLOYMENT_POLICY.md)。

## 版本與 Changelog（強制）
任何發版、版本、Changelog 或 UI 版本變更必須遵循 [docs/RELEASE_VERSION_POLICY.md](docs/RELEASE_VERSION_POLICY.md)；包含繁中同步與必要測試。

## 作業交接
- 可選用的建議性交接文件：`../agent-handoff/projects/80_bento-order-app/CURRENT.md`。
- 交接文件僅供操作參考，並非事實來源或必要依賴。
- 讀取後必須與此儲存庫的實際 Git 狀態核對；若與程式、測試、持久規格或 Git 狀態衝突，以本儲存庫現況為準，不可為符合舊交接內容而修改程式。
- 只有重大作業狀態變動或跨工作階段交接時才需要更新，不必每次 commit 都更新。

## 便當系統專案契約
- 現行正式架構是 Cloudflare Worker + D1；正式 Worker 是唯一正式後端，所有新功能都要在此實作。
- GAS 已完全退役。位於 `gas/` 的檔案、GAS adapter 與測試僅是舊版產物及回歸證據；未經使用者明確授權，不得新增 GAS API、身分／授權邏輯、Sheet 契約或業務邏輯。
- 前端為 React/Vite；`VITE_LIFF_ID` 與 `VITE_WORKER_API_URL` 是本機設定輸入，不得提交機密或改成電腦特定路徑。
- 維持 authenticated identity、View As identity、effective identity 三者區隔。
- 修改任一端時，必須保留現有 LIFF 認證、access token、Worker 授權及 D1 契約。
- 真實 LIFF 登入、View As、Worker 部署、正式 D1 行為需要人工或外部證據；不得僅靠本機靜態檢查便宣稱驗證通過。GAS 部署不是正式驗證目標。

## 退役傳輸（按任務強制）
Worker/D1 是唯一正式傳輸及身分事實來源；任何涉及 GAS adapter 的修改都必須遵循 [docs/HISTORY_MIGRATION_POLICY.md](docs/HISTORY_MIGRATION_POLICY.md)。

## 歷史資料遷移（按任務強制）
任何 schema migration、歷史資料匯入／修復，必須先讀 [docs/HISTORY_MIGRATION_POLICY.md](docs/HISTORY_MIGRATION_POLICY.md)，遵循 FULL/FAST preflight、來源及遠端 D1 比對。

## GAS 驗證（按任務強制）
接觸 GAS 舊版檔案或驗證時，必須遵循 [docs/HISTORY_MIGRATION_POLICY.md](docs/HISTORY_MIGRATION_POLICY.md) 的 NON_BLOCKING_LEGACY 限界。

## 驗證
命令及必要順序以 `agent.yaml` 宣告為準。專案技能可增加領域特定檢查，但不需要任何上層工作區檔案。

## RWD 功能等價性（必要）
- UI 同一資料在手機卡片與桌機表格等 breakpoint 應保留相同授權功能，包括搜尋、排序欄位與方向、操作與交易明細入口；不得只驗收桌面版。
- 裝置可以採用不同排版，但必須共用資料過濾／排序狀態及權限判斷，不得因 CSS 隱藏表格標題就失去操作入口。
- 每次新增或修改管理介面，補充手機窄 viewport 與桌面 viewport 的互動回歸測試；若無瀏覽器環境，需標示實機／視覺驗收 NOT VERIFIED，不可假稱已通過。

## 開發回顧（每輪修改交付前必填）
每次實際程式、文件、流程修正後，依 `docs/retrospectives/README.md` 建立／更新對應任務回顧，列明遇到的阻礙（無則明寫無）、嘗試與根因信心、測試命令及實際結果、遺留事項、P0/P1/P2 建議與下次預防。PR 須連結回顧。開工先查看同類回顧以避免重複踩坑；優先合併重複改善而非每次開新 Issue。回顧不取代既有安全 Gate、正式 `main` 交付規則、簽到的實機結果證據或便當的 Worker/D1 部署驗證；敏感日誌、憑證與個資不可寫入 Git。
