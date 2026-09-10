# Remote import readiness checkpoint

Status for the current local workbook: `BLOCKED`.

Remote import status: `NOT EXECUTED`. This file documents the exact commands
for a later, separately authorized checkpoint; none of the remote commands
below are part of local verification.

## Current evidence

The source is `gas/便當系統設定.xlsx`. The Users sheet has only the legacy
headers `UserID (LINE ID)`, `DisplayName`, `樓層`, `Balance`, and `Role`; it
has no `employee_id` field. The recorded source SHA-256 is:

```text
2ca5dd43fad7f71f4c6bfc1481a2df027bbb4eaeadd7f3cefa272a581940feaf
```

No employee ID is inferred from a name, LINE ID, row position, or numeric
coercion. Until a reviewed exact mapping is supplied, active employee
ownership is unproven and replacement readiness must remain `BLOCKED`.

## Local readiness command

Run from `worker-poc` to create a new local artifact. It reads the workbook
and writes only the requested local report. The current blocked input must not
produce replacement SQL.

```powershell
npm.cmd run import:production:dry-run -- `
  --input "..\gas\便當系統設定.xlsx" `
  --output ".local-imports\bento-formal-canonical-identity-readiness.json" `
  --sql-output ".local-imports\bento-formal-canonical-identity.sql" `
  --target bento-formal `
  --database-id e75bc185-afb5-4a5d-abc9-81bd79525cff `
  --config wrangler.jsonc
```

The output path is create-only: an existing artifact is never overwritten.
The expected result is `readiness.status = BLOCKED`, including
`EMPLOYEE_ID_FIELD_MISSING`, and no `.sql` file at the requested SQL path.

## Future remote checkpoint commands

These commands are documentation only. They require a separately reviewed
employee mapping, an approved readiness artifact, and explicit authorization.
They must not be run as part of this task.

First export a backup from the exact formal target:

```powershell
npm.cmd exec -- wrangler d1 export bento-formal --remote `
  --output ".local-imports\bento-formal-pre-import-backup.sql" `
  --config wrangler.jsonc
```

Then perform read-only remote schema and count checks:

```powershell
npm.cmd exec -- wrangler d1 execute bento-formal --remote --config wrangler.jsonc --command "SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name" --json
npm.cmd exec -- wrangler d1 execute bento-formal --remote --config wrangler.jsonc --command "SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users UNION ALL SELECT 'orders', COUNT(*) FROM orders UNION ALL SELECT 'balance_ledger', COUNT(*) FROM balance_ledger UNION ALL SELECT 'employee_guest_sessions', COUNT(*) FROM employee_guest_sessions" --json
npm.cmd exec -- wrangler d1 execute bento-formal --remote --config wrangler.jsonc --command "SELECT user_id, employee_id, line_user_id, active FROM users ORDER BY user_id" --json
```

After human review creates `.local-imports\employee-identity-map.json` and
the readiness artifact is no longer blocked, the exact future replacement
command is:

```powershell
npm.cmd run import:production:replace -- `
  --input "..\gas\便當系統設定.xlsx" `
  --identity-map ".local-imports\employee-identity-map.json" `
  --target bento-formal `
  --database-id e75bc185-afb5-4a5d-abc9-81bd79525cff `
  --reviewed-artifact ".local-imports\bento-formal-canonical-identity-readiness.json" `
  --sql-output ".local-imports\bento-formal-canonical-identity-replacement.sql" `
  --confirm-production-replace `
  --remote `
  --config wrangler.jsonc
```

The replacement path must reject missing/conflicting mappings, wrong target
identity, stale review artifacts, already-applied source fingerprints, and
unapproved historical ledger data. It must use exact reconciliation evidence;
an unexplained balancing offset is never an acceptable pass condition.

Finally, use only read-only remote checks to verify the post-import state:

```powershell
npm.cmd exec -- wrangler d1 execute bento-formal --remote --config wrangler.jsonc --command "SELECT 'users' AS table_name, COUNT(*) AS row_count FROM users UNION ALL SELECT 'orders', COUNT(*) FROM orders UNION ALL SELECT 'balance_ledger', COUNT(*) FROM balance_ledger UNION ALL SELECT 'likes', COUNT(*) FROM likes UNION ALL SELECT 'employee_guest_sessions', COUNT(*) FROM employee_guest_sessions" --json
npm.cmd exec -- wrangler d1 execute bento-formal --remote --config wrangler.jsonc --command "PRAGMA foreign_key_check" --json
```

The project remains at this checkpoint until the workbook gains reviewed
canonical employee mappings and all financial/order reconciliation blockers
are resolved with source evidence.
