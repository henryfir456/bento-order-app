# 2026-11-17 — Admin 設定蔡老師結單後自動請款
- Repository、分支：bento-order-app、claude/project-thread-2gpxol
- 本輪目標／實際修改：新增 Admin 開關，蔡老師 10:00 結單後由既有 close cron 自動為指定 ProxyAdmin 建立 PENDING 請款（蔡老師當天訂單），Admin 仍需審核。新增 migration 0038 `auto_reimbursement_settings`、`GET/PUT /api/admin/reimbursements/auto-setting`、請款審核頁設定區塊，版本 0.23.0。
- 交付狀態：WAITING_FOR_DELIVERY（待合併 main、Worker 部署與 migration 0038 套用；Netlify 為 USER_RELEASE_PENDING）

## 本輪阻礙
無。前端 `npm test` 有 6 個既有失敗（瀏覽器相關），stash 後在原 main 同樣失敗，與本次無關。

## 個資發布檢查
- PII_SCAN：PASS（測試皆為虛構代號）

## 驗證
- `npm test`（worker-poc）：725 pass / 0 fail，含新增自動請款測試（預設關閉、驗證、cron 冪等、關閉後不再建立）。
- 前端 `npm test`：285 pass / 6 fail（與 main 相同的既有失敗）。
- 前端 build：NOT RUN（本環境未安裝前端相依套件）。

## 改善建議
| 建議事項 | P0/P1/P2 | 處置 | 追蹤連結 | 驗收條件 |
| --- | --- | --- | --- | --- |
| 自動請款只計蔡老師訂單，同日手動全日請款會因「每日一筆」被擋 | P2 | 待使用者決定 | 無 | 使用者確認 |

## 下一輪預防
cron 附加行為一律包 try/catch，避免影響既有通知。
