-- Ledger repair preview (PROPOSAL ONLY; READ ONLY)
--
-- This file deliberately contains no UPDATE, INSERT, DELETE, or migration.
-- It previews the balance_after values that would be repaired if a separately
-- approved immutable-ledger repair procedure were selected.  Do not execute
-- a mutation based on this preview without a backup, an explicit repair
-- approval, and an audit-log design.
--
-- Current affected users have one origin each.  The preview is guarded to
-- return rows only for users with exactly one origin, so it cannot silently
-- reinterpret a multi-origin chain.

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
    bls.sequence_number,
    LAG(bl.balance_after) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
    ) AS previous_balance_after,
    LAG(bls.sequence_number) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
    ) AS previous_sequence,
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
      WHEN previous_sequence IS NOT NULL
       AND balance_after <> previous_balance_after + amount
      THEN 1 ELSE 0
    END AS is_origin,
    initial_balance_before + cumulative_amount AS reconstructed_balance_after
  FROM ordered
), origin_counts AS (
  SELECT user_id, SUM(is_origin) AS origin_count
  FROM classified
  GROUP BY user_id
), origins AS (
  SELECT user_id, sequence_number AS origin_sequence,
         balance_after - (previous_balance_after + amount) AS origin_delta
  FROM classified
  WHERE is_origin = 1
)
SELECT
  classified.employee_id,
  classified.user_id AS canonical_user_id,
  classified.sequence_number,
  classified.transaction_id,
  classified.type,
  classified.amount,
  classified.balance_after AS current_balance_after,
  classified.balance_after - origins.origin_delta AS preview_balance_after,
  classified.occurred_at,
  classified.note,
  origins.origin_sequence,
  origins.origin_delta,
  CASE
    WHEN classified.sequence_number = origins.origin_sequence THEN 'origin'
    ELSE 'propagated'
  END AS repair_role,
  'PREVIEW_ONLY_NO_MUTATION' AS action
FROM classified
JOIN origin_counts ON origin_counts.user_id = classified.user_id
  AND origin_counts.origin_count = 1
JOIN origins ON origins.user_id = classified.user_id
WHERE classified.sequence_number >= origins.origin_sequence
ORDER BY classified.user_id, classified.sequence_number;

-- 2. Review summary: current/corrected latest balance and 2026-09 monthly
-- values. The corrected closing balance only changes the sequenced rows
-- after the single origin offset; amounts and transaction semantics remain
-- unchanged. A non-zero corrected monthly delta is intentionally retained
-- as a boundary diagnostic, not hidden.
WITH ordered AS (
  SELECT
    u.employee_id,
    bl.user_id,
    bl.amount,
    bl.balance_after,
    bl.occurred_at,
    bls.sequence_number,
    LAG(bl.balance_after) OVER (
      PARTITION BY bl.user_id ORDER BY bls.sequence_number
    ) AS previous_balance_after
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
    END AS is_origin
  FROM ordered
), origin_counts AS (
  SELECT user_id, SUM(is_origin) AS origin_count
  FROM classified
  GROUP BY user_id
), origins AS (
  SELECT
    user_id,
    sequence_number AS origin_sequence,
    balance_after - (previous_balance_after + amount) AS origin_delta
  FROM classified
  WHERE is_origin = 1
), latest AS (
  SELECT
    classified.*,
    ROW_NUMBER() OVER (
      PARTITION BY classified.user_id ORDER BY classified.sequence_number DESC
    ) AS row_number
  FROM classified
), month_rows AS (
  SELECT *
  FROM classified
  WHERE occurred_at >= '2026-09-01T00:00:00.000Z'
    AND occurred_at < '2026-10-01T00:00:00.000Z'
), first_month AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY user_id ORDER BY sequence_number
  ) AS row_number
  FROM month_rows
), prior_rows AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY user_id ORDER BY sequence_number DESC
  ) AS row_number
  FROM classified
  WHERE occurred_at < '2026-09-01T00:00:00.000Z'
), closing_rows AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY user_id ORDER BY sequence_number DESC
  ) AS row_number
  FROM classified
  WHERE occurred_at < '2026-10-01T00:00:00.000Z'
), totals AS (
  SELECT
    user_id,
    SUM(CASE WHEN amount >= 0 THEN amount ELSE 0 END) AS additions,
    SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS deductions,
    MIN(sequence_number) AS first_month_sequence,
    MAX(sequence_number) AS last_month_sequence
  FROM month_rows
  GROUP BY user_id
), boundary_rows AS (
  SELECT
    totals.user_id,
    COUNT(*) AS boundary_row_count
  FROM totals
  JOIN classified
    ON classified.user_id = totals.user_id
   AND classified.sequence_number BETWEEN totals.first_month_sequence
                                      AND totals.last_month_sequence
  WHERE classified.occurred_at < '2026-09-01T00:00:00.000Z'
     OR classified.occurred_at >= '2026-10-01T00:00:00.000Z'
  GROUP BY totals.user_id
)
SELECT
  u.employee_id,
  u.user_id AS canonical_user_id,
  origin_counts.origin_count,
  latest.balance_after AS current_latest_balance,
  latest.balance_after - origins.origin_delta AS corrected_latest_balance,
  u.balance AS current_users_balance,
  latest.balance_after - origins.origin_delta AS proposed_final_users_balance,
  COALESCE(prior_rows.balance_after,
    first_month.balance_after - first_month.amount) AS opening_balance,
  totals.additions,
  totals.deductions,
  closing_rows.balance_after AS current_monthly_closing_balance,
  closing_rows.balance_after - origins.origin_delta AS corrected_monthly_closing_balance,
  COALESCE(prior_rows.balance_after,
    first_month.balance_after - first_month.amount)
    + totals.additions - totals.deductions AS amount_reconciled_closing_balance,
  closing_rows.balance_after - (
    COALESCE(prior_rows.balance_after,
      first_month.balance_after - first_month.amount)
      + totals.additions - totals.deductions
  ) AS current_monthly_delta,
  closing_rows.balance_after - origins.origin_delta - (
    COALESCE(prior_rows.balance_after,
      first_month.balance_after - first_month.amount)
      + totals.additions - totals.deductions
  ) AS corrected_monthly_delta,
  COALESCE(boundary_rows.boundary_row_count, 0) AS boundary_row_count,
  CASE
    WHEN COALESCE(boundary_rows.boundary_row_count, 0) > 0
    THEN 'SEQUENCE_DATE_BOUNDARY_MISMATCH'
    ELSE 'CONSISTENT'
  END AS corrected_monthly_status
FROM users u
JOIN origin_counts ON origin_counts.user_id = u.user_id
  AND origin_counts.origin_count = 1
JOIN origins ON origins.user_id = u.user_id
JOIN latest ON latest.user_id = u.user_id AND latest.row_number = 1
JOIN first_month ON first_month.user_id = u.user_id AND first_month.row_number = 1
JOIN closing_rows ON closing_rows.user_id = u.user_id AND closing_rows.row_number = 1
JOIN totals ON totals.user_id = u.user_id
LEFT JOIN prior_rows ON prior_rows.user_id = u.user_id AND prior_rows.row_number = 1
LEFT JOIN boundary_rows ON boundary_rows.user_id = u.user_id
WHERE u.employee_id IN ('070214', '105499', '121254')
ORDER BY u.employee_id;
