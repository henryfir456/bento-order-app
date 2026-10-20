# 2026-10-20 — Issue #122 保護既有廠商 LINE 身分

- Repository：`henryfir456/bento-order-app`。
- 核對 base：`main` SHA `709a0c6`；候選分支 `codex/issue-122-redacted`，目前程式碼候選 SHA `c1915cf`。
- PR 狀態：獨立複審候選 SHA 中；待複審完成後建立乾淨替代 PR。既有 Draft PR #133 含有不安全的公開歷史，不能合併，亦未改寫歷史。
- 本輪範圍：在 Worker 身分解析、員編訪客登入／註冊、LINE 員編查找／綁定、舊訪客 session、直接 provisional claim、Admin 員編綁定、LINE 綁定轉移、身份修復與 View As 全路徑保護受限 canonical account。保護 mapping 由 D1 受控表讀取；migration 只建立 schema，不建立真實 mapping。拒絕稽核不保存帳號或 LINE 識別；公開投影不回傳受保護 owner 的 LINE ID。未更改任何使用者、訂單、餘額或 ledger 資料。
- 交付狀態：程式和本機 gates PASS；精確候選 SHA 獨立複審進行中；尚未建立/合併新 PR。隔離 Worker runtime API 驗收 BLOCKED；正式 Worker、正式 D1 migration 和真實身分／帳務操作未執行。

## 修復與獨立審查發現

| 發現 | 證據與處理 | 狀態 |
| --- | --- | --- |
| Worker session 員編可遮蔽連結 canonical user 的受保護員編 | reviewer 對先前 PR head 以合成資料重現；增加 API 回歸測試並在每個可用 identity 來源獨立檢查保護身分。覆蓋 `/api/me`、onboarding、LINE bind，並確認拒絕後身份和稽核不含敏感欄位。 | 已修；候選 SHA 全套測試通過 |
| Readiness 只確認 mapping 存在，未確認 owner 可用 | 將唯一 owner 條件加嚴為單筆 canonical user、active、verified、未標 invalid、且已有非空 LINE binding；缺漏、歧義及不合格狀態都在業務寫入前回 503。 | 已修；新增合成 D1 測試 |
| D1 binding 缺失時 readiness 原先會被跳過 | `OPTIONS` 與健康檢查外，所有業務路由都無條件執行 readiness；缺少 D1 時回 `PROTECTED_ACCOUNT_CONFIGURATION_UNAVAILABLE` 503。測試確認身分服務未被呼叫。 | 已修；health/CORS 測試通過 |
| CORS 測試原本以缺少 DB binding 的 fixture 驗證 401 | 在這些 401/CORS 測試補上合成 D1 與受保護 owner fixture，讓測試驗證授權錯誤本身；另保留專門測試缺少 D1 時的 503。 | 已修；Worker suite 567/567 |
| 舊 PR #133 的變更與 commit 歷史含受保護識別資訊 | 新候選分支由目前 main 重播為獨立乾淨歷史；PII scanner 增補重複數字運算式規則和回歸測試。未嘗試 force-push、清除 Issue edit history 或宣稱外部副本已刪除。 | 新候選 diff 掃描 PASS；舊 PR 保持 Draft |

## 公開內容與地域條件

- 已重查 Issue #111 中的既有地域留言：原選擇是接受現有 R2 `default` jurisdiction（APAC），但前提為沒有更嚴格的資料落地限制。Repo runbook 要求 jurisdiction 有核准依據；目前可查政策與交付紀錄沒有證據證明上述前提成立，因此紀錄為 `REGION_POLICY_UNVERIFIED`。本輪未執行正式備份、D1 export 或 R2 寫入，也未重問已留存的 APAC 選擇。
- Issue #122 目前標題/內文已去識別化；是否仍有舊編輯內容存在於通知、索引、fork 或快取無法由本輪證據確認。既有 PR #133 保持 Draft，沒有改寫公開 commit history。乾淨替代 PR 待本輪獨立覆核完成後建立。

## 隔離環境與資料面驗收

- Cloudflare 唯讀控制面確認既有隔離 UAT Worker 的 `DB` binding 指向同名隔離 D1；檢查沒有讀取或輸出 Secrets。既有 deployment metadata 無來源 Git SHA，無法證明部署版本等於本候選 SHA。本輪未上傳 Worker、未套用隔離或正式 D1 migration，也未寫入測試 D1。
- 對管理面所確認隔離 Worker URL 的 `/api/health` 實際請求，在 HTTPS proxy CONNECT 階段收到 403，沒有收到 Worker HTTP response；runtime/API integration 為 `BLOCKED / NOT VERIFIED`。不以管理面讀取或本機 Mock 代替 runtime smoke，也沒有改走其他網路通道。
- 本機 Chromium Mock UAT 截圖（合成資料）保存在 `/tmp/bento-uat-evidence/footprints-375-mock-final.png` 與 `/tmp/bento-uat-evidence/footprints-1280-mock-final.png`。它們只證明 Mock UI，不代表隔離 API、LINE 身分或正式交付。
- 最小解阻：由管理端在既有核准網路政策下，允許執行環境對該隔離 Worker hostname 的 `443` HTTPS CONNECT egress，或提供已核准、可直達該隔離 Worker 的執行環境。這不是要求新增憑證或更改 Worker 權限；本輪不會以其他通道規避現有 403。

## 精確 SHA 驗證

以下結果均在候選 SHA `c1915cf` 的乾淨工作樹執行：

- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/pii-scan-public-artifacts.test.cjs`：92 passed、3 skipped、0 failed。
- Worker targeted：`invalid-employee-repair` 9、`effective-order-item-name` 13、`line-binding-transfer` 14、`roles` 2，全部通過。
- `npm test --prefix worker-poc`：567 passed、0 failed。
- Manifest UI/Mock 測試（六個指定檔案）：30 passed、0 failed，含 375px 和 1280px 本機瀏覽器 Mock。
- `npm run lint`、`npm run build`、`git diff --check`：exit 0。Lint 仍有既有 warnings；build 保留既有 500 kB chunk warning。
- `git diff --unified=0 origin/main | node scripts/pii-scan-public-artifacts.mjs --diff-stdin` 與 tracked/untracked 掃描：PASS，未發現設定的識別或憑證模式。
- `npm run test:line-binding` 的 SSR 子測試曾在先前 branch 執行失敗，亦曾在 base `709a0c6` 重現相同失敗；它不是 `agent.yaml` 宣告的 required gate。本輪未以它替代或略過 required tests。

## 尚未完成

| 項目 | 狀態 | 解阻條件 |
| --- | --- | --- |
| 獨立審查及 PR | 進行中 | reviewer 對精確候選 SHA 回覆無 P1/P2，建立乾淨替代 PR，取得 GitHub checks，再依核准流程合併 |
| 隔離 Worker/API runtime 驗收 | BLOCKED | 管理端按上方 hostname 放行核准的 egress，之後對精確候選部署版本做健康、匿名拒絕、CORS 與授權 contract smoke |
| 真實 LIFF / LINE owner 身分驗收 | NOT RUN | 需要允許的合成測試身分或由合法身分持有人提供驗收；Mock 不可替代 |
| 正式 D1 備份、migration、Worker release、Netlify release | NOT RUN / 不在本輪授權 | 原有 backup、維護窗口及 release gates 必須另外滿足；不因隔離 UAT 解除 |

## 後續預防

- 新增登入入口、員編綁定/修復/轉移入口，或改動保護 mapping 時，搜尋全部 Worker routes 與直接 domain helper 的 identity writes。
- readiness 測試需涵蓋 mapping 缺漏/重複/懸空、owner inactive/unverified/unbound/invalid、D1 binding 缺失，以及任何狀態在身分服務或帳務寫入前 fail closed。
- migration 編號須以 merge 後最新 main 為準；同一 PR 不得因本機測試 fixture 自動植入真實帳號 mapping。
