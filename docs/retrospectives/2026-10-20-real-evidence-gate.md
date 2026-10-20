# 2026-10-20 真實證據與 RED→GREEN Gate 同步回顧

- Repository／Issue／PR：`henryfir456/bento-order-app`／[#129](https://github.com/henryfir456/bento-order-app/issues/129)；更新根 `AGENTS.md` 與既有 `docs/retrospectives/README.md`，使證據保管、production-path RED→GREEN、對抗回歸、獨立審查及真實驗收狀態成為實際工作入口。
- Commit SHA：以 PR head 記錄；來源 main 為 `4ec4923c9f5618cb4b15d762b057f03f635a1187`。
- 交付狀態：治理文件變更；不修改 React／Worker／D1、資料、部署流程、憑證、正式服務或商業邏輯。

## 本輪範圍與安全界線

- 在根 `AGENTS.md` 加入自足的真實證據與 regression Gate，接在既有強制回顧／合併規則之後；明確要求同一 production path 修正前 RED、修正後 GREEN，列出必要對抗案例與獨立 reviewer 對精確 PR head 的範圍。
- 在既有 retrospective 範本加入來源、snapshot、fixture 類型、程式路徑、RED/GREEN、PII_SCAN、獨立 review 與未驗證外部結果欄位。
- 沿用本 repo `docs/PRIVACY_PUBLICATION_GATE.md` 的合成資料及禁止穩定 hash 規則；未複製任何使用者資料或真實資料對照。
- 不運行產品／資料寫入、不部署 Worker、不呼叫 LIFF／外部服務、不遷移或改寫 D1。

## 本輪阻礙

| 階段 | 狀態 | 證據 | 結果 |
|---|---|---|---|
| 規範入口 | 已確認缺口 | 原根 `AGENTS.md` 有 privacy 與外部服務 readiness gates，但未要求 production-path RED→GREEN、原始／衍生 fixture 區分或獨立檢查所有 gate／return／break | 將要求接到根必讀 `AGENTS.md` 與既有回顧範本，不增加無人載入的新政策文件 |
| 隱私 | PASS | 變更僅是通用流程規範與合成欄位 | 不含個資、交易、截圖、憑證或真實值 hash |

## 驗證

- `git diff --check`：PASS，exit 0。
- `pii-scan-public-artifacts.mjs --diff-stdin` 與未追蹤文字檔掃描：PASS，兩次均 exit 0；沒有設定的識別碼／憑證 pattern 命中。
- 變更類型為 `GOVERNANCE_ONLY`，無 runtime-impact evidence；依本 repo `ap-verification-core` profile，不把前端／Worker 全測試、lint、build、LIFF、View As 或正式部署宣稱為已執行，除非驗證輸出直接證明。
- 目標 reviewer 檢查兩份文件與隱私邊界；GitHub Actions／Required Checks／PR 狀態待精確 head 推送後核對。
- Real LIFF、Worker、D1、生產操作與人工驗收：`NOT VERIFIED`，本 PR 不代表任何外部服務成功。

## 下次預防

- 觸發條件：只建立 evidence policy 文件，卻沒有在專案根指令及日常回顧流程中要求載入。
- 預防方式：任何共用規範同步都檢查目標 repo 自己的 `AGENTS.md`、既有工作流程／回顧模板與 privacy gate；在 PR body 明確列同 head 驗證與外部驗收仍未完成項目。
