# 2026-10-20 — Issue #122 保護既有廠商 LINE 身分
- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`，分支 `codex/issue-122-protected-line-identity`，PR／最終 SHA 待建立；本文件隨程式提交。
- 本輪目標／實際修改：將保護條件設於 Worker 身分解析、員編訪客登入／註冊、LINE 員編查找／綁定、舊訪客 session、直接 provisional claim、Admin 員編綁定、LINE 綁定轉移、身份修復與 View As 路徑。只允許經驗證的既有 LINE owner 使用該 canonical 帳號。新增不含帳號／員編／LINE ID 的拒絕稽核表及 migration 0017；管理稽核拒絕列保留操作者與原因，但將目標識別欄位清空；API 公開投影遮蔽受保護帳號的 LINE ID。不變更現有帳號、訂單、餘額或 ledger。
- 交付狀態：CODE_READY（本機完整測試通過；獨立複審、PR／合併及隔離部署待完成；正式 Worker 與正式 D1 不在本輪授權內。）

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 新 main 加入公告偏好 migration 0016，與本分支 migration README 及 schema index 變更重疊 | rebase 衝突 | 兩個衝突檔都由兩個獨立 migration 修改 | 保留 0016、0017 的順序與兩個 index；更新 migration 數為十八；rebase 已完成 | 已驗證為相鄰 migration 合併衝突，未丟棄任一方 schema |
| 第一輪 Worker 全套測試發現正確 owner 綁定與 `/api/me` 回應洩出 LINE ID，另 append-only trigger 測試 SQL 無 `WHERE` 條件 | 實際安全缺陷＋測試缺陷 | 首輪 Worker suite 2 項失敗；測試直接解析綁定、`/api/me`、bootstrap 與 trigger 寫入 | 將 `publicUser`、`getMe` 的保護帳號投影改為不回傳 ID，增加 bootstrap／管理摘要／成員清單 API 斷言；修正 UPDATE 條件，並使受保護 Admin 拒絕稽核不記目標 ID；後續全套 560/560 通過 | 已驗證：共享公開投影是 LINE ID 外洩根因；SQL 測試原本沒有命中指定 row。一般 Admin 稽核另曾保留目標 user ID，已在此修改清除 |
| 安裝依賴前 root UI、lint、build 首輪無法啟動 | 工具／依賴缺漏 | `vite` 與 `oxlint` 指令不存在 | `npm ci --cache /tmp/bento-order-app-npm-cache` 及 `npm ci --prefix worker-poc --cache /tmp/bento-order-app-npm-cache` 成功，lockfile 未變；重跑所有 gates 通過 | 已驗證為工作樹缺少 node_modules，非程式錯誤 |
| 既有帳號狀態及真實 LINE 主體尚無授權外部驗證 | 外部驗收未完成 | Issue 要求由既有合法 LINE 綁定使用；本輪禁止修改正式資料及正式綁定 | 只以合成身份和本機 SQLite Worker handler 測試；不讀／匯出正式資料，不使用真實 LINE ID | 外部 identity/runtime 結果 UNKNOWN，須在隔離環境或由合法身分提供證據 |

## 個資發布檢查
- PII_SCAN：目前工作樹兩項命令 PASS；PR head 改變後仍須對最終 head 重跑。
- 程式、測試及文件使用合成使用者和合成 LINE 值；未將 Issue 指定帳號識別值寫成字面值，未使用真實 LINE ID、帳號資料或截圖。獨立 Reviewer 待最終 head 覆核。

## 驗證
- FULL_PREFLIGHT：PASS。核對根目錄、`AGENTS.md`、`agent.yaml` schema／欄位、宣告技能名稱與版本、`PROJECT_STATE.md`、`DECISIONS.md`、歷史 migration 政策、公開資料政策、回顧範本與工作樹；原 branch 基於前一 main，已將程式重播到含 migration 0016 的最新 main。
- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs`：PASS，90 passed、3 skipped、0 failed。
- Worker targeted tests：PASS，9 + 13 + 14 + 2；`npm test --prefix worker-poc`：PASS，560 passed、0 failed。
- 宣告 UI 測試：PASS，30 passed，含 375px 與 1280px browser Mock。
- `npm run lint`：PASS，無 error；保留既有 warnings，沒有本輪新增 unused-variable warning。
- `npm run build`：PASS；保留既有 500 kB bundle warning。
- `git diff --check`、diff 與未追蹤檔兩項 PII_SCAN：PASS，退出碼 0。獨立複審待最終 head 執行。
- Toolchain capability probe：NOT RUN；manifest 所述 `tools/get-toolchain-capabilities.ps1` 在 repository 不存在。
- 正式 D1 migration、正式 Worker、真實 LINE 身分與正式帳號／訂單／ledger：NOT RUN，明確排除於本輪授權。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 以隔離 D1 合成帳號驗證 migration 0017 及 API 拒絕路徑，確認不觸碰正式 Worker／D1 | P1 | 本輪隔離部署與 API 驗收階段處理 | Issue #122 | 確認隔離 Worker 綁定隔離 D1；拒絕事件僅保存允許欄位；正確 owner contract 不輸出 LINE ID |
| 取得合法既有 owner 的真實 LIFF／session 驗收證據 | P1 | 等待具備人類身分的驗收者；本機合成測試不可替代 | Issue #122 | 真實 owner 成功取得原帳號，陌生 LINE／員編／舊 session 皆 fail closed，且沒有帳務資料變更 |

## 下一輪預防
- 觸發條件：新增登入入口、員編綁定／修復／轉移入口、或新增保護帳號的資料庫 migration。
- 應追加的前置檢查／測試／規範：對全部 Worker 路由和直接 domain helper 搜尋 identity writes；測試正確 owner、陌生 LINE、guest replay／過期 session、Admin、View As、資料缺失／歧義、停權及並發；migration 預期清單與 README 必須連續。
