# 2026-10-22 — 發布 Runbook 對齊實際路徑
- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`、`docs/formal-release-actual-path`；PR／head SHA 以 PR 頁面為準。
- 本輪目標／實際修改：`docs/FORMAL_WORKER_RELEASE.md` 新增第 0 節「已實際驗證的發布路徑」與 Windows 已知注意事項；把 API 版本上傳器（B.1–B.3、E）明確標為尚未驗收的試驗工具。不改程式、不改 AGENTS.md、不改部署政策。
- 交付狀態：DONE（文件）；無正式環境變更。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| Runbook 主要描述 API 上傳器，實際發布用 Wrangler CLI | 文件與實作不一致 | Issue #145 的兩次正式部署（main `c8b42fe`、`f7c5047`）皆用 `wrangler deploy --keep-vars` | 無 | 已驗證：#104 的 API 上傳路徑從未以真實環境驗收 |
| Windows 上 `prepare-formal-release.mjs` 失敗 | 環境／程式缺陷 | `spawnSync npx` 回 `ENOENT` | 未修正腳本；記錄為已知問題，路徑不依賴它 | 已驗證現象；根因推測為不經 shell 呼叫 `npx.cmd`，未用修正驗證 |

## 個資發布檢查
- PII_SCAN：PASS；文件只含流程與版本／SHA，不含員編、user_id、LINE 識別、簽名 URL 或憑證。

## 驗證
- `node scripts/check-agent-policy.mjs`：PASS，exit 0（政策行、必要引用、本地連結、根目錄安全 Gate）。
- 未執行：程式測試（無程式變更）。文件所述 9 個步驟中，步驟 1、3、5–7 為 2026-10-22 實際執行；步驟 4 為同日執行；步驟 8 於 #146 部署後執行。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 修正 `prepare-formal-release.mjs` 的 Windows `npx` 呼叫 | P2 | 另案 | 待建立 | Windows 上產生 release manifest |
| 決定是否明確設定 `preview_urls = false` | P2 | 觀察 | #145 | 設定檔明確指定並以部署讀回 |

## 下一輪預防
- 觸發條件：Runbook 描述的路徑與實際執行路徑不同。
- 應追加的前置檢查：每次改發布流程後，以實際一次部署的證據回寫 Runbook，並標示哪些路徑尚未驗收。
