# 2026-10-26 — 半飯品項訂單 menu_item_id 為 NULL（Admin 總覽與廠商畫面無法辨識）
- Repository、分支：80_bento-order-app、`claude/project-thread-mbnwv0`；PR：#194
- 本輪目標／實際修改：`normalizeLegacyMenuIdentity` 的禾拾 `H1`–`H5` 分支忽略列上已有的明確 variant，使 `H2 + HALF` 基準列被正規化成 `H2 + BASE` 並與全飯列合併；新增 `tests/orders-variant-identity.test.js`；升版 0.19.12。
- 交付狀態：PARTIAL（程式與自動測試完成；合併／Worker 部署／既有兩筆訂單身分覆核見下）

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 正式 D1 唯讀查詢被拒 | ENVIRONMENT_FAILED | 權限分類器 Production Reads；之後 Cloudflare API 7403 | 使用者加權限規則並重新 `wrangler login` 後查詢成功 | 已驗證：本機授權與登入狀態 |
| 兩筆半飯訂單於 Admin 總覽顯示未辨識 | 程式缺陷 | 正式 D1 唯讀：`order_items.menu_item_id` 為 NULL、`legacy_item_id='H2'`、無 canonical identity；菜單同時有 H2/BASE 與 H2/HALF | 本機以合成資料重現：下單半飯後 `menu_item_id` 為 NULL | 已驗證（本機重現）：基準列 HALF 被正規化為 BASE 後被 collapse，半飯列失去 persisted ID |

## 個資發布檢查
- PII_SCAN：PASS（agent.yaml 的 diff 掃描命令，提交前執行）
- 測試與本文件只用合成資料；未寫入真實姓名、員編或 LINE ID。

## 驗證
- RED：`node --test tests/orders-variant-identity.test.js`（修正前）：FAIL，`menu_item_id` 為 null。
- GREEN：同命令（修正後）：PASS。
- `npm test --prefix worker-poc`：676 pass／0 fail（修正後）。
- 前端／lint／build／changelog 測試：見 PR 紀錄。
- 尚待：正式 Worker 部署與部署後 smoke、實機／使用者驗收（NOT VERIFIED）。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 既有無 menu_item_id 的半飯訂單改於讀取時解析：同代碼多變體且快照品名與價格完全等於 HALF 變體才採用；BASE 品名、其他品名或價格不符仍保持未確認 | P1 | 本輪修（依使用者要求，不改寫資料） | — | 單元測試含負向案例；既有「未覆核行保持未確認」測試仍通過 |

## 下一輪預防
- 觸發條件：任何新增 variant 的規則或 normalizer 分支。
- 應追加的前置檢查：normalizer 對「已含明確 variant 的列」保持原 variant 的單元測試。
