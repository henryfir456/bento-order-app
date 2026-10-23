# 2026-10-23 — 廠商暫時以代號登入（測試用開關）
- Repository、分支、PR：`henryfir456/bento-order-app`、`feat/vendor-code-login`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：使用者為了方便測試廠商畫面，選擇暫時讓廠商代號（V＋五位數）像一般員工一樣在登入畫面輸入代號直接登入，功能穩定後再鎖回只能 LINE 登入。
- 實際修改：
  - Worker 新增 `VENDOR_CODE_LOGIN_ENABLED` 開關（`wrangler.jsonc` 設為 `"true"`）。開啟時，輸入有效廠商代號會建立 8 小時的 session（沿用 `employee_guest_sessions`，不需 migration），身分解析為該廠商的 canonical Vendor principal。
  - 此 session 為唯讀：`確認收到`／`提出爭議` 一律回 `VENDOR_CODE_LOGIN_READ_ONLY`，capabilities 也移除這兩項；不可 view-as。
  - 開關關掉後，新登入會被拒絕，既有 session 下一次請求即回 401 並由前端清除。廠商停用、會員停用、店家停用或代號改綁時 session 也立即失效。
  - 前端接受 `authMode: 'vendor_code'`，以 session token 呼叫 API，進入廠商工作台；標題列加「登出」按鈕（本系統原本沒有登出），對帳分頁顯示唯讀說明。
  - 員工登入流程、LINE 綁定、保護帳號規則都沒有改動；開關關閉時行為與原本完全相同（仍回 `VENDOR_EMPLOYEE_GUEST_FORBIDDEN`）。
- 交付狀態：PARTIAL；程式與本機驗證完成，Worker 需使用者部署、前端需使用者發布 Netlify（USER_RELEASE_PENDING）。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| `wrangler.jsonc` 加註解後多項測試失敗 | 測試前提 | 測試以 `JSON.parse` 讀設定檔 | 移除註解，說明改寫在本檔與程式註解 | 已驗證：formal 設定檔需是純 JSON |
| 本機 UAT 設定加開關被安全檢查拒絕 | 本機工具 | `LOCAL_UAT_CONFIG_UNSAFE` | 不改 local UAT 設定，改用 `wrangler dev --var` 驗證 | 已驗證：local UAT 設定的 vars 數量是固定白名單 |

## 個資發布檢查
- PII_SCAN：PASS（新增 diff 與本檔）；測試用合成代號，未寫入真實廠商代號或身分。

## 驗證
- `npm test --prefix worker-poc`：651 pass／0 fail（新增 `vendor-code-login.test.js` 5 項：開關關閉時拒絕、開啟時登入並唯讀、關閉後既有 session 失效、停用或不存在的廠商被拒、廠商停用後 session 失效）。
- `node --test tests/vendor-operations-ui.test.cjs`：8 pass／0 fail（含唯讀規則）。
- 本機 `wrangler dev`（local UAT D1，合成廠商一設上合成代號，開關開啟）＋ Vite worker 模式，Playwright 手機寬度：輸入代號登入後進入廠商工作台、三分頁正常、對帳顯示唯讀說明、重新整理仍維持登入、按「登出」回到登入畫面。
- 已知、與本修改無關：廠商身分呼叫 `/api/me/announcements` 回 403（Vendor 角色沒有 READ_SELF，LINE 登入的廠商同樣如此），前端不受影響。
- NOT VERIFIED：正式環境（待部署）。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 功能穩定後把 `VENDOR_CODE_LOGIN_ENABLED` 改為 `"false"` 並部署 | P1 | 觀察（等使用者決定時間） | 待建立 | 正式環境輸入廠商代號回 `VENDOR_EMPLOYEE_GUEST_FORBIDDEN` |

## 下一輪預防
- 觸發條件：為測試暫時放寬登入規則。
- 應追加的前置檢查：放寬一律做成可單一開關關閉、關閉時既有 session 同步失效，且預設唯讀。注意部署使用 `--keep-vars` 時，設定檔中仍列出的值會覆蓋，要鎖回請改值而不是刪除該行。

## 追加：正式環境代號登入回 VENDOR_SCOPE_FORBIDDEN
- 現象：部署後使用者輸入代號，畫面顯示 `VENDOR_SCOPE_FORBIDDEN`。
- 根因（依 runbook 推定，未查正式 D1）：禾拾的 Vendor owner 同時是 protected account（`configure-vendor-owner.sql` 會新增 protected user mapping，用來封鎖舊員編登入）。代號登入原本把 protected account 一律拒絕。
- 修正：代號登入不再檢查 protected mapping；該保護針對的是以員編存取此使用者，而代號登入只給唯讀的 Vendor 範圍。舊員編登入仍被擋（新增測試涵蓋）。
- 預防：放寬登入前，先用正式資料的實際組合（Vendor owner＋protected mapping）寫測試，不只用一般合成廠商。
