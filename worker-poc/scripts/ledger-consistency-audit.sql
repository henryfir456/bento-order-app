-- Ledger consistency audit (READ ONLY)
--
-- Run against the formal D1 database with a read-only command only.  This
-- file intentionally contains SELECT statements only.  It does not repair,
-- migrate, or otherwise mutate remote data.
--
-- The audit anchors each user's chain on the first sequenced row.  It never
-- uses users.balance to decide whether a sequenced row is valid.

-- 1. Scope and sequence coverage.
SELECT
  (SELECT COUNT(*) FROM users) AS user_count,
  (SELECT COUNT(*) FROM balance_ledger) AS ledger_row_count,
  (SELECT COUNT(*) FROM balance_ledger_sequence) AS sequence_row_count,
  (SELECT MIN(sequence_number) FROM balance_ledger_sequence) AS first_sequence,
  (SELECT MAX(sequence_number) FROM balance_ledger_sequence) AS latest_sequence;

-- 2. Classify every sequenced row.  A local discontinuity is an origin.  A
-- row which locally continues but remains offset from the first-row baseline
-- is propagated corruption, not a second independent origin.
WITH ordered AS (
  SELECT
    u.employee_id,
    bl.user_id,
    bl.transaction_id,
    bl.type,
    bl.amount,
    bl.balance_after,
    bl.occurred_at,
    bl.note,
    bl.reference_id,
    bls.sequence_number,
    LAG(bls.sequence_number) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
    ) AS previous_sequence,
    LAG(bl.balance_after) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
    ) AS previous_balance_after,
    FIRST_VALUE(bl.balance_after - bl.amount) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS initial_balance_before,
    SUM(bl.amount) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_amount
  FROM users u
  JOIN balance_ledger bl ON bl.user_id = u.user_id
  JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
), classified AS (
  SELECT
    ordered.*,
    previous_balance_after + amount AS expected_balance_after,
    initial_balance_before + cumulative_amount AS reconstructed_balance_after,
    CASE
      WHEN previous_sequence IS NOT NULL
       AND balance_after <> previous_balance_after + amount
      THEN 1 ELSE 0
    END AS is_origin,
    CASE
      WHEN previous_sequence IS NOT NULL
       AND balance_after = previous_balance_after + amount
       AND balance_after <> initial_balance_before + cumulative_amount
      THEN 1 ELSE 0
    END AS is_propagated
  FROM ordered
)
SELECT
  employee_id,
  user_id AS canonical_user_id,
  sequence_number,
  type AS transaction_type,
  amount,
  previous_sequence,
  previous_balance_after,
  expected_balance_after,
  balance_after AS actual_balance_after,
  balance_after - expected_balance_after AS delta,
  occurred_at,
  note,
  CASE
    WHEN instr(note, 'policy_id=') > 0 THEN
      substr(
        note,
        instr(note, 'policy_id=') + length('policy_id='),
        CASE
          WHEN instr(
            substr(note, instr(note, 'policy_id=') + length('policy_id=')),
            ' '
          ) > 0 THEN instr(
            substr(note, instr(note, 'policy_id=') + length('policy_id=')),
            ' '
          ) - 1
          ELSE length(note)
        END
      )
    ELSE NULL
  END AS policy_id,
  CASE
    WHEN is_origin = 1
     AND balance_after = amount
     AND amount < 0
    THEN 'SUSPECTED_STALE_USERS_BALANCE_STARTING_AT_ZERO'
    WHEN is_origin = 1 THEN 'NOT_PROVEN_FROM_CURRENT_MIRROR'
    ELSE NULL
  END AS stale_users_balance_suspicion,
  CASE WHEN is_origin = 1 THEN 'origin' ELSE 'propagated' END AS corruption_role
FROM classified
WHERE is_origin = 1 OR is_propagated = 1
ORDER BY sequence_number;

-- 3. One row per affected user, including current mirror comparison.
WITH ordered AS (
  SELECT
    u.employee_id,
    u.user_id,
    u.balance AS users_balance,
    bl.amount,
    bl.balance_after,
    bl.type,
    bl.occurred_at,
    bls.sequence_number,
    LAG(bl.balance_after) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
    ) AS previous_balance_after,
    FIRST_VALUE(bl.balance_after - bl.amount) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS initial_balance_before,
    SUM(bl.amount) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_amount
  FROM users u
  JOIN balance_ledger bl ON bl.user_id = u.user_id
  JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
), classified AS (
  SELECT
    ordered.*,
    CASE
      WHEN previous_balance_after IS NOT NULL
       AND balance_after <> previous_balance_after + amount
      THEN 1 ELSE 0
    END AS is_origin,
    CASE
      WHEN previous_balance_after IS NOT NULL
       AND balance_after = previous_balance_after + amount
       AND balance_after <> initial_balance_before + cumulative_amount
      THEN 1 ELSE 0
    END AS is_propagated
  FROM ordered
), affected AS (
  SELECT
    employee_id,
    user_id,
    MAX(users_balance) AS users_balance,
    SUM(is_origin) AS origin_rows,
    SUM(is_propagated) AS propagated_rows,
    MIN(CASE WHEN is_origin = 1 THEN sequence_number END) AS first_origin_sequence,
    MIN(CASE WHEN is_origin = 1 THEN occurred_at END) AS first_origin_at,
    MAX(CASE WHEN is_origin = 1 OR is_propagated = 1 THEN sequence_number END)
      AS last_affected_sequence
  FROM classified
  GROUP BY employee_id, user_id
  HAVING origin_rows > 0 OR propagated_rows > 0
), latest AS (
  SELECT
    bl.user_id,
    bl.balance_after AS latest_ledger_balance,
    bls.sequence_number AS latest_sequence,
    ROW_NUMBER() OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number DESC
    ) AS row_number
  FROM balance_ledger bl
  JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
)
SELECT
  affected.employee_id,
  affected.user_id AS canonical_user_id,
  affected.origin_rows,
  affected.propagated_rows,
  affected.first_origin_sequence,
  affected.first_origin_at,
  affected.last_affected_sequence,
  latest.latest_sequence,
  latest.latest_ledger_balance,
  affected.users_balance,
  latest.latest_ledger_balance - affected.users_balance AS canonical_minus_users_balance
FROM affected
JOIN latest ON latest.user_id = affected.user_id AND latest.row_number = 1
ORDER BY affected.employee_id;

-- 4. 2026-09 monthly reconciliation.  This mirrors the Worker rule:
-- opening/closing are sequence-backed rows bounded by occurred_at, while
-- additions/deductions are the signed amounts in the UTC month.
WITH sequenced AS (
  SELECT
    u.employee_id,
    u.user_id,
    u.balance AS users_balance,
    bl.transaction_id,
    bl.amount,
    bl.balance_after,
    bl.type,
    bl.occurred_at,
    bls.sequence_number
  FROM users u
  JOIN balance_ledger bl ON bl.user_id = u.user_id
  JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
), month_rows AS (
  SELECT * FROM sequenced
  WHERE occurred_at >= '2026-09-01T00:00:00.000Z'
    AND occurred_at < '2026-10-01T00:00:00.000Z'
), first_month AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY sequence_number) AS row_number
  FROM month_rows
), prior_rows AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY sequence_number DESC) AS row_number
  FROM sequenced
  WHERE occurred_at < '2026-09-01T00:00:00.000Z'
), closing_rows AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY sequence_number DESC) AS row_number
  FROM sequenced
  WHERE occurred_at < '2026-10-01T00:00:00.000Z'
), totals AS (
  SELECT
    user_id,
    SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END) AS additions,
    SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS deductions
  FROM month_rows
  GROUP BY user_id
)
SELECT
  u.employee_id,
  u.user_id AS canonical_user_id,
  COALESCE(prior_rows.balance_after,
    first_month.balance_after - first_month.amount) AS opening_balance,
  COALESCE(totals.additions, 0) AS additions,
  COALESCE(totals.deductions, 0) AS deductions,
  closing_rows.balance_after AS closing_balance,
  COALESCE(prior_rows.balance_after,
    first_month.balance_after - first_month.amount)
    + COALESCE(totals.additions, 0) - COALESCE(totals.deductions, 0)
    AS amount_reconciled_closing_balance,
  closing_rows.balance_after - (
    COALESCE(prior_rows.balance_after,
      first_month.balance_after - first_month.amount)
      + COALESCE(totals.additions, 0) - COALESCE(totals.deductions, 0)
  ) AS monthly_delta,
  closing_rows.sequence_number AS closing_sequence
FROM users u
LEFT JOIN first_month ON first_month.user_id = u.user_id
  AND first_month.row_number = 1
LEFT JOIN prior_rows ON prior_rows.user_id = u.user_id
  AND prior_rows.row_number = 1
LEFT JOIN closing_rows ON closing_rows.user_id = u.user_id
  AND closing_rows.row_number = 1
LEFT JOIN totals ON totals.user_id = u.user_id
WHERE first_month.user_id IS NOT NULL
  AND closing_rows.user_id IS NOT NULL
  AND (
    closing_rows.balance_after <> (
      COALESCE(prior_rows.balance_after,
        first_month.balance_after - first_month.amount)
      + COALESCE(totals.additions, 0) - COALESCE(totals.deductions, 0)
    )
  )
ORDER BY u.employee_id;

-- 5. Restore / adjustment follow-up rows.  This is useful for proving that
-- an adjustment itself was included but a prior origin had already poisoned
-- the running chain.
SELECT
  u.employee_id,
  bl.user_id AS canonical_user_id,
  bls.sequence_number,
  bl.type,
  bl.amount,
  bl.balance_after,
  bl.occurred_at,
  bl.note,
  bl.reference_id
FROM users u
JOIN balance_ledger bl ON bl.user_id = u.user_id
JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
WHERE bl.note LIKE '%restore_missing_legacy_cutoff_balance%'
   OR bl.type = 'ADJUSTMENT'
ORDER BY bls.sequence_number;

-- 6. Known-user spot check.  The full audit above remains authoritative.
SELECT
  u.employee_id,
  u.user_id AS canonical_user_id,
  u.balance AS users_balance,
  latest.balance_after AS latest_ledger_balance,
  latest.sequence_number AS latest_sequence,
  latest.balance_after - u.balance AS canonical_minus_users_balance
FROM users u
LEFT JOIN (
  SELECT
    bl.user_id,
    bl.balance_after,
    bls.sequence_number,
    ROW_NUMBER() OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number DESC
    ) AS row_number
  FROM balance_ledger bl
  JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
) latest ON latest.user_id = u.user_id AND latest.row_number = 1
WHERE u.employee_id IN ('070214', '121254', '105499', '110004', '141301', '147398', '159028', '188100')
ORDER BY u.employee_id;
