# 登入錯誤紀錄（auth_error_log）

目的：登入 / bootstrap 失敗時自動留下紀錄，不必再截圖或貼 log。

## 記錄內容（無個資）
- 前端：`stage`、錯誤碼、HTTP 狀態、是否在 LINE 內、app 版本、`detail`（已遮蔽 token、長數字、LINE ID、email，最多 160 字）。
- 後端（登入相關失敗）：錯誤碼、HTTP 狀態、LINE profile / verify 實際 HTTP 狀態（0 = 網路失敗或逾時）、錯誤類別、耗時。
- 共通：時間、UA 簡述（OS + 瀏覽器 + LINE 版本）、來源位址雜湊前 8 碼、X-Request-Id。
- 不存：LINE token、LINE user id、員編、姓名、完整 IP。

錯誤類別：`LINE_PROFILE_HTTP`、`LINE_VERIFY_HTTP`、`LINE_NETWORK`、`LINE_VERIFY_NETWORK`、`LINE_TIMEOUT`、`TOKEN_CONTENT_REJECTED`（LINE 兩個呼叫皆 200 但 token 被拒，例如 channel 不符）。

## D1 讀寫量
- 寫入節流：同一來源 + 階段 + 錯誤碼每個 Worker isolate 每分鐘最多 1 筆；每 isolate 每分鐘最多 40 筆；前端每次載入頁面最多 5 筆。成功登入不寫入。
- 索引 `idx_auth_error_log_occurred_at`；報表查詢最多掃 500 筆。
- 保留 14 天，每日 cron（UTC 08:00）刪除過期資料。

## 查詢
在 `worker-poc` 目錄（需 `npx wrangler login`，過期可用根目錄 `wrangler-login.bat`）：

```
npm run report:auth-errors -- --hours 48 --limit 30
```

輸出依類型統計與最近紀錄。僅唯讀，直接以 wrangler 讀 D1，不新增 Admin API。
