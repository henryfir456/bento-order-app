# 2026-10-22 — 足跡統計仍偏慢（每日菜單版本、CPU 重算、圖片資料）
- Repository、分支：`henryfir456/bento-order-app`、`perf/statistics-baseline-batching`；PR 與最終 head SHA 以 PR 頁面為準。
- 本輪目標：PR #146 之後使用者回報「我的便當足跡」仍偏慢。在不改回傳內容、schema、歷史訂單的前提下，進一步降低 `/api/orders/statistics` 的 D1 往返、讀取列數與 Worker CPU，並讓前端切換期間時不必重新等待。
- 環境：`OTHER/UNKNOWN`（Claude Code 雲端容器）；無 Cloudflare 憑證，正式 Worker 部署與正式 API 耗時 NOT VERIFIED。

## 找到的瓶頸
以合成資料（4 家廠商、約 650 天每日菜單版本、約 470 份訂單）在本機量測並以 `--cpu-prof` 取樣：

| 瓶頸 | 證據 | 修正 |
| --- | --- | --- |
| 每個不同訂單日期的菜單版本各自讀一次 `menu_items`（`baseline:<version>`），即逐日 D1 往返 | `period=all` 292 次查詢；新測試 8→120 天查詢數 16→130 | `prefetchCompatibilityMenuBaselines`：以每批 90 個版本 ID 批次讀取，維持每版本原排序 |
| 每個日期都對全部 `menu_item_changes` 重新 `normalizedChange`（含雜湊） | CPU 取樣 `normalizedChange` + `projectionHash` 約 1.8 秒 | 快取模式下以 `WeakMap` 只正規化一次；選出的列複製後才離開解析器 |
| 歷史 SQL 日期會讀取全部現行菜單品項做圖片 fallback，並逐日重建索引；統計完全用不到圖片 | CPU 取樣 `getLatestCurrentMenuImageRows` 約 1.7 秒；讀取約 2 萬列 | 解析器以 `includeDisplayImages: false` 呼叫 `getCustomerMenu`；預設呼叫者行為不變 |
| 前端每次切換期間或回到足跡頁都清空資料並等待 | `refreshBentoFootprints` 先 `setFootprintsData(null)` | 依「檢視對象＋期間」保留上次成功結果，背景更新並顯示「更新中…」；身分清除時一併清空 |

## 驗證
- 合成資料量測（本機 SQLite，無網路延遲）：`all` 約 3.6 秒／292 查詢／約 2.9 萬列 → 229 ms／24 查詢／約 8.5 千列；`year` 1571 ms／145 查詢 → 89 ms／17 查詢；`month` 99 ms → 29 ms。`period=all` 修正前後回傳 JSON 逐位元組相同。
- RED（原始碼）：`node --test worker-poc/tests/order-statistics-query-budget.test.js` 新增 3 項皆 fail（查詢數 16→130、缺少批次函式、讀取圖片列）。GREEN：8/8。
- `npm test --prefix worker-poc`：634/634；`agent.yaml` 其餘測試指令、`npm run lint`（僅既有 warning）、`npm run build`：PASS。
- NOT VERIFIED：正式 Worker 部署、正式 API 耗時、使用者本機驗收；Netlify 前端 `USER_RELEASE_PENDING`。

## 改善建議
| 建議事項 | P0/P1/P2 | 處理 | 驗收條件 |
| --- | --- | --- | --- |
| 本 PR 批次與 CPU 修正 | P0 | 本輪修正 | 部署後 `period=all` 明顯低於 15 秒逾時，結果與修正前一致 |
| 統計結果伺服器端快取（依使用者＋期間，訂單異動時失效） | P2 | 觀察；部署後量測再決定 | 正式耗時仍超過目標時再另案 |

## 下一輪預防
- 查詢預算測試需同時涵蓋「每日一個菜單版本」的資料形狀；只有少數版本的 fixture 會漏掉逐版本讀取。
- 本機功能測試無法反映 Worker CPU 上限與 D1 延遲；效能修正需搭配 CPU 取樣與讀取列數。

## 後續：正式環境約 2 秒（PR #152 部署後）
- 使用者實測正式足跡頁約 2 秒，比之前快。以每次 D1 讀取加固定延遲的本機模擬檢查往返結構：一次統計請求有 10 次**全部循序**的 D1 往返（驗證 4 次：D1 probe、session、使用者、受保護帳號；統計 6 次：訂單、穩定身份 ×2 批、版本、baseline、變更列）。推測正式環境每次往返約 150–200 ms，NOT VERIFIED。
- 修正（後續 PR）：穩定身份各批、變更列、各廠商版本改為同時讀取，baseline 各批也同時讀取。統計段 6 → 3 個循序往返，整體 10 → 7。新增測試以每次讀取 40 ms 延遲計算循序波數：原始碼 11 波（fail），修正後 ≤ 7（pass，連跑 5 次穩定）。
- 未處理（需使用者決定）：Worker 未啟用 Smart Placement，若 Worker 在離 D1 很遠的邊緣節點執行，每次往返都要跨區；每個 API 請求開頭的 `SELECT 1` D1 probe 也是一次完整往返，屬全域 fail-closed 設計，不在本輪更動。
