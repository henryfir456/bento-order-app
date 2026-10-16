# AGENTS.md

本檔僅適用於 `80_bento-order-app` 儲存庫；規則必須自足，不得依賴上層 AI 工作區。

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

## 正式後端直接部署（必要；禁止 GitHub Actions）
- **正式部署禁止 GitHub Actions**（包括 push、workflow_dispatch、re-run 或工作流程代部署）。部署只允許在已授權的直接執行環境使用 Wrangler CLI，或透過已連線的 Cloudflare 外掛/API **上傳由最新 `main` 完整來源新建置的 Worker bundle**。先依當次可用能力與最近成功紀錄選擇可靠方式；不得只因無法使用 Wrangler 就跳轉 GitHub Actions。
- 兩條直接路徑的共同前置：核對最新 GitHub `main` SHA、`worker-poc/wrangler.jsonc` 的 `bento-api-poc` 和正式 D1 `bento-formal` 綁定，使用完整來源／模組相依與鎖定依賴，通過必要 Worker 測試。保留既有 Secrets、D1 binding、排程、CORS、compatibility_date 與所有正式設定；禁止為了上傳而自行簡化或改寫 Worker 邏輯。
- **Wrangler CLI 路徑**：`npm ci --prefix worker-poc`、`npm test --prefix worker-poc`，在 `worker-poc/` 執行 `npx wrangler deploy --config wrangler.jsonc --keep-vars`。使用本機或已授權的直接 shell，不得透過 GitHub Actions。
- **Cloudflare 外掛/API 路徑**：取得相同最新 `main` 的完整 Worker 來源及可驗證的新建置產物，使用 Cloudflare Worker upload endpoint 上傳**新程式碼**並發布正式流量。要核對部署 bundle 真正包含這次修改、原本模組/授權/D1/Secrets/排程未遺失；以嚴格繼承或等效保留現存 bindings 的安全上傳方式執行。不能用舊版 script 回傳內容、少量補丁、拼湊缺漏模組或把既有 Worker Version 再部署一次代替新建置。Cloudflare 紀錄 `source=api` 應如實標為 API，不得假稱 Wrangler。
- **正式驗收**：記錄來源 main SHA、新 Worker Version ID、Deployment ID、100% 流量，執行無副作用的 `/api/health`、身分授權、CORS 與此次新增 API contract smoke；Netlify 前端正式部署與手機/LINE 實機驗收分開記錄。缺任何必需證據時不得宣稱正式交付。
- **失敗處理**：優先調查當天成功的直接 API/CLI 上傳實例及其完整原始碼建置方式；缺工具、缺 bundle、模組/設定不明時停止正式寫入，回報 `WAITING_FOR_DELIVERY` 並明列阻礙，不可改用 GitHub Actions、要求補 Actions Secrets、重發舊版本或要求使用者重複授權。

## 正式部署方式選擇與歷史踩雷（必讀）
- **凡涉及 Worker 正式部署、無法部署、切換部署通道或設定 Cloudflare Git 建置，開始前先讀 `docs/DEPLOYMENT_METHODS_AND_LESSONS.md`**，按其中決策樹選擇通道並查最近成功案例；完整實作步驟再讀 `docs/FORMAL_WORKER_RELEASE.md`。
- Cloudflare **原生 Git 整合／Build Trigger 與 GitHub Actions 是不同服務**；前者並不因本專案禁止 GitHub Actions 而自動被禁止，但必須證明符合來源 main SHA、完整新 bundle、正式 bindings/Secrets 保留、100% deployment 與 runtime smoke。單純 Build Success **不得**宣稱部署完成。
- 部署回報須記錄「採用路徑、排除其他路徑原因、來源 SHA、Version/Deployment ID、設定 before/after、smoke」；失敗原因與證據等級寫入同類 retrospective。不得反覆試用已知不適用的 Actions、舊 bundle、單模組 patch 或無授權 shell。
- 本節是既有**禁止 GitHub Actions 正式部署與 fail-closed 安全要求**的選擇指引，不放寬任何既有交付 Gate。

## 可重複正式 Worker 交付入口（Issue #104）
- 請先讀 `docs/FORMAL_WORKER_RELEASE.md`，依順序執行可稽核的 fresh-build、正式部署、設定保留比對與 Runtime smoke。
- `node worker-poc/scripts/prepare-formal-release.mjs` 僅在乾淨 main checkout 上進行正式 Worker dry-run bundle 準備和 SHA-256 manifest，不會上傳或部署；完整測試與獨立 Review 仍是必需關卡。
- 缺完整建置產物、API upload metadata／Secrets 保留證據、必要驗證或授權身份時應 fail closed，切勿重新發佈舊 Worker 或將 CI 測試冒充生產驗收。

## 版本、異動紀錄與繁中翻譯關卡
### 版本升級判定（目前 0.x 的專案自訂慣例）
- **PATCH**（例如 `v0.16.1`）：錯字、UI 微調、Bug 修正及不擴充主要功能的相容性修補，不得因小幅修改誤升 MINOR。
- **MINOR**（例如 `v0.17.0`）：新增完整頁面、重要操作流程、重大 UI 里程碑或使用者可感知的主要功能擴充。
- **MAJOR**（`v1.0.0`）：首次進入正式穩定版，必須經完整功能與實機／正式環境驗收，確認核心功能、角色／權限、訂單與帳務，以及資料相容性。進入 `1.x` 後，如有破壞相容性的變更，應提升 MAJOR。
- **注意**：上述 `0.x` PATCH／MINOR／MAJOR 使用方式是本專案明訂的管理慣例，**不是完整照搬 Semantic Versioning 對 `0.x`（初始開發階段）版本的標準語義**。若新增里程碑需判定升級幅度，應依本節並記錄理由。
- 已發布的歷史版號與 Changelog 不得為配合新慣例而回溯重編；以新發布版本向前演進。

### 單一版號與介面模式
- 同一次正式發布，必須使 `package.json`、`package-lock.json`（根版本及 `packages[""].version`）、`CHANGELOG.md` 最新正式版本條目與 `src/data/changelog.js` 該版本的**繁體中文翻譯**完全一致。若缺任何一項，版本檢查必須失敗，禁止合併或交付。
- `CHANGELOG.md` 是正式版本歷程來源；使用者可見的頁尾版號透過現有 `APP_VERSION` 從 CHANGELOG 取得（僅依現行邏輯回退到 package 版本），**禁止另建寫死的 UI 版號或各元件自行維護版號**。
- **經典介面及新介面屬於同一個應用程式版本**，只改變介面顯示偏好；切換時不得更改 `APP_VERSION`、更新任何 package／Changelog 版號、產生新版本標籤，也不得讓畫面顯示兩套不同的版號。只有正式發布功能或修正時才依 PATCH／MINOR／MAJOR 決定升級。
- 每項使用者可感知的功能新增、Bug 修正、行為／權限變更，在合併與正式交付前，必須評估是否需要建立正式版本；同一批發布可共用一個版本，不得為純文件、測試或內部整理虛增版本。
- 建立正式版本時，必須於**同一 PR／同一交付範圍**同步更新 `package.json` 版本、`CHANGELOG.md` 的正式版本段落及 `src/data/changelog.js` 的對應**繁體中文** UI 文案。若存在鎖檔版本欄位，也須保持一致。
- `CHANGELOG.md` 是正式版本歷程來源；`src/data/changelog.js` 是使用者介面的繁體中文翻譯，不得使用英文直出、空字串或刪除缺翻譯例外來規避驗證。
- 正式版不得缺少繁體中文分類或異動內容；新版本不得加入歷史 `LEGACY_UI_RELEASES` 例外清單。
- 在 PR／部署前執行 `node --test tests/changelog-migration.test.cjs`，並通過 lint、build 及必要業務回歸；CI 的版本驗證 FAIL 時不得合併、部署或宣稱完成。
- 純文件／內部治理修改若不發布新版本，應在交付回報明確註明「不升版」及原因。
- 涉及使用者介面的修改時，另須確認前端實際發布與快取狀態；僅部署 Worker 無法更新已部署的前端 JS。
- 若缺少可用的前端部署方式或正式環境驗證證據，應分別回報後端及前端的部署狀態，不得宣稱整體線上問題已修復。

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

## 已退役傳輸治理
Cloudflare Worker + D1 是身分、授權、餘額及新功能唯一正式傳輸與事實來源。前端只能將明確的 GAS adapter 保留為受限舊版回歸邊界；未提供傳輸設定時預設使用 Worker。不得為傳輸相容性重建第二套身分事實來源。

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

## 驗證
命令及必要順序以 `agent.yaml` 宣告為準。專案技能可增加領域特定檢查，但不需要任何上層工作區檔案。

## RWD 功能等價性（必要）
- UI 同一資料在手機卡片與桌機表格等 breakpoint 應保留相同授權功能，包括搜尋、排序欄位與方向、操作與交易明細入口；不得只驗收桌面版。
- 裝置可以採用不同排版，但必須共用資料過濾／排序狀態及權限判斷，不得因 CSS 隱藏表格標題就失去操作入口。
- 每次新增或修改管理介面，補充手機窄 viewport 與桌面 viewport 的互動回歸測試；若無瀏覽器環境，需標示實機／視覺驗收 NOT VERIFIED，不可假稱已通過。

## 開發回顧（每輪修改交付前必填）
每次實際程式、文件、流程修正後，依 `docs/retrospectives/README.md` 建立／更新對應任務回顧，列明遇到的阻礙（無則明寫無）、嘗試與根因信心、測試命令及實際結果、遺留事項、P0/P1/P2 建議與下次預防。PR 須連結回顧。開工先查看同類回顧以避免重複踩坑；優先合併重複改善而非每次開新 Issue。回顧不取代既有安全 Gate、正式 `main` 交付規則、簽到的實機結果證據或便當的 Worker/D1 部署驗證；敏感日誌、憑證與個資不可寫入 Git。
