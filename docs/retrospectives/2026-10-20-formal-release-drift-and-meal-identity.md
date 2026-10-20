# 2026-10-20 — 正式發布漂移與餐點身份統計
- Repository、分支、PR、Commit SHA：`henryfir456/bento-order-app`、`fix/formal-drift-meal-identity`；PR/head SHA 待 GitHub 建立及 reviewer 核對。
- 本輪目標／實際修改：修正已知 legacy menu code alias 的有效餐點身份解析；增加唯讀正式 Worker/D1 drift detector 與 Worker 發布前 D1 狀態 gate；API 錯誤介面顯示安全錯誤碼及 request ID。未變更歷史正式訂單快照，未寫入正式 D1，也未發布正式 Worker、Netlify 前端或銀行轉帳。
- 交付狀態：PARTIAL；程式與本地驗證完成，正式 D1／Worker Gate 未通過，正式 API 及前端線上版本 NOT VERIFIED。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 正式 migration 前無合格備份與隔離還原證據 | 備份／復原 Gate | 唯讀 Cloudflare 控制面 metadata 不能證明符合政策的備份物件上傳、讀回及 SHA-256；本輪未完成隔離 restore、integrity/FK/schema 檢查 | 僅唯讀檢查正式 migration/schema/config；沒有匯出、寫入、刪除或還原正式資料 | 已驗證缺少本輪 Gate 必要證據；不能推定通過 |
| 0019 會更新既有訂單 | 正式資料安全 | migration SQL 對既有 orders 設定 vendor_id；與本任務禁止改動既有正式訂單衝突 | 未套用 0015–0019 中任何一筆，未跳號、修改 migration 或偽造 migration 記錄 | 已驗證；除非另有安全的相容遷移方案並符合授權範圍，否則不能繼續 |
| 0017 所需 protected account mapping 尚無經授權 owner mapping | 身分設定 | 唯讀檢查顯示 mapping 尚未配置；不能從帳戶資料推測或建立映射 | 未寫入 identity mapping；部署／驗收範圍維持 BLOCKED | 已驗證缺少核准設定；owner 身分 UNKNOWN |
| 正式功能 API 驗收 | 線上身分／部署 | 正式 Worker 仍是 2026-10-17 00:42 台灣時間部署版本；公告／Vendor 需要的正式 Admin/Vendor 身分未提供，功能端點無法完成具權限測試 | 沒有建立虛構付款或測試正式付款操作；不以 health check 或 Mock UAT 代替驗收 | 已驗證未能完成實機驗收；所需正式測試身分不可用 |

## 個資發布檢查
- PII_SCAN：差異與新增文字檔掃描 PASS；未加入真實員編、姓名、LINE ID、正式訂單／付款資料、憑證或可反查資料。
- Issue／PR／commit／測試輸出／評論使用合成 fixtures；正式資料檢查只記錄 migration／schema 狀態，不記錄業務資料列。

## 驗證
- TDD RED→GREEN：新增 known-code alias 測試在 resolver 修正前未能將 `R` 與 `FR` 判定為同一 identity；aggregate 統計前置案例出現 5 種、預期 4 種。修正後 `node --test worker-poc/tests/effective-order-item-name.test.js` 通過，A/B/C rename 歷史、同顯示名稱但不同 legacy identity、all/year/month 份數與餐點種類及 snapshot 不變均有覆蓋。
- 正式狀態：Worker migration 記錄最後為 `0014_taiwan_government_holidays`；最新 main schema 帶有 `0015`–`0019`。正式 D1 未套用任何新 migration。
- `npm test --prefix worker-poc`：PASS，609/609，exit 0。
- 根目錄 strict identity／changelog／PII 測試：PASS，97 tests、94 pass、3 skip、0 fail，exit 0。
- 根目錄 domain/UI／line binding／roles 測試：PASS，10/10，exit 0；Vendor UI／request trace／PII UI 額外測試：PASS，14/14，exit 0。
- `npm run lint`：PASS，exit 0；輸出有既存 warnings，沒有此次修改檔案的 lint warning。
- `npm run build`：PASS，exit 0；有既存大型 bundle 提示。
- `git diff --check`、PR 差異與新增文字檔 PII scan：PASS，exit 0。
- 先前本地 Mock UAT 不作為正式環境證據。正式公告、Vendor、settlement 與真實前端版本驗收：NOT VERIFIED；正式部署／D1 migration：BLOCKED。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 上線追蹤 Worker SHA、正式 D1 migration drift 與功能驗收阻塞 | P1 | 本輪加入唯讀 detector／release guard | [Issue #139](https://github.com/henryfir456/bento-order-app/issues/139) | main runtime 變更或 migration drift 可產生清楚阻塞；部署後以 Cloudflare version metadata 和逐項正式 API status/contract 驗收 |
| 安全補齊正式 D1 備份與還原作業 Gate | P1 | 另依既有正式備份 runbook 處理 | [Issue #104](https://github.com/henryfir456/bento-order-app/issues/104) | 備份具專用保留設定，完整讀回 hash 相符，隔離還原及 integrity/FK/schema/聚合檢查通過 |
| 餐點統計依 canonical legacy identity 歸併已驗證名稱 | P1 | 本輪修正 | [Issue #103](https://github.com/henryfir456/bento-order-app/issues/103)、[Issue #108](https://github.com/henryfir456/bento-order-app/issues/108) | 正式 Worker 發布後 all/year/month 的 A/B/C 歷史份數及種類一致；重複顯示名稱但 identity 不同仍分開 |

## 下一輪預防
- 觸發條件：Worker runtime／D1 migration 合併 main，或正式功能 API 驗收身份／版本未確認。
- 應追加的前置檢查／測試／規範：使用 `npm run drift:formal --prefix worker-poc` 產生 Worker SHA 與 migration 狀態報告；先通過正式 D1 backup/restore gate，再 sequential migration，之後 direct Wrangler/API 部署並核對 deployment/version metadata；以授權 Admin/Vendor 身分逐項驗收公告、Vendor RBAC、settlement 和餐點統計，保留 HTTP status/response contract/request ID；不以 CI、build、health check 或 Mock UAT 推定正式成功。
