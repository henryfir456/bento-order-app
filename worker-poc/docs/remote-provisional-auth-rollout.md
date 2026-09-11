# Remote provisional employee auth rollout

This is the controlled rollout record and verification checklist for the
formal Worker (`bento-api-poc`) and formal D1 (`bento-formal`). It does not
authorize deployment, employee-data import, or account rebind.

## Execution evidence (2026-09-11)

- Fresh backup: `.local-imports/bento-formal-provisional-auth-20260911-1025.sql`
  (30,940 bytes), SHA-256
  `E40B37285AF4AFA6980E6B62348BF635BB25B5E15A5F7BEFA22D15E32E2ABCE2`.
- Remote target: `bento-formal`, UUID
  `e75bc185-afb5-4a5d-abc9-81bd79525cff`; binding remains `DB`.
- `0002` applied at `2026-09-11 02:30:03` and verified before the next write.
- `0003` applied at `2026-09-11 02:32:13` and verified after `0002`.
- Before and after counts were preserved: users 3, orders 0, order items 0,
  order status history 0, balance ledger 0, ledger sequence 0, opening
  snapshots 0, calendar settings 0, likes 0, idempotency keys 0, admin audit
  log 3, menu versions 3, menu items 28, announcements 2, import batches 1,
  import quarantine 5, and guest sessions 0.
- Both post-migration `PRAGMA foreign_key_check` results were empty.
- `139653` has no approved employee mapping and remains absent from canonical
  `users`; no production employee import or data write was performed.
- New Worker source deployment and remote authentication smoke are pending:
  `DEPLOY REQUIRED`.

## Preconditions

- Local implementation, migration, authorization, compatibility, Worker,
  root, lint, build, and diff checks pass.
- A new backup export exists for the exact D1 UUID
  `e75bc185-afb5-4a5d-abc9-81bd79525cff`; never overwrite an older
  `.local-imports` artifact.
- Before each remote write, record table row counts, `d1_migrations`, schema,
  indexes, and `PRAGMA foreign_key_check`.
- The workbook `gas/便當系統設定.xlsx` has no `employee_id` column and no
  approved exact employee mapping. Full production employee import therefore
  remains `BLOCKED`; `139653` must not be mapped to a legacy user or to a
  `line_user_id` by inference.

## Ordered remote sequence

1. Export a fresh backup with `wrangler d1 export bento-formal --remote` to a
   unique path and record its SHA-256, timestamp, target, and row counts.
2. Read and retain the pre-migration `d1_migrations`, table/index inventory,
   identity schema, row counts, and foreign-key check.
3. Apply only migration `0002_canonical_identity_rekey.sql`. Verify the
   canonical user/ownership columns, guest-session table, indexes, row-count
   reconciliation, and zero foreign-key violations. Stop if any check fails.
4. Apply only migration `0003_provisional_employee_identity.sql`. Verify
   `users.verification_status`, nullable provisional `user_id`, employee and
   session status constraints, unique indexes, preserved rows, counts, and
   foreign-key cleanliness. Stop if any check fails.
5. Deploy the new Worker only under separate explicit authorization. This
   task reports `DEPLOY REQUIRED` and does not deploy.
6. After deployment, run remote smoke tests for known unbound, known bound,
   unknown valid, invalid, LINE collision, replay, and unauthorized
   provisional requests. Capture response codes and sanitized evidence.

## Authentication contract after deployment

| Input/state | Result |
| --- | --- |
| no LINE auth + known active employee, `line_user_id IS NULL` | verified employee guest session |
| known employee with any non-null `line_user_id` | `409 {"error":"LINE_LOGIN_REQUIRED"}` |
| LINE auth + known active employee, `line_user_id IS NULL` | lookup, explicit confirmation, then direct LINE bind; no guest session |
| LINE auth + valid unknown textual employee ID | onboarding, then direct LINE bind to an `UNVERIFIED` canonical user; no guest session |
| no LINE auth + valid unknown textual employee ID | `200 UNVERIFIED_EMPLOYEE` session |
| invalid employee ID | `400 INVALID_EMPLOYEE_ID` |
| guest session + verified LINE + profile | new `UNVERIFIED` canonical user |
| LINE or employee collision | fail closed; no rebind |

An `UNVERIFIED` principal is resolved centrally and receives only
`CAN_VIEW_SELF_ONBOARDING_STATE`, `CAN_COMPLETE_PROFILE`, and `CAN_BIND_LINE`.
The route layer must never derive normal capabilities from `role = User` and
`active = 1` alone.

## Local development topology

The intended local test path is:

```text
localhost:5173 React -> remote formal Worker -> remote bento-formal D1
```

Do not change `.env.development`, start a local Wrangler Worker, create local
D1 data, or copy remote D1 data. CORS is governed by the existing explicit
`CORS_MODE=remote-test` runtime configuration on the non-production remote
Worker; this rollout does not change CORS source code.
