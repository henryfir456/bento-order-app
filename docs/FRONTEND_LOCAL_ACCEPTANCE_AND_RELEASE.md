# 前後端分離交付、Local 驗收與 Netlify 人工發布規範

> 適用：bento-order-app 全部功能／修復；由根目錄 AGENTS.md 強制引用。目標是避免重複消耗部署額度、Agent 越權發布前端，以及混淆程式交付與人工驗收。
> 優先級：本文件規定**前端發布授權與階段次序**；後端安全發版細節仍依 WORKER_DEPLOYMENT_POLICY.md 與 FORMAL_WORKER_RELEASE.md；涉及正式資料異動仍須遵循原有資料安全規範。相互矛盾時採較嚴格、較不會造成正式異動的要求，並通報衝突。

## 1. 固定預設流程（無須使用者重複交代）

1. Agent 完成修改、必要自動化測試、獨立審查、PR 合併至 main，記錄來源 SHA。
2. 如有 Worker／後端修改，Agent 從已合併 main 建置並正式部署 Cloudflare Worker，保留設定、驗證 Deployment/Version/traffic、執行有界且不修改資料的 smoke。正式後端禁止透過 GitHub Actions 部署。僅前端修改且無後端變更時，**不為了流程而重複部署 Worker**。
3. Agent 交付**本機前端測試資訊**：main SHA、後端 URL/版本、前端本機啟動指令、必要非機密 Vite 環境變數名稱與設定提示、測試步驟、已通過自動測試及尚待人工驗證事項。使用者在自己的電腦執行最新前端，連已部署的正式 Worker 進行人工驗收。
4. 使用者完成 Local 桌機／手機或 LIFF 驗收並明確表示可發布後，**由使用者自行操作** Netlify 正式前端發布。Agent 不得以「使用者要測試」推定已授權發布 Netlify，亦不得因 main merge 或 Worker 已部署而自動發布、重試發布、觸發 Netlify build/deploy。
5. Netlify published SHA/URL 與正式環境 UI／LIFF 驗收僅在使用者發布後記錄；發版前記為 `USER_RELEASE_PENDING`，**不是 Worker 交付 BLOCKED，也不是 Local 驗收 BLOCKED**。不得假稱正式前端已更新。

**例外**：僅當使用者在當次任務明確要求 Agent 代為部署前端，且有合適權限／安全驗證時，才可另行執行。一般預設為「使用者自行發布」，不因曾經同意後端自動部署而延伸授權 Netlify。

## 2. 驗收層級與回報用語

| 階段 | 可宣稱 | 不得宣稱 |
| --- | --- | --- |
| 自動測試／PR merge PASS | 程式已合併 main | 使用者已驗收 |
| Worker 部署與 smoke PASS | 正式後端已部署且 smoke 通過 | 正式前端已發布／整體功能實機通過 |
| Local 測試資訊已交付，人工尚未操作 | `READY_FOR_LOCAL_UAT` | Local UAT PASS |
| 使用者在 Local 測試回報成功 | `LOCAL_UAT_PASSED` | Netlify published |
| 使用者自行部署 Netlify 並驗證 | `FRONTEND_PUBLISHED_VERIFIED`（需 SHA 和真實證據） | 未驗證的 LIFF／裝置 PASS |

當 Worker 部署完成、Local 測試尚未完成，交付應寫「**後端已交付；Local 驗收待使用者；Netlify 發布由使用者控制**」，而非 `WAITING_FOR_DELIVERY`。若本次功能僅修前端，仍交付 Local 測試，Worker 欄列 `NOT APPLICABLE`，不得無故消耗 Worker 發版額度。

## 3. Local 前端對正式 Worker 的注意事項

- 本機 Vite 環境使用 `VITE_WORKER_API_URL` 指向正確已發布 Worker；涉及 LINE 時按專案既有合法 LIFF 設定使用 `VITE_LIFF_ID`，**不得把正式 token、密鑰寫入檔案、Issue 或 log**。
- 本機來源與 Worker 版本要核對契約相容性；若 CORS、LINE Login/LIFF 授權來源或 redirect 白名單不接受 localhost，應標 `LOCAL_AUTH_NOT_VERIFIED`，尋找已授權的安全測試方式，**不能為了方便測試放寬正式登入、CORS 或 LIFF 安全規則**。
- 對正式 Worker 的 Local UAT 可讀取資料；新增/修改/刪除訂單、帳務、綁定或其他正式 D1 寫入都須明確界定資料風險，遵循當次使用者授權與現有保護措施。不得以「本機頁面」誤判為「測試資料庫」。
- 無法取得合法 LINE Admin session 時，記錄正式管理員流程 `NOT VERIFIED`，不可改用直接 D1 SQL 繞過授權。
- 若使用者希望不碰正式資料，採隔離測試環境及測試身分；未證實隔離前不得執行寫入。

## 4. #107 LINE 綁定移轉驗收

1. 從 main 最新前端在本機開啟「使用者管理 → 檢視使用者 → 修正 LINE 綁定」；使用合法 LINE 驗證 Admin 登入，確認沒有處於 View As。
2. 執行 **唯讀預覽**：來源 139790、目標 139700；檢查來源沒有訂單/交易/餘額/其他阻擋關聯，目標原歷史資料保留且未綁其他 LINE。檢查拒絕案例和二次確認文案；無權限／有衝突不能提交。
3. 若測試將真的提交至正式 Worker，該操作會修改**正式 D1**。在使用者對本次實際移轉**明確授權**前僅允許預覽，不得替使用者代按確認或直接修改 D1。
4. 授權後由合規的 Admin 流程提交，核對唯一性、稽核、舊 session 重新驗證、目標 139700 登入、來源 139790 解除綁定，並唯讀核對訂單、金額、帳務未變。
5. 完成 Local 人工驗收後，由使用者自行選擇何時發布 Netlify；正式網站更新與 LINE 手機 LIFF 實測分項記錄，不可因後端 health 200 視為全部通過。

## 5. Issue／PR／回顧交付模板

```text
main SHA：
自動測試／獨立審查：
Worker：NOT APPLICABLE / DEPLOYED_VERIFIED / BLOCKED
Worker Version／Deployment／smoke（適用時）：
Local 前端：READY_FOR_LOCAL_UAT / LOCAL_UAT_PASSED / LOCAL_UAT_FAILED / NOT VERIFIED
本機啟動與安全環境設定（無機密）：
Local UAT 待測清單／已測證據：
正式 D1 寫入：NOT REQUESTED / PREVIEW_ONLY / EXPLICITLY_AUTHORIZED_AND_VERIFIED / NOT VERIFIED
Netlify：USER_RELEASE_PENDING / USER_PUBLISHED / FRONTEND_PUBLISHED_VERIFIED
Netlify published SHA（使用者發布後才填）：
正式 LIFF／手機驗收：NOT VERIFIED / PASS / FAIL
阻礙／下一步負責人：
```

不要為了滿足「全綠」先行部署前端、替使用者驗收或改動生產 D1。任何文件或 PR 中既有「前端未發布 = 後端交付阻塞」的解讀均以本文件澄清。
