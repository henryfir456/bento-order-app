PRAGMA foreign_keys = ON;

-- Store canonical vendor IDs on orders created by the current Worker. Historical
-- rows remain nullable until their immutable menu identity is explicitly reviewed.
ALTER TABLE orders ADD COLUMN vendor_id TEXT
  REFERENCES vendors(vendor_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_orders_vendor_id_date_status
  ON orders(vendor_id, order_date, status);

-- A reviewed menu-version mapping is an append-only identity decision. There is
-- deliberately no display-name or alias-based seed/backfill in this migration.
CREATE TABLE IF NOT EXISTS vendor_menu_version_mapping_events (
  event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  menu_version_id TEXT NOT NULL REFERENCES menu_versions(menu_version_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  vendor_id TEXT REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  effective_date TEXT NOT NULL CHECK (effective_date GLOB '????-??-??'),
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('VERIFIED', 'REVOKED')),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind = 'MENU_VERSION_ID_EFFECTIVE_DATE'),
  reviewed_by_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TEXT NOT NULL,
  UNIQUE (menu_version_id, revision),
  CHECK ((mapping_status = 'VERIFIED' AND vendor_id IS NOT NULL)
    OR (mapping_status = 'REVOKED' AND vendor_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_vendor_menu_version_mapping_latest
  ON vendor_menu_version_mapping_events(menu_version_id, revision DESC);

CREATE TRIGGER IF NOT EXISTS vendor_menu_version_mapping_insert_guard
BEFORE INSERT ON vendor_menu_version_mapping_events
WHEN NOT EXISTS (
  SELECT 1 FROM menu_versions mv
  WHERE mv.menu_version_id = NEW.menu_version_id
    AND mv.effective_date = NEW.effective_date
) OR NEW.revision <> COALESCE((
  SELECT MAX(previous.revision) + 1
  FROM vendor_menu_version_mapping_events previous
  WHERE previous.menu_version_id = NEW.menu_version_id
), 1) OR NOT EXISTS (
  SELECT 1 FROM users reviewer
  WHERE reviewer.user_id = NEW.reviewed_by_user_id
    AND reviewer.role = 'Admin' AND reviewer.active = 1
)
BEGIN SELECT RAISE(ABORT, 'VENDOR_MENU_VERSION_MAPPING_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS vendor_menu_version_mapping_immutable_update
BEFORE UPDATE ON vendor_menu_version_mapping_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_MENU_VERSION_MAPPING_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_menu_version_mapping_immutable_delete
BEFORE DELETE ON vendor_menu_version_mapping_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_MENU_VERSION_MAPPING_APPEND_ONLY'); END;

-- This marker distinguishes IDs written directly by the new order path from
-- values an older version of migration 0019 may have inferred from labels.
CREATE TABLE IF NOT EXISTS canonical_order_vendor_assignments (
  order_id TEXT PRIMARY KEY REFERENCES orders(order_id) ON DELETE RESTRICT,
  vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_order_vendor_assignments_vendor_date
  ON canonical_order_vendor_assignments(vendor_id, assigned_at, order_id);

CREATE TRIGGER IF NOT EXISTS canonical_order_vendor_assignment_insert_guard
BEFORE INSERT ON canonical_order_vendor_assignments
WHEN NOT EXISTS (
  SELECT 1 FROM orders o
  WHERE o.order_id = NEW.order_id
    AND o.vendor_id = NEW.vendor_id
    AND o.created_at = NEW.assigned_at
)
BEGIN SELECT RAISE(ABORT, 'CANONICAL_ORDER_VENDOR_ASSIGNMENT_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS canonical_order_vendor_assignment_after_insert
AFTER INSERT ON orders
WHEN NEW.vendor_id IS NOT NULL
BEGIN
  INSERT INTO canonical_order_vendor_assignments (order_id, vendor_id, assigned_at)
  VALUES (NEW.order_id, NEW.vendor_id, NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS canonical_order_vendor_assignment_immutable_update
BEFORE UPDATE ON canonical_order_vendor_assignments
BEGIN SELECT RAISE(ABORT, 'CANONICAL_ORDER_VENDOR_ASSIGNMENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS canonical_order_vendor_assignment_immutable_delete
BEFORE DELETE ON canonical_order_vendor_assignments
BEGIN SELECT RAISE(ABORT, 'CANONICAL_ORDER_VENDOR_ASSIGNMENT_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS orders_vendor_id_immutable_update
BEFORE UPDATE OF vendor_id ON orders
WHEN NEW.vendor_id IS NOT OLD.vendor_id
BEGIN SELECT RAISE(ABORT, 'ORDER_VENDOR_ID_IMMUTABLE'); END;

-- Legacy orders enter this view only when every line points to an exact menu
-- item/version, that version has a current reviewed vendor mapping, its
-- effective date is no later than the service date, and all lines agree.
CREATE VIEW IF NOT EXISTS vendor_order_vendor_attributions AS
WITH latest_mappings AS (
  SELECT mapping.menu_version_id, mapping.vendor_id, mapping.effective_date
  FROM vendor_menu_version_mapping_events mapping
  WHERE mapping.revision = (
    SELECT MAX(latest.revision)
    FROM vendor_menu_version_mapping_events latest
    WHERE latest.menu_version_id = mapping.menu_version_id
  )
    AND mapping.mapping_status = 'VERIFIED'
), resolved_items AS (
  SELECT o.order_id, mapping.vendor_id
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.order_id
  JOIN menu_items mi ON mi.menu_item_id = oi.menu_item_id
  JOIN menu_versions mv ON mv.menu_version_id = mi.menu_version_id
  JOIN latest_mappings mapping ON mapping.menu_version_id = mv.menu_version_id
  WHERE mapping.effective_date = mv.effective_date
    AND mapping.effective_date <= o.order_date
    AND (oi.legacy_item_id IS NULL OR oi.legacy_item_id = mi.legacy_item_id)
    AND NOT EXISTS (
      SELECT 1 FROM canonical_order_vendor_assignments direct
      WHERE direct.order_id = o.order_id
    )
), resolved_legacy_orders AS (
  SELECT resolved.order_id, MIN(resolved.vendor_id) AS vendor_id
  FROM resolved_items resolved
  GROUP BY resolved.order_id
  HAVING COUNT(*) = (
    SELECT COUNT(*) FROM order_items all_items
    WHERE all_items.order_id = resolved.order_id
  )
    AND MIN(resolved.vendor_id) = MAX(resolved.vendor_id)
)
SELECT direct.order_id, direct.vendor_id
FROM canonical_order_vendor_assignments direct
UNION ALL
SELECT historical.order_id, historical.vendor_id
FROM resolved_legacy_orders historical;

-- Read-only order snapshots and bank-transfer records are separate from the
-- employee balance ledger. All history is append-only and contains no buyer
-- identity, bank account number, or payment image.
CREATE TABLE IF NOT EXISTS vendor_day_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  service_date TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  snapshot_kind TEXT NOT NULL CHECK (snapshot_kind IN ('BASELINE', 'ADJUSTMENT')),
  order_count INTEGER NOT NULL CHECK (order_count >= 0),
  portion_count INTEGER NOT NULL CHECK (portion_count >= 0),
  amount_twd INTEGER NOT NULL CHECK (amount_twd >= 0),
  items_json TEXT NOT NULL CHECK (json_valid(items_json)),
  change_reason TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (vendor_id, service_date, revision)
);

CREATE INDEX IF NOT EXISTS idx_vendor_day_snapshots_latest
  ON vendor_day_snapshots(vendor_id, service_date, revision DESC);

CREATE TABLE IF NOT EXISTS vendor_transfer_payments (
  payment_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  amount_twd INTEGER NOT NULL CHECK (amount_twd > 0),
  transferred_on TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (created_by_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_vendor_transfer_payments_vendor_date
  ON vendor_transfer_payments(vendor_id, transferred_on, created_at);

CREATE TABLE IF NOT EXISTS vendor_transfer_allocations (
  allocation_id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES vendor_transfer_payments(payment_id) ON DELETE RESTRICT,
  vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id) ON DELETE RESTRICT,
  service_date TEXT NOT NULL,
  amount_twd INTEGER NOT NULL CHECK (amount_twd > 0),
  created_by_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_transfer_allocations_day
  ON vendor_transfer_allocations(vendor_id, service_date, payment_id);

CREATE TABLE IF NOT EXISTS vendor_transfer_allocation_events (
  event_id TEXT PRIMARY KEY,
  allocation_id TEXT NOT NULL REFERENCES vendor_transfer_allocations(allocation_id) ON DELETE RESTRICT,
  delta_twd INTEGER NOT NULL CHECK (delta_twd <> 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  actor_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_transfer_allocation_events_allocation
  ON vendor_transfer_allocation_events(allocation_id, created_at);

CREATE TABLE IF NOT EXISTS vendor_payment_events (
  event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  payment_id TEXT NOT NULL REFERENCES vendor_transfer_payments(payment_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('ACKNOWLEDGED', 'DISPUTED', 'RESOLVED', 'REVERSED')),
  reason TEXT NOT NULL DEFAULT '',
  resolution TEXT NOT NULL DEFAULT '',
  actor_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vendor_payment_events_latest
  ON vendor_payment_events(payment_id, event_sequence DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_payment_events_one_vendor_response
  ON vendor_payment_events(payment_id)
  WHERE event_type IN ('ACKNOWLEDGED', 'DISPUTED');
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_payment_events_one_resolution
  ON vendor_payment_events(payment_id)
  WHERE event_type = 'RESOLVED';
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_payment_events_one_reversal
  ON vendor_payment_events(payment_id)
  WHERE event_type = 'REVERSED';

CREATE TRIGGER IF NOT EXISTS vendor_payment_events_state_guard
BEFORE INSERT ON vendor_payment_events
WHEN (
  NEW.event_type IN ('ACKNOWLEDGED', 'DISPUTED')
  AND EXISTS (
    SELECT 1 FROM vendor_payment_events e
    WHERE e.payment_id = NEW.payment_id AND e.event_type = 'REVERSED'
  )
) OR (
  NEW.event_type = 'RESOLVED'
  AND (
    EXISTS (
      SELECT 1 FROM vendor_payment_events e
      WHERE e.payment_id = NEW.payment_id AND e.event_type = 'REVERSED'
    )
    OR NOT EXISTS (
      SELECT 1 FROM vendor_payment_events e
      WHERE e.payment_id = NEW.payment_id AND e.event_type = 'DISPUTED'
    )
  )
) OR (
  NEW.event_type = 'REVERSED'
  AND (
    EXISTS (
      SELECT 1 FROM vendor_payment_events e
      WHERE e.payment_id = NEW.payment_id AND e.event_type = 'REVERSED'
    )
    OR EXISTS (
      SELECT 1 FROM vendor_transfer_allocations a
      WHERE a.payment_id = NEW.payment_id
        AND a.amount_twd + COALESCE((
          SELECT SUM(offset.delta_twd) FROM vendor_transfer_allocation_events offset
          WHERE offset.allocation_id = a.allocation_id
        ), 0) <> 0
    )
    OR EXISTS (
      SELECT 1 FROM vendor_payment_events disputed
      WHERE disputed.payment_id = NEW.payment_id AND disputed.event_type = 'DISPUTED'
        AND NOT EXISTS (
          SELECT 1 FROM vendor_payment_events resolved
          WHERE resolved.payment_id = disputed.payment_id
            AND resolved.event_type = 'RESOLVED'
            AND resolved.event_sequence > disputed.event_sequence
        )
    )
  )
)
BEGIN SELECT RAISE(ABORT, 'VENDOR_PAYMENT_EVENT_STATE_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS vendor_payment_events_immutable_update
BEFORE UPDATE ON vendor_payment_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_PAYMENT_EVENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_payment_events_immutable_delete
BEFORE DELETE ON vendor_payment_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_PAYMENT_EVENT_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS vendor_day_snapshots_immutable_update
BEFORE UPDATE ON vendor_day_snapshots
BEGIN SELECT RAISE(ABORT, 'VENDOR_SNAPSHOT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_day_snapshots_immutable_delete
BEFORE DELETE ON vendor_day_snapshots
BEGIN SELECT RAISE(ABORT, 'VENDOR_SNAPSHOT_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS vendor_transfer_payments_immutable_update
BEFORE UPDATE ON vendor_transfer_payments
BEGIN SELECT RAISE(ABORT, 'VENDOR_PAYMENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_transfer_payments_immutable_delete
BEFORE DELETE ON vendor_transfer_payments
BEGIN SELECT RAISE(ABORT, 'VENDOR_PAYMENT_APPEND_ONLY'); END;

CREATE TRIGGER IF NOT EXISTS vendor_transfer_allocations_scope_and_capacity
BEFORE INSERT ON vendor_transfer_allocations
WHEN NOT EXISTS (
  SELECT 1 FROM vendor_transfer_payments p
  WHERE p.payment_id = NEW.payment_id AND p.vendor_id = NEW.vendor_id
    AND COALESCE((
      SELECT SUM(a.amount_twd + COALESCE((
        SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
        WHERE e.allocation_id = a.allocation_id
      ), 0))
      FROM vendor_transfer_allocations a WHERE a.payment_id = p.payment_id
    ), 0) + NEW.amount_twd <= p.amount_twd
)
BEGIN SELECT RAISE(ABORT, 'VENDOR_PAYMENT_ALLOCATION_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS vendor_transfer_allocations_day_receivable
BEFORE INSERT ON vendor_transfer_allocations
WHEN NEW.amount_twd + COALESCE((
  SELECT SUM(a.amount_twd + COALESCE((
    SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
    WHERE e.allocation_id = a.allocation_id
  ), 0))
  FROM vendor_transfer_allocations a
  WHERE a.vendor_id = NEW.vendor_id AND a.service_date = NEW.service_date
), 0) > COALESCE((
  SELECT s.amount_twd FROM vendor_day_snapshots s
  WHERE s.vendor_id = NEW.vendor_id AND s.service_date = NEW.service_date
  ORDER BY s.revision DESC LIMIT 1
), COALESCE((
  SELECT SUM(oi.subtotal)
  FROM vendor_order_vendor_attributions attribution
  JOIN orders o ON o.order_id = attribution.order_id
  JOIN order_items oi ON oi.order_id = o.order_id
  WHERE attribution.vendor_id = NEW.vendor_id
    AND o.order_date = NEW.service_date
    AND o.status = 'ACTIVE'
), -1))
BEGIN SELECT RAISE(ABORT, 'VENDOR_DAY_RECEIVABLE_EXCEEDED'); END;

CREATE TRIGGER IF NOT EXISTS vendor_transfer_allocation_events_capacity
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
    AND COALESCE((
      SELECT SUM(other.amount_twd + COALESCE((
        SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
        WHERE e.allocation_id = other.allocation_id
      ), 0))
      FROM vendor_transfer_allocations other
      WHERE other.vendor_id = a.vendor_id AND other.service_date = a.service_date
    ), 0) + NEW.delta_twd <= COALESCE((
      SELECT s.amount_twd FROM vendor_day_snapshots s
      WHERE s.vendor_id = a.vendor_id AND s.service_date = a.service_date
      ORDER BY s.revision DESC LIMIT 1
    ), COALESCE((
      SELECT SUM(oi.subtotal)
      FROM vendor_order_vendor_attributions attribution
      JOIN orders o ON o.order_id = attribution.order_id
      JOIN order_items oi ON oi.order_id = o.order_id
      WHERE attribution.vendor_id = a.vendor_id
        AND o.order_date = a.service_date
        AND o.status = 'ACTIVE'
    ), -1))
)
BEGIN SELECT RAISE(ABORT, 'VENDOR_ALLOCATION_ADJUSTMENT_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS vendor_transfer_allocations_immutable_update
BEFORE UPDATE ON vendor_transfer_allocations
BEGIN SELECT RAISE(ABORT, 'VENDOR_ALLOCATION_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_transfer_allocations_immutable_delete
BEFORE DELETE ON vendor_transfer_allocations
BEGIN SELECT RAISE(ABORT, 'VENDOR_ALLOCATION_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_transfer_allocation_events_immutable_update
BEFORE UPDATE ON vendor_transfer_allocation_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_ALLOCATION_EVENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_transfer_allocation_events_immutable_delete
BEFORE DELETE ON vendor_transfer_allocation_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_ALLOCATION_EVENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_payment_events_immutable_update
BEFORE UPDATE ON vendor_payment_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_PAYMENT_EVENT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS vendor_payment_events_immutable_delete
BEFORE DELETE ON vendor_payment_events
BEGIN SELECT RAISE(ABORT, 'VENDOR_PAYMENT_EVENT_APPEND_ONLY'); END;
