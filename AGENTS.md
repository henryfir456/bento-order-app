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

## Cloud／Windows 本機執行環境分流（強制；2026-10-21）
本節是部署路徑選擇與故障處理規則，不構成新的正式資料寫入、Cloudflare 授權或自動部署核准；必須同時遵守本檔其餘安全 Gate、`docs/WORKER_DEPLOYMENT_POLICY.md`、`docs/FORMAL_WORKER_RELEASE.md`、`docs/DEPLOYMENT_METHODS_AND_LESSONS.md`。

1. **環境辨識（每輪開始一次）**：明確標示 `CODEX_CLOUD`、`WINDOWS_LOCAL` 或 `OTHER/UNKNOWN`，以實際 OS、執行器、網路政策與工具證據判定；不得用平台名稱推定具 Cloudflare 權限。分別記錄 GitHub 讀寫、Cloudflare connector、Wrangler CLI、網路 egress、授權身分、正式資源可讀性，區分 `NETWORK_BLOCKED`／`AUTH_REQUIRED`／`CONNECTOR_ERROR`／`TOOL_UNAVAILABLE`／`GATE_BLOCKED`。
2. **Codex Cloud**：優先完成程式、測試、Review、PR、合併與非正式 UAT。只有實測 Cloudflare API／Wrangler 在授權範圍可用且全部正式資料與發布 Gate 通過，才可走直接發布；shell TCP 失敗／HTTP 000 不是 Cloudflare 認證失敗，connector internal error 也不等於 API 永久不可用。最多一次有新證據的交叉能力測試，同一原因不得跨輪重試、繞過 proxy/allowlist，或要求使用者重複授權。
3. **Cloudflare Workers Builds（雲端無需 Codex egress 的候選方案）**：這是 Cloudflare 原生 Git 整合，**不是 GitHub Actions**。僅在核對既有 Worker `bento-api-poc` 是否已綁定 repo、production branch=`main`、root/config=`worker-poc/wrangler.jsonc`、正確 build/deploy command、Build Token 最小權限及 D1/Secrets/Cron/CORS/compatibility 保留後，才能選用。**禁止因本條文字而直接開啟無保護的 main 自動部署**：必須先設計並驗證部署前 Gate（最新 main SHA、完整 bundle、正式備份/還原、migration 與 owner mapping、release guard），確保 Build 在 Gate 未通過時不會執行 deploy。建立 Git 連線或修改 Cloudflare production Builds 設定屬正式部署控制面變更，必須有當次明確授權與變更證據；未確認即 `NOT CONFIGURED/NOT VERIFIED`。Git push、Cloudflare Build Success、Preview、合併 main 都不等於正式部署。
4. **Windows 本機**：若已具備合法網路路徑、Wrangler/Cloudflare API 授權及正式發布 Gate，使用 `docs/FORMAL_WORKER_RELEASE.md` 規定的直接發布；不可把本機 Mock、ADB reverse 或瀏覽器 HTTP 200 當正式證據。Cloud 不可連線時可以交付可執行、無密鑰的本機 runbook／命令，但不得把未在實際 Windows 執行的步驟記為 PASS。
5. **路徑選擇**：先查目前已配置且可驗證的直接 API/CLI 或受控 Cloudflare Builds；若直接通道受阻，再**評估**原生 Builds，不能為了避開 Gate 任意啟用；再不行則移交已授權的本機/其他執行環境。同一失敗路徑不無限重試，也不創建新的 Mock UAT 取代正式部署。嚴禁 GitHub Actions 部署正式 Worker。
6. **正式安全界線**：任何路徑均須先滿足正式 D1 備份 readback/hash、隔離還原、migration 順序與相容性、0017 受控 owner mapping、0019 歷史訂單非破壞性設計／核准，以及設定保留證據。不可因 Cloudflare Builds 能自動部署便跳過這些 Gate，亦不可把 Preview 作正式結算驗收。
7. **交付證據與降級**：逐項提供 runtime 類型、選擇路徑、API/CLI/Build 可用性（實際時間及錯誤類別）、來源 main SHA、migration 實際讀值、Worker version/deployment ID 和 100% 流量及正式無副作用 API smoke。缺一則對應項 `NOT VERIFIED`／`WAITING_FOR_DELIVERY`，可標示 `CODE_MERGED` 或 `LOCAL_UAT_PASS` 但不得宣稱正式完成；在既有 #104/#139 與 retrospective 記錄最小下一步與負責環境。

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

## 真實證據、RED→GREEN 與獨立驗收（強制）

涉及真實使用者畫面、裝置、外部服務／資料或重複失敗時，這一節是既有開發與 PR Gate 的必要入口；不得只增加一份無人載入的政策文件。

1. **Evidence custody**：先查閱本輪可取得的原始截圖、XML、activity/window/focus、log、版本及 SHA；記錄來源、擷取時間、原始檔是否可讀及隱私處理。所有 Issue、PR、測試、commit 與回顧繼續遵守本檔及 `docs/PRIVACY_PUBLICATION_GATE.md`。公開 repo 只放去識別化或完全合成、必要且明確標示的衍生 fixture；不得把重建節點、OCR/layout 資料稱為原始 dump，不得公開真實值的穩定 hash。
2. **Snapshot truth**：不同時間或來源的截圖、XML、activity/window 與資料不拼成同一快照。缺少 raw evidence 時說明缺口及可由現有來源支持的範圍；不臆造 node、bounds、資料值或外部操作結果，保留 `UNKNOWN`／`NOT VERIFIED`。
3. **Production-path RED→GREEN**：追查實際 gate、早期 return、break、exception、timeout／cancel、action dispatcher 與結果 verifier。在修正前以同一失敗輸入沿實際 parser／snapshot → policy → dispatcher 路徑確認 RED；實作後同測試確認 GREEN。孤立 policy test、檔案存在、lint/build 或自造的 happy-path 不足以證明根因重現。
4. **Adversarial regression**：覆蓋失敗及負向相鄰狀態（錯誤視窗／服務、重複或缺失控制、不可用的下一項、空輸入／root、service interruption、timeout／exception、授權等待、checkpoint／恢復及避免重複副作用），並驗證新增 gate 不阻斷合法流程。
5. **Independent review**：由非作者 reviewer 檢查同一完整 PR head 的差異、來源與衍生 fixture、RED/GREEN 輸出、PII_SCAN、所有相關 gate／return／break／exception 和錯誤處理；發現後修正再檢查最新 head。自動測試通過不等於 review 通過。
6. **Truthful handoff**：分列 `CODE_CHANGE`、`MOCK_TEST_PASS`、`INTEGRATION_TEST_PASS`、`REAL_DEVICE_ACTION_ACCEPTED` 與 `REAL_DEVICE_OUTCOME_VERIFIED`。只有最後一種的直接證據可宣稱外部結果已完成；未完成的裝置、LIFF、Worker／D1 或人工操作保留 `NOT VERIFIED`／`HUMAN_TEST_PENDING`，不得以本機測試取代。

## 外部服務 Readiness 與證據分級 Gate（強制；2026-10-18）
- 對網路、Secrets、身分／憑證、工具能力、外部 API 操作分別記錄 `PASS`、`FAIL`、`UNKNOWN`、`BLOCKED` 或 `NOT RUN`，每項附觀測來源、時間／revision、實際命令或請求結果。不得將 `UNKNOWN`、未執行、快照存在、設定已保存或工具缺席寫成 `PASS`／憑證失敗。
- 觀測狀態 `unknown`、環境變數 `unknown` 代表**沒有足夠當前證據**，不等於已失效；只有有界的已執行認證請求遭明確拒絕，才能判定相應憑證驗證 `FAIL`。過去 `ready` 不可直接替代最新 `unknown`。
- 對控制面政策需確認觀測仍為 current、spec/observed revision 一致及所需 `restricted/enforced` 狀態；執行器快照顯示 `restricted` 或 allowlist 有目的地主機，不等於已確認控制面 `enforced`。無法確認時 Gate 保持 `BLOCKED`，只做安全唯讀診斷，不得放寬為 Unrestricted、使用萬用字元或擴大代理／網域權限。
- 先辨識必要能力及可替代工具。缺 AWS CLI／boto3 並不等於無法驗證 S3，也不等於憑證錯誤；可評估既有 `rclone` 等 S3 相容工具。工具不存在、不能執行或能力不足，分類為 `TOOLING_BLOCKED`，列出安全備援與實際證據，不偽造 API 結果。
- **前置 Gate fail-closed**：尚未證明變數可用、網路策略符合政策、精確目的地主機獲允許及工具可用之前，不得進入具狀態的外部驗證。通過後仍先使用不含個資的合成資料，在授權範圍內執行寫入、讀回、完整性比對與有界清理；各步分別判定，不能以「沒有建立物件」冒稱刪除操作成功。
- Secret 只能透過受控環境注入；禁止將密鑰、簽名請求、完整敏感主機識別、個資或可還原識別資料寫入 GitHub Issue／PR／log／回顧。必須保留既有 PII_SCAN、Reviewer 獨立審查、Required Checks、權限、合併及部署政策。新增驗證規則不授權正式資料匯出、migration、資料刪除或生產部署。
- 遇 `UNKNOWN` 應報「待證實的觀測」與最小補證動作；遇 `BLOCKED` 應報具體阻塞、責任端及安全解阻途徑；只有實際執行且取得明確結果才可升格 `PASS`／`FAIL`。將重複出現的阻塞、替代工具決策及預防措施回寫既有 retrospective，並評估同步 ADL 與共用範本，避免孤立補丁。

## R2 備份與正式 D1 變更前置 Gate（強制）
- 任何正式 D1 匯出、R2 正式備份、schema migration 或 Worker 正式發布前，先完成上述 Readiness Gate 並遵守既有備份、正式部署與維護窗口授權要求；此節不覆蓋其他文件較嚴格的規則。
- R2 S3 驗證必須精確確認授權 endpoint 主機、restricted/enforced 網路與現行注入觀測；以獨立且不受 Bucket Lock 保護的測試前綴（若存在）執行合成物件上傳、讀回、SHA-256 比對及清理，不得為清理測試物件放寬 90 天保護或 lifecycle。
- Bucket Lock 若使清理不可行，記錄 `CLEANUP_BLOCKED`、物件處置與保存期限，不得聲稱已刪除或逕行變更鎖定；正式備份與發布仍遵循既有核准與 fail-closed 規範。

## PR 證據補齊與有限解阻流程（強制；2026-10-19）
- **先修復可修復阻塞**：遇到回顧缺漏、PR 缺連結、文件檢查未執行、CI 未觸發或外部服務異常，不得只回報 BLOCKED 就停止；應在既有授權內依序蒐證、補件、執行適用測試、要求獨立重新審查。每輪記錄精確 PR head SHA、證據 URL、命令／退出碼、觀測時間、責任端；同一根因最多三次有新證據的嘗試，禁止無效輪詢。
- **回顧自動補件**：有實際修改但缺少 retrospective 時，依本庫 `docs/retrospectives/README.md` 建立／更新該輪文件，在 PR 說明連結；不得以空白模板、推測根因或虛構測試結果充數。回顧為合併前 Gate，補件本身不能取代測試或審查。
- **分清檢查狀態**：將 GitHub Required Checks、Actions workflow、Commit Status、外部 Preview Build、本地／備援測試分別列帳，使用 PASS／FAIL／UNKNOWN／BLOCKED／NOT RUN／NOT APPLICABLE；沒有 Actions run、路徑篩選未觸發、GitHub API 沒有 statuses，都不是 CI PASS 或 FAIL。僅在核對實際設定與本次變更影響面後才能記 NOT APPLICABLE。
- **GitHub 規則查詢受限**：Rulesets 或 Branch Protection API 回傳 403，記錄原始錯誤類型（權限不足、功能方案限制等），改由有權限的 GitHub Settings 畫面、管理員／可稽核的設定輸出確認現行合併政策；無法取得時保留 UNKNOWN 與具體補證要求。不得因 API 403 直接推定沒有 Required Checks，也不得為解阻擅自更改保護政策、Repo 可見度、方案或權限。
- **外部 Preview／Build 失敗**：先取得失敗 build ID、來源 commit、完整可安全公開的診斷摘要，確認與本 PR 的關聯及該檢查是否為必需。相關則修復並重驗；無關的既存失敗也須有可重現證據與獨立 Reviewer 核准，只有合併政策允許才可記錄不阻擋。不得以「只有文件變更」逕行忽略真正的 Required Check；正式部署另遵守原授權與 Gate。
- **CI 額度與備援**：只有明確的額度錯誤才記 QUOTA_BLOCKED；得使用已核准、可重現的 Codex／本地備援進行相同範圍驗證，記錄其執行環境及證據，但不得冒充 GitHub Required Check 通過、規避計費或訂閱限制，亦不得減少既有必要測試。
- **精確 head 與合併**：任何提交改變 PR head 後，所有受影響 Gate 重新對最新 SHA 執行；獨立 Reviewer 檢查新 diff、原規範不弱化、PII_SCAN 與權限證據。只有適用必要測試、真實 Required Checks、獨立審查及本庫合併授權均滿足時，才可標記 Ready／合併；禁止因 GitHub 顯示 mergeable 就宣稱可安全合併。未授權正式資料、Secrets、Worker／Netlify 部署一律不執行。
- **解阻回報格式**：逐項列「Gate／狀態／精確證據／本輪已採取的解阻動作／仍缺什麼／有權處理者」；未知與未執行不得寫為 PASS。若仍阻擋，留下下一個可執行且最小授權的步驟，而非泛稱重試。對跨專案共通根因，評估同步 ADL 與 Template，保留差異化部署政策。

## GitHub 保護規則、Required Checks 與合併授權（強制；目前狀態確認 2026-10-19）
- 維護者於 2026-10-19 明確確認 agent-development-loop、agent-project-template、bento-order-app 目前都沒有 Branch Protection 或 Rulesets。對本次 PR 核驗，兩者均記為 NOT CONFIGURED。同日 main 分支摘要亦顯示 protected=false、Required Status Checks enforcement 為 off 且 contexts/checks 為空；Rulesets API 回傳空清單或因方案限制 403 的差異要如實保留。403 是該 API 的可觀測限制，不與本次維護者確認矛盾，也不得再單獨造成無限期 BLOCKED；若出現其他有效且較新的相反政策證據，先釐清後再合併。
- 透過 GitHub 保護規則設定的 Required Checks 狀態為 NOT CONFIGURED，絕不能記成 PASS。它與 Repo 內部必要 Gate 分開列帳；適用 Parser、Lint、Test、Build、PII_SCAN、獨立 Reviewer、權限、合併及部署安全規則仍然強制，任一必要 Gate 未通過仍阻擋合併。
- 此政策事實只代表 2026-10-19 的確認快照，不是永久假設。每個未來 PR 任務都要重新查詢目標分支 Branch Protection、包含 inherited rules 的 Rulesets、實際 Required Checks 與目前 Repo 設定；新發現的規則立即適用。若查詢回 403，記錄錯誤且最多做一次有意義的替代唯讀查核；本次有效維護者確認適用時依確認分類，否則保留 UNKNOWN 並列最小補證方式，不得由 403 推論 PASS 或規則存在。
- 必須分開記錄三件事：Repo 的 allow_auto_merge 只是 GitHub Auto-merge 功能是否啟用；Agent 是否獲准合併取決於本次明確的使用者授權及專案政策；手動合併另需目前 GitHub 身分具備 merge 權限。設定、授權或權限任一項都不能代替另外兩項。手動合併只在本次授權涵蓋、權限可查證且所有 Gate 通過時執行；不得因 mergeable、Auto-merge 設定或 reviewer 通過而推定授權，也不得自行啟用 Auto-merge。
