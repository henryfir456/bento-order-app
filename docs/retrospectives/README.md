# 每輪開發回顧

每次完成實際修改後，交付前建立或更新 `docs/retrospectives/YYYY-MM-DD-<issue-or-task>.md`。同一 Issue 後續修復追加輪次。PR 請連結該文件；沒有阻礙也寫「無」。不要寫憑證、個資或第三方 App 敏感內容。

## 記錄範本

```markdown
# 日期 — 任務／Issue
- Repository、分支、PR、Commit SHA：
- 本輪目標／實際修改：
- 交付狀態：DONE / PARTIAL / BLOCKED / NOT VERIFIED

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |

## 個資發布檢查
- PII_SCAN：PASS / BLOCKED / NOT VERIFIED（禁止真實員編、姓名、LINE ID、可反查資料及未遮罩截圖）
- Issue／PR／commit／測試輸出／截圖／評論均使用合成資料，確認者：

## 驗證
- 實際命令、版本、退出碼及輸出：
- PASS / FAIL / NOT RUN / BLOCKED：
- 尚待人工／實機／線上驗收：

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |

## 下一輪預防
- 觸發條件：
- 應追加的前置檢查／測試／規範：
```

## 真實證據型任務的必填欄位

若任務涉及使用者提供的畫面／資料、裝置、外部服務或重複實機失敗，回顧還必須記錄：

- 原始來源、擷取時間、版本／SHA、raw file 可讀狀態，以及哪些是明確標示的合成或衍生 fixture。
- 實際失敗的 production gate／early return／break／dispatcher／verifier，以及已驗證、推測或 UNKNOWN 的根因界線。
- 修正前 RED 與修正後 GREEN 的相同測試命令、退出碼、測試範圍；不能把 lint/build 或孤立 policy test 稱為 RED。
- 錯誤視窗、缺失／重複控制、空 root、disabled sibling、中斷、timeout／exception 和恢復防重複等適用的對抗案例。
- PII_SCAN 與獨立 Reviewer 的同一 PR head；未做實機／外部操作的項目明確標 `NOT VERIFIED`／`HUMAN_TEST_PENDING`。
- 將 code、fixture/mock、integration、外部 action accepted、外部 outcome verified 分開交接；不得由 fixture 或測試通過推定真實操作成功。

## 分流規則

先查相似回顧及 Issue，再提出改善。僅對有可驗證價值、跨輪持續發生或需單獨追蹤的缺陷建立 Issue；未驗證推測留待確認。不可因回顧取代測試、獨立審閱、main 合併、實機驗證與部署權限。已完成的紀錄不得宣稱沒有執行過的測試 PASS。
