# SQL-only provisional profile completeness implementation plan

## Goal

Implement the approved local policy for 46 missing SQL historical canonical
identities without changing historical parser semantics or performing remote
writes.

## Steps

1. Add focused failing tests for the nullable profile schema, public
   `profileComplete`, employee-login/LINE-bind convergence, idempotency, order
   blocking, valid 1樓/9樓 completion, invalid-floor rejection, and planner
   candidate readiness.
2. Add a local-only formal migration that rebuilds `users` with nullable
   `pickup_floor` and preserves existing constraints, indexes, foreign-key
   relationships, and data. Test the schema and preservation behavior in the
   in-memory formal fixture.
3. Add the pure profile-completeness predicate, preserve `NULL` through the DB
   and public user projections, and block order writes for incomplete profiles.
4. Verify existing login and authenticated LINE bind paths reuse the canonical
   row, expose incomplete profile state, and never infer or fill profile data.
5. Update the provisional planner preview and summary to report 46
   `CREATE_CANONICAL_READY` candidates, with non-executable semantic previews
   and no required-profile blocker.
6. Run focused tests, then governed verification in the declared order. Keep
   remote/manual evidence separate from local automated evidence and report
   baseline failures independently.

## Safety boundary

This plan creates no executable remote import SQL and runs no remote command.
The migration is a local artifact only; applying it to formal D1 is a later
policy/write gate.
