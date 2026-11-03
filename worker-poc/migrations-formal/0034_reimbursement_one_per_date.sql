-- Reimbursement now covers the whole day's orders, so only one open or
-- approved request may exist per order date across all requesters (was per
-- requester and date in 0032). Rejected requests may be filed again.
DROP INDEX IF EXISTS idx_reimbursement_one_open_per_date;

CREATE UNIQUE INDEX idx_reimbursement_one_open_per_date
  ON reimbursement_requests(order_date)
  WHERE status IN ('PENDING', 'APPROVED');
