PRAGMA foreign_keys = ON;

-- Old settlement summaries can reflect the earlier name-based attribution.
-- Preserve them unchanged but keep them untrusted (NULL) until a separate,
-- reviewed reconciliation is authorized. New Worker-created records identify
-- the attribution basis used to calculate them.
ALTER TABLE vendor_day_snapshots ADD COLUMN attribution_basis TEXT
  CHECK (attribution_basis IS NULL OR attribution_basis = 'CANONICAL_VENDOR_ATTRIBUTION_V1');
ALTER TABLE vendor_transfer_allocations ADD COLUMN attribution_basis TEXT
  CHECK (attribution_basis IS NULL OR attribution_basis = 'CANONICAL_VENDOR_ATTRIBUTION_V1');

CREATE INDEX IF NOT EXISTS idx_vendor_day_snapshots_verified_latest
  ON vendor_day_snapshots(vendor_id, service_date, attribution_basis, revision DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_transfer_allocations_verified_day
  ON vendor_transfer_allocations(vendor_id, service_date, attribution_basis, payment_id);

-- A verified snapshot is an upper bound only while current active orders still
-- support it. Recompute canonical receivables from the attribution view so an
-- append-only snapshot cannot authorize payments after an order is cancelled.
CREATE VIEW IF NOT EXISTS vendor_active_attributed_receivables AS
SELECT attribution.vendor_id, o.order_date AS service_date,
  SUM(oi.subtotal) AS amount_twd
FROM vendor_order_vendor_attributions attribution
JOIN orders o ON o.order_id = attribution.order_id
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status = 'ACTIVE'
GROUP BY attribution.vendor_id, o.order_date;

-- Legacy snapshots are excluded from the receivable limit. If no verified
-- snapshot exists, calculate from the reviewed order-attribution view only.
DROP TRIGGER IF EXISTS vendor_transfer_allocations_day_receivable;
CREATE TRIGGER vendor_transfer_allocations_day_receivable
BEFORE INSERT ON vendor_transfer_allocations
WHEN NEW.amount_twd + COALESCE((
  SELECT SUM(a.amount_twd + COALESCE((
    SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
    WHERE e.allocation_id = a.allocation_id
  ), 0))
  FROM vendor_transfer_allocations a
  WHERE a.vendor_id = NEW.vendor_id AND a.service_date = NEW.service_date
), 0) > COALESCE((
  SELECT MIN(s.amount_twd, COALESCE(current.amount_twd, 0))
  FROM vendor_day_snapshots s
  LEFT JOIN vendor_active_attributed_receivables current
    ON current.vendor_id = s.vendor_id AND current.service_date = s.service_date
  WHERE s.vendor_id = NEW.vendor_id AND s.service_date = NEW.service_date
    AND s.attribution_basis = 'CANONICAL_VENDOR_ATTRIBUTION_V1'
  ORDER BY s.revision DESC LIMIT 1
), COALESCE((
  SELECT current.amount_twd FROM vendor_active_attributed_receivables current
  WHERE current.vendor_id = NEW.vendor_id AND current.service_date = NEW.service_date
), 0))
BEGIN SELECT RAISE(ABORT, 'VENDOR_DAY_RECEIVABLE_EXCEEDED'); END;

DROP TRIGGER IF EXISTS vendor_transfer_allocation_events_capacity;
CREATE TRIGGER vendor_transfer_allocation_events_capacity
BEFORE INSERT ON vendor_transfer_allocation_events
WHEN NOT EXISTS (
  SELECT 1
  FROM vendor_transfer_allocations a
  JOIN vendor_transfer_payments p ON p.payment_id = a.payment_id AND p.vendor_id = a.vendor_id
  WHERE a.allocation_id = NEW.allocation_id
    AND NOT EXISTS (
      SELECT 1 FROM vendor_payment_events e
      WHERE e.payment_id = p.payment_id AND e.event_type = 'REVERSED'
    )
    AND a.amount_twd + COALESCE((
      SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
      WHERE e.allocation_id = a.allocation_id
    ), 0) + NEW.delta_twd >= 0
    AND COALESCE((
      SELECT SUM(other.amount_twd + COALESCE((
        SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
        WHERE e.allocation_id = other.allocation_id
      ), 0))
      FROM vendor_transfer_allocations other WHERE other.payment_id = p.payment_id
    ), 0) + NEW.delta_twd <= p.amount_twd
    AND (NEW.delta_twd <= 0 OR COALESCE((
      SELECT SUM(other.amount_twd + COALESCE((
        SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
        WHERE e.allocation_id = other.allocation_id
      ), 0))
      FROM vendor_transfer_allocations other
      WHERE other.vendor_id = a.vendor_id AND other.service_date = a.service_date
    ), 0) + NEW.delta_twd <= COALESCE((
      SELECT MIN(s.amount_twd, COALESCE(current.amount_twd, 0))
      FROM vendor_day_snapshots s
      LEFT JOIN vendor_active_attributed_receivables current
        ON current.vendor_id = s.vendor_id AND current.service_date = s.service_date
      WHERE s.vendor_id = a.vendor_id AND s.service_date = a.service_date
        AND s.attribution_basis = 'CANONICAL_VENDOR_ATTRIBUTION_V1'
      ORDER BY s.revision DESC LIMIT 1
    ), COALESCE((
      SELECT current.amount_twd FROM vendor_active_attributed_receivables current
      WHERE current.vendor_id = a.vendor_id AND current.service_date = a.service_date
    ), 0)))
)
BEGIN SELECT RAISE(ABORT, 'VENDOR_ALLOCATION_ADJUSTMENT_INVALID'); END;
