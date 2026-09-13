# SQL-only provisional canonical profile completeness

## Scope

This policy gate defines the local lifecycle contract for SQL historical
employee identities that do not yet have a canonical D1 owner. It does not
materialize historical orders, likes, or wallet events and does not authorize
remote writes.

## Decision

Use a nullable `users.pickup_floor` profile field. A SQL-only provisional
canonical user is a real identity row, but it is not an operationally complete
profile until a valid floor is explicitly supplied through the existing profile
completion flow.

The imported identity payload is:

```text
employee_id         = normalized SQL username
line_user_id        = NULL
display_name        = deterministic legacy evidence display name
pickup_floor        = NULL
balance             = canonical default zero (not legacy balance)
role                = User
active              = existing canonical default active
verification_status = UNVERIFIED
```

The preview remains non-executable. A later approved write gate may create the
row only after applying the local schema policy and any separately approved
import policy.

## Invariants

- Identity existence, authentication state, profile completeness, and order
  eligibility are separate concerns.
- `profileComplete` is true only when the display name is non-empty and
  `pickup_floor` is one of `1樓` or `9樓`.
- LINE binding never completes or overwrites the profile. It only attaches the
  verified LINE identity to the already-resolved canonical user.
- Employee guest login and authenticated guest-to-LINE bind preserve the same
  canonical `user_id`; retries are idempotent.
- Incomplete users cannot create or replace orders. The server returns
  `PROFILE_COMPLETION_REQUIRED` before any order mutation.
- Profile completion uses the existing `PATCH /api/me/pickup-floor` contract;
  only valid floors are accepted. Existing complete and LINE-bound users are
  unchanged.
- No historical balance is copied, recalculated, or written. No ledger or
  adjustment is synthesized.
- Roles are not elevated by the provisional policy.

## Rejected alternatives

- A fixed `1樓` default fabricates operational data and is not a domain rule.
- A sentinel floor would violate the current order-floor domain and spread
  incomplete-profile semantics into operational data.
- Keeping the field `NOT NULL` blocks identity creation and forces a fake
  profile value.

## Acceptance criteria

1. The local formal schema permits a provisional user with `pickup_floor=NULL`
   while retaining the valid-floor check for non-null values.
2. The public canonical projection exposes `profileComplete` without changing
   verification or role semantics.
3. Employee login resolves an imported non-LINE user by exact normalized
   employee ID and returns `profileComplete=false`.
4. Authenticated guest-to-LINE bind attaches the same canonical user and does
   not fill the missing floor or display name.
5. A missing/invalid floor cannot create or replace an order.
6. PATCH profile completion accepts exactly `1樓` and `9樓`, rejects other
   values, and then reports `profileComplete=true`.
7. Existing complete users and existing LINE-bound users retain behavior.
8. Repeated login and bind do not create duplicate users.
9. Planner previews 46 SQL-only candidates as ready for canonical identity
   creation after the local schema policy, while remaining non-executable and
   explicitly `profileComplete=false`.
10. All tests remain local; no remote D1 DML/DDL, deployment, migration apply,
    commit, or push is performed.
