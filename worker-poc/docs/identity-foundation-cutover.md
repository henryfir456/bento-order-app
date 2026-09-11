# Identity foundation cutover checkpoint

This is the local readiness and manual handoff for the canonical identity,
employee guest access, and LINE binding slice. It is not a deployment record.

## Independent gates

| Gate | Local status | Production status |
| --- | --- | --- |
| Identity foundation | READY FOR CONTROLLED DEPLOYMENT | NOT VERIFIED IN PRODUCTION |
| Legacy workbook import | BLOCKED | NOT RUN |

Identity readiness covers the formal schema, local migration preservation,
employee-master dry-run, guest authentication, LINE binding, Worker transport,
guest permissions, boot idempotence, and local tests. The legacy gate remains
blocked by missing reviewed `Users.employee_id` evidence and financial/order
reconciliation evidence. The gates are intentionally independent.

## Manual LIFF scenarios (required before production verification)

These scenarios require a real LIFF channel, the authorized Worker URL, and a
reviewed test account. They are `NOT VERIFIED` by local tests:

1. An existing canonical LINE-bound employee logs in with LINE and sees the
   same canonical employee, role, floor, balance, orders, and history.
2. An unbound LINE account receives the guided employee-ID path; it is not
   auto-created and no LINE ID is shown in the UI.
3. An active unbound employee enters a textual ID such as `001234`, receives
   guest mode, and can read only self menu/calendar/balance/history and create
   or cancel a self order.
4. From guest mode, `綁定 LINE` completes one verified bind without a second
   employee input. The resulting LINE session reads the same canonical user;
   the old guest token fails with `GUEST_SESSION_INVALID` and no duplicate
   user is present.
5. A guest session for an Admin-role employee still hides and server-rejects
   member balances, top-up, calendar/announcement management, View As, and
   role operations.
6. Invalid, inactive, already-bound, conflicting, expired, and revoked paths
   show stable retryable errors, clear stale guest state, preserve no secret or
   role data in browser storage, and do not issue duplicate requests.

## Controlled deployment plan (documentation only)

The following sequence is the only proposed production order. Every remote
write, migration, preload, deploy, and real-LIFF smoke test below remains
unexecuted in this task.

1. `READ-ONLY`: export a backup from the exact formal D1 target and record
   schema, row counts, identity digest, ledger totals, and foreign-key check.
2. `REMOTE WRITE - NOT RUN`: apply the formal migration chain once, with the
   backup retained as the recovery source.
3. `REMOTE WRITE - NOT RUN`: apply only a reviewed valid employee-master
   preload report; do not include the intentionally invalid sample.
4. `READ-ONLY`: verify counts, unique employee/LINE constraints, preserved
   balances/orders/ledger/audit/likes, guest-session schema, and
   `PRAGMA foreign_key_check`.
5. `DEPLOY - NOT RUN`: deploy the Worker and then the React bundle configured
   for Worker transport in the approved environment. GAS is retired and is
   not a production fallback.
6. `MANUAL - NOT RUN`: execute all six real-LIFF scenarios and record evidence.
7. Roll out in waves: wave 1 is the owner/tester; wave 2 is two or three
   employees; wave 3 is the remaining employees. At each wave verify guest
   login, bind, order, cancel/refund, balance/history, management boundaries,
   and the recovery signal before continuing.
8. If verification fails, stop the wave, preserve logs/artifacts, and use the
   retained backup restore procedure. Do not repair identity or financial data
   with guessed mappings or balancing offsets.

## Stop conditions

Do not call this `VERIFIED IN PRODUCTION` until real LIFF, View As, Worker
deployment, and production contract evidence are recorded. Do not run remote
D1 migration/import, deploy, commit, or push as part of this checkpoint.
