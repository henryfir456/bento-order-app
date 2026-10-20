# 2026-10-20 — Issue #128 響應式店家份數甜甜圈圖

- Repository：`henryfir456/bento-order-app`。
- Base：`main` `44ef1eb`；branch：`codex/issue-128-responsive-donut`；[PR #135](https://github.com/henryfir456/bento-order-app/pull/135)。第一輪獨立審查 pin 在 `604f6cca`，發現 P2 後已修正，新的精確 head 與複查結果以 PR 當前 metadata 為準。
- 本輪目標／修改：把「我的便當足跡」店家份數圓餅圖改為響應式甜甜圈圖，在中心呈現選取期間總份數；保留既有統計 API、聚合與期間，改善窄版長店名及份數／比例的可讀性，提供 SVG 文字標籤並保留減少動態效果支援。
- 首輪獨立審查在 320px viewport 以無空格合成長店名重現 P2：flex 文字項目保留 min-content 寬度，明細清單水平溢出並碰撞份數欄。已將名稱欄限制在剩餘寬度並允許 anywhere wrapping，新增 Chromium 320px 合成回歸案例；同時將 SVG `<title>` 改為單一字串，消除 React SSR 的多子節點警告。這不改動 API、資料聚合或帳務。
- 交付狀態：CODE_CHANGE / MOCK_TEST_PASS；修正後完整本機必要測試已通過，精確新 head 的 Actions 與獨立複查待確認；UAT API 仍 NOT VERIFIED。

## 本輪阻礙

| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| PII scan 把改名後新增的既有十六進位色碼列視為連續數字 | 工具誤報 | 第一次候選 diff scan 對圖表來源檔回 `PII_SCAN BLOCKED`；沒有發現真實識別值 | 保留原有色彩常數名稱，只提交圖表用途必要的改動；完整候選 diff 再掃描為 PASS，未放寬掃描規則 | 已驗證：改名把原有色碼整行轉成新增行而觸發數字 pattern |
| 隔離 Worker API smoke 未取得 Worker 回應 | 網路／外部驗收 BLOCKED | 有界健康檢查在 HTTPS proxy CONNECT 階段收到 403，請求未到 Worker；證據見關聯 PR #134 | 未改用其他網路通道，沒有用 Mock 代替 API smoke | 已驗證：目前執行環境 proxy 阻擋連線；Worker 回應與 runtime 狀態 UNKNOWN |
| 首輪 reviewer 在 320px 重現無空格合成長店名水平溢出及份數欄碰撞 | P2／UI 缺陷（已修） | 獨立審查綁定首輪 PR head `604f6cca`；測得店名欄及明細清單寬度遠超 viewport，份數欄因此碰撞 | 店名項目加 `min-w-0` 與 `overflow-wrap:anywhere`，左側 flex 區域改為 `flex-1`；在 Local Mock Chromium 加入 320px 無空格合成名稱案例，檢查頁面／清單不溢出且不碰撞份數欄 | 已驗證：修正後完整瀏覽器 Mock UAT 通過；新 head 獨立複查待完成 |
| React SSR 對 SVG `<title>` 多個 JSX children 警告 | P3／無障礙 markup | 同一首輪 reviewer 的 SSR probe | 使用同一 `chartLabel` 單一字串作為 SVG aria-label 與 `<title>` children | 已修：程式及本機測試通過；未宣稱獨立複查完成 |

## 個資發布檢查

- PII_SCAN：PASS（候選 diff 的新增行通過；無未追蹤文字檔）。
- 測試資料與本機 Mock 畫面只使用合成店家／數據；本文件不含真實姓名、員編、LINE 識別或帳務資料。
- PR #135 body、diff、commit message 與本機截圖已檢查；本機截圖不會上傳為 API 驗收證據。

## 驗證

- `node --test tests/strict-identity-ledger.test.cjs tests/changelog-migration.test.cjs tests/pii-scan-public-artifacts.test.cjs`：exit 0；92 passed、3 skipped、0 failed。
- `node worker-poc/tests/invalid-employee-repair.test.js && node worker-poc/tests/effective-order-item-name.test.js && node worker-poc/tests/line-binding-transfer.test.js && node worker-poc/tests/roles.test.js`：exit 0；9 + 13 + 14 + 2 passed。
- `npm test --prefix worker-poc`：exit 0；567 passed、0 failed。
- `node --test tests/invalid-employee-repair-ui.test.cjs tests/effective-order-item-name-ui.test.cjs tests/line-binding-transfer-ui.test.cjs tests/order-statistics-ui.test.cjs tests/announcement-images-ui.test.cjs tests/local-mock-responsive-uat.test.cjs`：exit 0；30 passed、0 failed。Mock browser viewport 覆蓋 320px、375px 與 1280px；320px 案例將合成無空格長店名插入圖表實際 DOM，檢查頁面寬、清單 `scrollWidth` 及店名／份數欄界線。
- `npm run lint`：exit 0；有既有 lint warnings，其中 `cursor` 警告在 base `main` 也存在，沒有因本輪變更而引入新的 lint failure。
- `npm run build`：exit 0；輸出含 764.61 kB chunk 警告。
- `git diff --check origin/main`：exit 0。
- `git diff --unified=0 origin/main | node scripts/pii-scan-public-artifacts.mjs --diff-stdin`：exit 0，`PII_SCAN PASS`。
- `git ls-files --others --exclude-standard | xargs -r node scripts/pii-scan-public-artifacts.mjs`（新增文件 stage 前）：exit 0，該文件通過 PII_SCAN。
- 本機 Mock 截圖：`/tmp/bento-uat-evidence/footprints-375-mock-final.png`、`/tmp/bento-uat-evidence/footprints-1280-mock-final.png`。視覺檢查確認手機圖表在上、明細在下；桌面版圖表與明細並列。這些截圖只證明合成 Mock UI；320px 長字串為瀏覽器自動斷言，沒有上傳含測試內容的截圖。
- 尚待人工／外部：連線隔離 API、真實 LIFF 身分及遠端 D1 行為均 NOT VERIFIED；沒有 Worker/D1 migration、Worker deploy、正式資料異動或 Netlify 發布。

## 改善建議

| 建議事項 | P0/P1/P2 | 本輪處理 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 保留目前共享切片游標計算，避免本次 UI 重排改變統計切片邊界 | P2 | 觀察；此計算原已存在於 base，lint warning 沒有新引入，不因無關 cleanup 擴大範圍 | [PR #135](https://github.com/henryfir456/bento-order-app/pull/135) | 手機／桌面相同期間呈現相同份數總計，切片及明細份數和比例一致 |

## 下一輪預防

- 改色碼或 palette 宣告前先跑增量 PII_SCAN；遇到色碼連續數字誤報時調整 diff 範圍，不放寬 scanner。
- 統計 UI 變更須同時核對手機、桌面、長店名、零筆資料、輔助文字及 reduced-motion 測試；沿用既有 API 聚合，不在前端重算授權或交易資料。
- 將 Local Mock、遠端 API／identity acceptance、正式發布分開記錄；Mock 成功不表示 Worker、LINE 或 D1 驗收通過。
