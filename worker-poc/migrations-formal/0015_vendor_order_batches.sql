-- Additive internal MANUAL handoff state. No existing business table changes.
CREATE TABLE vendor_order_branches (
  branch_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(vendor_id),
  label TEXT NOT NULL,
  policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_by TEXT NOT NULL REFERENCES users(user_id),
  updated_at TEXT NOT NULL
);
CREATE TABLE vendor_order_grants (
  branch_id TEXT NOT NULL REFERENCES vendor_order_branches(branch_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  granted_by TEXT NOT NULL REFERENCES users(user_id),
  PRIMARY KEY(branch_id,user_id)
);
CREATE TABLE vendor_item_mappings (
  mapping_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES vendor_order_branches(branch_id),
  menu_item_id TEXT NOT NULL REFERENCES menu_items(menu_item_id),
  variant_key TEXT NOT NULL CHECK(variant_key IN ('BASE','HALF','PLUS')),
  service_date TEXT NOT NULL,
  external_sku TEXT NOT NULL,
  options_json TEXT NOT NULL CHECK(json_valid(options_json)),
  external_unit_price INTEGER NOT NULL CHECK(external_unit_price >= 0),
  available INTEGER NOT NULL CHECK(available IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_by TEXT NOT NULL REFERENCES users(user_id),
  updated_at TEXT NOT NULL,
  UNIQUE(branch_id,menu_item_id,variant_key,service_date)
);
CREATE TRIGGER vendor_mapping_insert_revision AFTER INSERT ON vendor_item_mappings
BEGIN UPDATE vendor_order_branches SET revision=revision+1 WHERE branch_id=NEW.branch_id; END;
CREATE TRIGGER vendor_mapping_update_revision AFTER UPDATE ON vendor_item_mappings
BEGIN UPDATE vendor_order_branches SET revision=revision+1 WHERE branch_id=NEW.branch_id; END;
CREATE TRIGGER vendor_mapping_delete_revision AFTER DELETE ON vendor_item_mappings
BEGIN UPDATE vendor_order_branches SET revision=revision+1 WHERE branch_id=OLD.branch_id; END;
CREATE TABLE vendor_order_batches (
  batch_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL UNIQUE,
  branch_id TEXT NOT NULL REFERENCES vendor_order_branches(branch_id),
  service_date TEXT NOT NULL,
  floors_json TEXT NOT NULL CHECK(json_valid(floors_json)),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('DRAFT','READY','SUBMITTING','SUBMITTED','UNKNOWN','FAILED','ACCEPTED','REJECTED','CANCELLED')),
  revision INTEGER NOT NULL DEFAULT 1,
  reviewed_by TEXT REFERENCES users(user_id),
  created_by TEXT NOT NULL REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE vendor_order_items (
  batch_id TEXT NOT NULL REFERENCES vendor_order_batches(batch_id),
  source_order_id TEXT NOT NULL,
  source_line_no INTEGER NOT NULL,
  item_json TEXT NOT NULL CHECK(json_valid(item_json)),
  PRIMARY KEY(batch_id,source_order_id,source_line_no)
);
CREATE TABLE vendor_order_attempts (
  attempt_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES vendor_order_batches(batch_id),
  snapshot_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  adapter TEXT NOT NULL CHECK(adapter='MANUAL'),
  actor_user_id TEXT NOT NULL REFERENCES users(user_id),
  created_at TEXT NOT NULL,
  external_reference TEXT,
  reported_amount INTEGER CHECK(reported_amount >= 0),
  payment_status TEXT NOT NULL DEFAULT 'UNCONFIRMED' CHECK(payment_status IN ('UNCONFIRMED','UNPAID','PAID')),
  evidence_source TEXT NOT NULL DEFAULT 'MANUAL_REPORTED' CHECK(evidence_source='MANUAL_REPORTED'),
  platform_verified INTEGER NOT NULL DEFAULT 0 CHECK(platform_verified=0),
  report_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(report_json)),
  UNIQUE(batch_id,snapshot_hash)
);
-- Permanent claims: UNKNOWN, timeout, cancellation and lease expiry do not release.
CREATE TABLE vendor_order_source_claims (
  source_order_id TEXT NOT NULL,
  source_line_no INTEGER NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES vendor_order_attempts(attempt_id),
  PRIMARY KEY(source_order_id,source_line_no)
);
-- Capture ownership at handoff; a cancellation or moved replacement cannot
-- erase it by changing the mutable source order or its pickup floor.
CREATE TABLE vendor_order_owner_claims (
  owner_user_id TEXT NOT NULL REFERENCES users(user_id),
  service_date TEXT NOT NULL,
  vendor TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES vendor_order_attempts(attempt_id),
  PRIMARY KEY(owner_user_id,service_date,vendor)
);
CREATE TRIGGER vendor_order_owner_claim_no_update BEFORE UPDATE ON vendor_order_owner_claims
BEGIN SELECT RAISE(ABORT,'vendor_order_owner_claims are permanent'); END;
CREATE TRIGGER vendor_order_owner_claim_no_delete BEFORE DELETE ON vendor_order_owner_claims
BEGIN SELECT RAISE(ABORT,'vendor_order_owner_claims are permanent'); END;
CREATE TABLE vendor_order_audit (
  audit_id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES vendor_order_batches(batch_id),
  branch_id TEXT NOT NULL REFERENCES vendor_order_branches(branch_id),
  actor_user_id TEXT NOT NULL REFERENCES users(user_id),
  action TEXT NOT NULL,
  snapshot_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
  occurred_at TEXT NOT NULL
);
CREATE TRIGGER vendor_order_audit_no_update BEFORE UPDATE ON vendor_order_audit
BEGIN SELECT RAISE(ABORT,'vendor_order_audit is append-only'); END;
CREATE TRIGGER vendor_order_audit_no_delete BEFORE DELETE ON vendor_order_audit
BEGIN SELECT RAISE(ABORT,'vendor_order_audit is append-only'); END;
CREATE TRIGGER vendor_order_claim_no_update BEFORE UPDATE ON vendor_order_source_claims
BEGIN SELECT RAISE(ABORT,'vendor_order_source_claims are permanent'); END;
CREATE TRIGGER vendor_order_claim_no_delete BEFORE DELETE ON vendor_order_source_claims
BEGIN SELECT RAISE(ABORT,'vendor_order_source_claims are permanent'); END;
-- Transaction assertion: a false predicate aborts the entire D1 batch.
CREATE TABLE vendor_order_mutation_guards (guard_id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE INDEX idx_vendor_batches_branch_date ON vendor_order_batches(branch_id,service_date);
