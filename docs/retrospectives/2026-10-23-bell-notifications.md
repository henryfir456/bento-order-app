# 2026-10-23 — 小鈴鐺通知
- Repository、分支、PR：`henryfir456/bento-order-app`、`feat/bell-notifications`；PR 與 head SHA 以 PR 頁面為準。
- 本輪目標：鈴鐺移到最右、已綁定 LINE 不顯示、取消開團退款通知相關人員、廠商也有鈴鐺並在 18:00 收單時收到訂單通知。
- 實際修改：
  - Worker：migration 0024 新增 `user_notifications`（含 dedupe key，重跑不重複）；`GET /api/me/notifications`、`POST /api/me/notifications/:id/read`（含廠商身分，只能讀寫自己的通知）；取消開團並退款時，在同一個批次寫入每位訂購人的通知與該團廠商的通知；新增 `0 10 * * *`（台北 18:00）cron，對隔天的 B 模式團發給廠商一則收單彙總。
  - 前端：鈴鐺移到標題列最右並開放給廠商；通知列在公告上方、計入未讀數；廠商不載入員工公告；已綁定 LINE 標籤只在未綁定時顯示。
- 交付狀態：PARTIAL；需先套用 migration 0024、部署 Worker（含新 cron），再由使用者發布 Netlify 並實際檢視。

## 本輪阻礙
無。

## 個資發布檢查
- PII_SCAN：PASS；只用合成資料。

## 驗證
- 新增 `user-notifications.test.js`：取消開團通知訂購人與廠商、他人看不到、已讀只限本人；18:00 cron 發一則並可重跑、無團時略過。
- NOT VERIFIED：正式環境 cron 實際觸發（待 18:00 後確認）。

## 改善建議
| 建議事項 | P0/P1/P2 | 本輪修／另開 Issue／觀察／不採用 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 收單通知目前只針對 18:00 的 B 模式團，A 模式（10:00 收單）沒有 | P2 | 觀察 | 待建立 | 使用者確認 A 模式也需要時再加 |

## 下一輪預防
- 觸發條件：新增通知種類。
- 應追加的前置檢查：確認 kind 的 CHECK 清單、dedupe key 與誰能讀取。
