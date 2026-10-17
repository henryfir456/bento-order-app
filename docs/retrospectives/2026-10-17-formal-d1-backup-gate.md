# 2026-10-17 — 正式 D1 備份閘門
- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`、`docs/d1-backup-recovery-gate`；PR 與 commit 由本次文件變更記錄。
- 本輪目標／實際修改：調查 D1 Time Travel/export 與既有 R2 設定；新增正式 D1 備份、隔離復原驗證及 migration 操作閘門。另在本地將前端 mock 員編 fixture 換成明確合成值，該檔不納入公開 PR。未執行正式 export、migration、Worker deployment、Netlify 發布或正式資料修改。
- 交付狀態：PARTIAL；正式 migration 與 Worker deployment 等待合格備份位置。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 正式 schema migration 前缺少合格的獨立備份位置 | 備份／復原 | 唯讀 Cloudflare metadata 未能證明有專用、獨立保留且可驗證復原的目的地 | 查閱 D1 export、Time Travel 與 R2 公開網域、lock、lifecycle API；未建立備份或改動 Cloudflare 設定 | 已驗證目前沒有已驗證的專用備份位置 |
| 前端 mock 身份 fixture 的來源未確認 | 隱私發布 | 既有公開來源值未在本輪重述；僅記錄真實性未知 | 不納入公開差異；避免在未確認前產生會再次顯示舊值的公開修正 diff | UNKNOWN |

## 個資發布檢查
- PII_SCAN：文件 PR 差異與未追蹤檔掃描 PASS；Worker/frontend bundle 的數字型 heuristic 命中以 source map 與來源檢查分類，沒有身份欄位中的長數字字串。mockData 合成化只保留於本地工作區，未放入公開 PR，避免在 diff 中重現未分類的刪除值。本回顧不含個別身份、正式帳號或帳務資料。
- Issue／PR／commit／測試輸出／截圖／評論均使用合成資料，確認者：本次文件變更只記錄聚合設定狀態，沒有個人資料。

## 驗證
- 實際命令、版本、退出碼及輸出：一般 `npm ci` 遭 sandbox `EPERM`；`npm ci --ignore-scripts` 及 Worker 對應安裝 PASS；根目錄指定測試 PASS；`npm test --prefix worker-poc` 67/67 PASS；`npm run lint` 退出碼 0（23 warnings）；`npm run build` PASS；設定可寫 Wrangler config directory 後，`node worker-poc/scripts/prepare-formal-release.mjs` 在乾淨 main SHA 上 PASS（NOT DEPLOYED）；PR diff／未追蹤檔 PII_SCAN PASS。正式 Cloudflare 僅執行唯讀 metadata 查詢。
- PASS / FAIL / NOT RUN / BLOCKED：文件與程式驗證 PASS；備份位置判定 BLOCKED；正式匯出、migration、Worker deployment NOT RUN。
- 尚待人工／實機／線上驗收：建立專用私有備份位置、確認保留期限及隔離復原後，才可執行正式 migration。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 正式 D1 schema migration 前建立專用私有 R2 備份位置與可重複復原演練 | P1 | 本輪新增規範；待營運設定 | 本次 PR | 備份可讀、SHA-256 相符、保留 lock 生效，且隔離 restore 的 integrity/FK/schema/聚合筆數驗證通過 |

## 下一輪預防
- 觸發條件：任何正式 D1 schema migration。
- 應追加的前置檢查／測試／規範：依 `docs/D1_BACKUP_AND_MIGRATION_RUNBOOK.md` 驗證備份儲存、保留、讀回、隔離復原及 migration 前後聚合不變；未通過即停止。

## 後續輪次 — 唯讀正式發布閘門檢查

- 狀態：BLOCKED（`BACKUP_NOT_VERIFIED`）。本輪依最新 main 規範進行唯讀檢查，並保留先前輪次紀錄。
- R2 檢查：專用候選 bucket 為私有、沒有公開入口；所需保留鎖定與 lifecycle 設定通過唯讀檢查。未記錄 bucket、物件或路徑識別資訊。
- 未通過的 Gate：儲存 jurisdiction 顯示為預設值，但專案政策沒有可核對的核准項目，因此核准狀態為 NOT VERIFIED。現有連線可查控制面設定，無法證明專用 bucket 的 S3 物件讀寫權限；執行環境沒有可用的 scoped S3 access。
- D1 檢查只讀取 migration、schema 與外鍵檢查結果。所需 migration 尚未套用、目標 schema 欄位尚不存在，foreign-key check 沒有違規。
- 停止結果：未匯出或讀回正式 D1、未做隔離復原、未讀寫正式資料、未套用 migration、未部署 Worker、未發布 Netlify。
- PII_SCAN：PASS；本回顧沒有個別資料、憑證、備份內容或簽名 URL。
- 後續：由專案負責人確認允許的儲存 jurisdiction，並在安全執行環境提供限於專用 bucket 的 S3 讀寫能力；通過備份讀回與隔離復原驗證後，才可繼續正式 migration 與 Worker release。

## 下一輪預防補充

- 將「jurisdiction 有明確核准依據」和「bucket-scoped S3 object Read/Write 能力可實測」列為備份作業的先決條件。控制面讀取或物件清單權限不能代替這兩項證據。
