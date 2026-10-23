# 2026-10-23 — 廠商過往訂單匯入（歷史已結清）
- Repository、分支、PR：`henryfir456/bento-order-app`、`feat/vendor-history-import`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：使用者希望把系統上線前「合十」的訂單也匯入給廠商看，並假設帳都已當日付清；使用者選擇「畫面標為歷史已結清」，不產生轉帳紀錄。
- 實際修改：
  - Worker：新增 `/api/admin/vendor-history-import`（限 Admin＋LINE）。GET 預覽：該廠商名稱（含相容舊名）今天以前、尚無任何對應紀錄的菜單版本數與約略訂單數／天數。POST 需帶預覽時的版本數，不一致回 409 `VENDOR_HISTORY_PREVIEW_STALE`；一致則逐版本寫入一筆 VERIFIED 菜單版本對應事件（append-only），並記一筆 Admin 稽核。
  - 廠商訂單：當天訂單全部來自舊資料（沒有任何直接廠商指派）時，視為歷史日：不寫截止快照、狀態顯示「歷史已結清」，結算多回 `historicalSettledTwd`，未登記差額扣除這部分。
  - 前端：Admin 的廠商每日訂單頁新增「匯入過往訂單」區塊（查詢 → 檢視數量 → 確認匯入）；結算欄位與狀態顯示「歷史已結清」。Mock 補上對應動作。
- 交付狀態：PARTIAL；程式與本機驗證完成。正式匯入是正式資料寫入，交由使用者在 Admin 畫面檢視預覽後自行按「確認匯入」。

## 本輪阻礙
| 現象／階段 | 分類 | 證據 | 已嘗試及結果 | 根因（已驗證／推測／UNKNOWN） |
| --- | --- | --- | --- | --- |
| 無法先看正式 D1 的舊訂單狀況 | 權限 | 使用者電腦擋下 `d1 execute --remote` | 改做「預覽數量」功能，讓使用者在畫面上先看再決定 | 已驗證：本機權限規則 |

## 個資發布檢查
- PII_SCAN：PASS（新增 diff 與本檔）；只用合成資料。

## 驗證
- `npm test --prefix worker-poc`：655 pass／0 fail（預覽、過期 409、匯入、重查為 0、歷史日不寫快照與轉帳、有新制訂單的日子不算歷史、非 Admin 403）。
- `vendor-operations-ui`、`vendor-view-as-ui`、`bottom-navigation`、`changelog-migration`：19 pass；`npm run lint`、`vite build`：通過。
- NOT VERIFIED：正式環境匯入結果（待使用者操作）；舊訂單品項若沒有 `menu_item_id`，預覽可能偏少。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 舊品項缺 `menu_item_id` 時無法歸屬 | P2 | 觀察 | 待建立 | 正式預覽數量與實際舊訂單差距過大時再補比對規則 |

## 下一輪預防
- 觸發條件：任何正式資料的批次寫入。
- 應追加的前置檢查：先提供唯讀預覽，寫入時比對預覽數量，避免畫面與實際寫入不一致。
