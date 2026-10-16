# AGENTS.md 強制規則遷移核對紀錄（2026-10-16）

## 審計方式
- 比對基準：`docs/governance/AGENTS_PRE_REFACTOR_20261016.md`，即拆分前 main 原文快照；**不作為現行規則入口**。
- 驗證入口：`node scripts/check-agent-policy.mjs`。
- 驗證逐條原文：所有非空白、非 Markdown 標題的舊規範文字行，必須完整存在於現行 AGENTS 或三份遷移目的地任一處；避免搬移時無意刪除強制規則。
- 驗證文件入口：AGENTS 必須指到所有關鍵文件，路徑真的存在，且遷移後文件內的相對 Markdown 連結可解析。
- **注意**：此機械式覆蓋測試確保文字無遺失，但不能取代人工語義審閱；未來如有意修改規則，必須專案審閱並更新基準或改成逐項規則 ID 清單。

## 逐章遷移核對

| 原 AGENTS 章節 | 新權威位置 | 檢查方式 |
|---|---|---|
| 啟動程序、安全底線、交付關卡、連續交付 | AGENTS 原文保留 | root 安全關鍵字＋逐行比對 |
| 正式後端直接部署、#104 正式發版入口 | docs/WORKER_DEPLOYMENT_POLICY.md | 原文完整搬移＋AGENTS 強制連結 |
| 正式部署方式選擇與歷史踩雷 | AGENTS 原文保留，指向部署比較 | 逐行比對＋引用檢查 |
| 版本與異動紀錄、繁中翻譯 | docs/RELEASE_VERSION_POLICY.md | 原文完整搬移＋AGENTS 強制連結 |
| 作業交接、專案契約、驗證、RWD、回顧 | AGENTS 原文保留 | 逐行比對 |
| 已退役傳輸、歷史遷移、GAS 驗證 | docs/HISTORY_MIGRATION_POLICY.md | 原文完整搬移＋AGENTS 強制連結 |

## 行為及安全約束
- 不更改 `agent.yaml` 或 `.agents/skills/**`。
- 禁止以 GitHub Actions 發布正式 Worker；保留 main、fresh build、D1/Secrets、權限、smoke 的所有原有 Gate。
- 純文檔／驗證工具維護不代表正式 Worker 已部署；不因拆分而要求發布或升版。
