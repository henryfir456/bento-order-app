import { createHash } from 'node:crypto';

import { ImportContractError } from './import-contract.mjs';
import { prepareStatement, runMutationBatch } from '../../src/db/transactions.js';

export const FORMAL_CLEANUP_TARGET = Object.freeze({
  name: 'bento-formal',
  databaseId: 'e75bc185-afb5-4a5d-abc9-81bd79525cff'
});

export const APPROVED_BACKUP_SHA256 = 'e6bb2675b4138de895d785c7e9ddafc75da9ed65faf2a272f2e01051f6f1c31d';

export const CLEANUP_SNAPSHOT_KIND = 'bento-formal-test-cleanup-preflight';

export const PRE_CLEANUP_COUNTS = Object.freeze({
  users: 3,
  orders: 17,
  order_items: 21,
  order_status_history: 17,
  balance_ledger: 2,
  balance_ledger_sequence: 2,
  opening_balance_snapshots: 3,
  calendar_settings: 15,
  likes: 7,
  idempotency_keys: 2,
  admin_audit_log: 11,
  menu_versions: 3,
  menu_items: 28,
  announcements: 2,
  import_batches: 1,
  import_quarantine: 5,
  employee_guest_sessions: 0,
  d1_migrations: 3,
  sqlite_sequence: 2
});

export const POST_CLEANUP_COUNTS = Object.freeze({
  users: 3,
  orders: 0,
  order_items: 0,
  order_status_history: 0,
  balance_ledger: 0,
  balance_ledger_sequence: 0,
  opening_balance_snapshots: 0,
  calendar_settings: 0,
  likes: 0,
  idempotency_keys: 0,
  admin_audit_log: 0,
  menu_versions: 3,
  menu_items: 28,
  announcements: 2,
  import_batches: 1,
  import_quarantine: 5,
  employee_guest_sessions: 0,
  d1_migrations: 3,
  sqlite_sequence: 2
});

export const PRE_CLEANUP_LEDGER_BY_TYPE = Object.freeze({
  TOPUP: Object.freeze({ count: 0, amountTotal: 0 }),
  ORDER: Object.freeze({ count: 2, amountTotal: -300 }),
  REFUND: Object.freeze({ count: 0, amountTotal: 0 }),
  ADJUSTMENT: Object.freeze({ count: 0, amountTotal: 0 })
});

export const CLEANUP_SQL = Object.freeze([
  'DELETE FROM employee_guest_sessions',
  'DELETE FROM order_items',
  'DELETE FROM order_status_history',
  'DELETE FROM balance_ledger_sequence',
  'DELETE FROM balance_ledger',
  'DELETE FROM opening_balance_snapshots',
  'DELETE FROM likes',
  'DELETE FROM idempotency_keys',
  'DELETE FROM admin_audit_log',
  'DELETE FROM orders',
  'DELETE FROM calendar_settings',
  'UPDATE users SET balance = 0 WHERE balance <> 0'
]);

// Cloudflare's D1 export omits the internal _cf_KV table even though the
// formal remote preflight has confirmed that it exists.  Keep the approved
// inventory in the shared cleanup contract so export-derived baselines can
// be compared with the live remote database without treating the omission as
// a silent preservation exception.
export const EXPECTED_INTERNAL_TABLE_INVENTORY = Object.freeze([
  Object.freeze({ type: 'table', name: '_cf_KV', tbl_name: '_cf_KV' }),
  Object.freeze({ type: 'table', name: 'sqlite_sequence', tbl_name: 'sqlite_sequence' })
]);

// Audit rows are an approved cleanup target and may be appended by normal
// runtime/test activity between the reviewed preflight and execution.  Their
// presence is still required in a snapshot, but their pre-clean row count is
// intentionally not an exact baseline guard.  Post-clean reconciliation keeps
// the target at zero.
export const NON_EXACT_CLEANUP_BASELINE_COUNT_FIELDS = Object.freeze([
  'admin_audit_log'
]);

const COUNT_TABLES = Object.freeze(Object.keys(PRE_CLEANUP_COUNTS));
const LEDGER_TYPES = Object.freeze(['TOPUP', 'ORDER', 'REFUND', 'ADJUSTMENT']);

const DIGEST_QUERIES = Object.freeze({
  usersIdentity: `
    SELECT user_id, employee_id, line_user_id, display_name, pickup_floor, role, active
    FROM users
    ORDER BY user_id
  `,
  menuVersions: `
    SELECT menu_version_id, vendor, effective_date, source_batch_id, created_at
    FROM menu_versions
    ORDER BY menu_version_id
  `,
  menuItems: `
    SELECT menu_item_id, menu_version_id, legacy_item_id, item_name, price,
      enabled, note, image_url, source_order, created_at, updated_at
    FROM menu_items
    ORDER BY menu_item_id
  `,
  announcements: `
    SELECT announcement_id, title, content, start_date, end_date, enabled,
      source_order, created_at, updated_at
    FROM announcements
    ORDER BY announcement_id
  `,
  importBatches: `
    SELECT batch_id, source_hash, importer_version, status, created_at, completed_at
    FROM import_batches
    ORDER BY batch_id
  `,
  importQuarantine: `
    SELECT quarantine_id, batch_id, entity_type, source_sheet, source_row,
      reason_code, raw_payload_json, normalized_payload_json, review_state,
      reviewed_by_user_id, resolution_json, created_at, reviewed_at
    FROM import_quarantine
    ORDER BY quarantine_id
  `,
  d1Migrations: `
    SELECT id, name, applied_at
    FROM d1_migrations
    ORDER BY id
  `,
  sqliteSequence: `
    SELECT name, seq
    FROM sqlite_sequence
    ORDER BY name
  `,
  internalTableInventory: `
    SELECT type, name, tbl_name
    FROM sqlite_master
    WHERE type = 'table' AND name IN ('_cf_KV', 'sqlite_sequence')
    ORDER BY name
  `
});

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const readRows = async (database, query, bindings = []) => {
  const result = await database.prepare(query).bind(...bindings).all();
  return rowsFrom(result);
};

const readFirst = async (database, query, bindings = []) => (
  (await database.prepare(query).bind(...bindings).first()) || null
);

const normalizeForDigest = (value) => {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(normalizeForDigest);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeForDigest(value[key])])
    );
  }
  return value;
};

export const digestRows = (rows) => createHash('sha256')
  .update(JSON.stringify(normalizeForDigest(rows)))
  .digest('hex');

const countTable = async (database, table) => {
  const row = await readFirst(database, `SELECT COUNT(*) AS row_count FROM ${table}`);
  return Number(row?.row_count || 0);
};

const emptyLedgerByType = () => Object.fromEntries(
  LEDGER_TYPES.map((type) => [type, { count: 0, amountTotal: 0 }])
);

const readLedgerByType = async (database) => {
  const ledger = emptyLedgerByType();
  const rows = await readRows(database, `
    SELECT type, COUNT(*) AS row_count, COALESCE(SUM(amount), 0) AS amount_total
    FROM balance_ledger
    GROUP BY type
  `);
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(ledger, row.type)) continue;
    ledger[row.type] = {
      count: Number(row.row_count || 0),
      amountTotal: Number(row.amount_total || 0)
    };
  }
  return ledger;
};

const readDigests = async (database) => Object.fromEntries(
  await Promise.all(Object.entries(DIGEST_QUERIES).map(async ([name, query]) => [
    name,
    digestRows(await readRows(database, query))
  ]))
);

const readUsersBalanceTotal = async (database) => {
  const row = await readFirst(database, `
    SELECT COALESCE(SUM(balance), 0) AS balance_total
    FROM users
  `);
  return Number(row?.balance_total || 0);
};

const readForeignKeys = async (database) => {
  const pragma = await readFirst(database, 'PRAGMA foreign_keys');
  const violations = await readRows(database, 'PRAGMA foreign_key_check');
  return {
    enabled: Number(pragma?.foreign_keys || 0),
    violations
  };
};

const readProtectedObjects = async (database) => {
  const rows = await readRows(database, `
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name IN ('_cf_KV', 'sqlite_sequence')
    ORDER BY name
  `);
  const names = new Set(rows.map((row) => row.name));
  return {
    cfKvPresent: names.has('_cf_KV'),
    sqliteSequencePresent: names.has('sqlite_sequence')
  };
};

export const assertFormalCleanupTarget = ({
  target,
  databaseId,
  configuredDatabaseId,
  requireDatabaseId = true
} = {}) => {
  if (String(target || '').trim() !== FORMAL_CLEANUP_TARGET.name) {
    throw new ImportContractError(
      'CLEANUP_TARGET_INVALID',
      `Cleanup requires target ${FORMAL_CLEANUP_TARGET.name}.`
    );
  }

  const suppliedDatabaseId = databaseId ?? configuredDatabaseId;
  if (requireDatabaseId && !String(suppliedDatabaseId || '').trim()) {
    throw new ImportContractError(
      'CLEANUP_DATABASE_ID_REQUIRED',
      'Cleanup requires the formal D1 database UUID.'
    );
  }
  if (suppliedDatabaseId !== undefined
    && suppliedDatabaseId !== null
    && String(suppliedDatabaseId).trim() !== FORMAL_CLEANUP_TARGET.databaseId) {
    throw new ImportContractError(
      'CLEANUP_DATABASE_ID_INVALID',
      `Cleanup requires database UUID ${FORMAL_CLEANUP_TARGET.databaseId}.`
    );
  }
  if (configuredDatabaseId !== undefined
    && configuredDatabaseId !== null
    && String(configuredDatabaseId).trim() !== FORMAL_CLEANUP_TARGET.databaseId) {
    throw new ImportContractError(
      'CLEANUP_CONFIG_DATABASE_ID_MISMATCH',
      'The active Wrangler configuration does not identify the formal D1 target.'
    );
  }
  return { ...FORMAL_CLEANUP_TARGET };
};

export const confirmationEnvironmentVariable = (executionMode = 'local') => (
  executionMode === 'remote' ? 'CONFIRM_REMOTE_CLEANUP' : 'CONFIRM_LOCAL_CLEANUP'
);

export const assertCleanupConfirmation = ({
  confirmed = false,
  dryRun = true,
  executionMode = 'local'
} = {}) => {
  if (dryRun) return true;
  if (confirmed !== true) {
    const variable = confirmationEnvironmentVariable(executionMode);
    throw new ImportContractError(
      'CLEANUP_CONFIRMATION_REQUIRED',
      `Destructive cleanup requires ${variable}=YES and explicit execute mode.`
    );
  }
  return true;
};

export const buildCleanupStatements = (database) => (
  CLEANUP_SQL.map((query) => prepareStatement(database, query, []))
);

export const readCleanupSnapshot = async (
  database,
  { target = FORMAL_CLEANUP_TARGET.name, databaseId = FORMAL_CLEANUP_TARGET.databaseId } = {}
) => {
  const counts = Object.fromEntries(
    await Promise.all(COUNT_TABLES.map(async (table) => [table, await countTable(database, table)]))
  );
  const foreignKeys = await readForeignKeys(database);
  const protectedObjects = await readProtectedObjects(database);
  return {
    kind: CLEANUP_SNAPSHOT_KIND,
    target: { name: target, databaseId },
    capturedAt: new Date().toISOString(),
    counts,
    metrics: {
      usersBalanceTotal: await readUsersBalanceTotal(database),
      ledgerByType: await readLedgerByType(database)
    },
    digests: await readDigests(database),
    foreignKeys: {
      enabled: foreignKeys.enabled,
      violations: foreignKeys.violations
    },
    protectedObjects
  };
};

const stableEqual = (left, right) => (
  JSON.stringify(normalizeForDigest(left)) === JSON.stringify(normalizeForDigest(right))
);

const compareSnapshotFields = (actual, expected, {
  ignoredCountFields = []
} = {}) => {
  const mismatches = [];
  const ignoredCounts = new Set(ignoredCountFields);
  for (const [table, expectedCount] of Object.entries(expected.counts || {})) {
    if (ignoredCounts.has(table)) continue;
    if (actual.counts?.[table] !== expectedCount) {
      mismatches.push({
        field: `counts.${table}`,
        expected: expectedCount,
        actual: actual.counts?.[table]
      });
    }
  }
  const scalarFields = [
    ['metrics.usersBalanceTotal', actual.metrics?.usersBalanceTotal, expected.metrics?.usersBalanceTotal],
    ['foreignKeys.enabled', actual.foreignKeys?.enabled, expected.foreignKeys?.enabled]
  ];
  for (const [field, actualValue, expectedValue] of scalarFields) {
    if (actualValue !== expectedValue) mismatches.push({ field, expected: expectedValue, actual: actualValue });
  }
  for (const field of [
    'metrics.ledgerByType',
    'digests',
    'foreignKeys.violations',
    'protectedObjects'
  ]) {
    const actualValue = field.split('.').reduce((value, key) => value?.[key], actual);
    const expectedValue = field.split('.').reduce((value, key) => value?.[key], expected);
    if (expectedValue === undefined) continue;
    if (!stableEqual(actualValue, expectedValue)) mismatches.push({ field, expected: expectedValue, actual: actualValue });
  }
  return mismatches;
};

const ensureCountSet = (snapshot) => {
  for (const table of COUNT_TABLES) {
    const count = snapshot?.counts?.[table];
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new ImportContractError(
        'CLEANUP_BASELINE_COUNT_REQUIRED',
        `The cleanup snapshot must include a non-negative integer count for ${table}.`
      );
    }
  }
};

const ensureDigestSet = (snapshot) => {
  const names = Object.keys(DIGEST_QUERIES);
  if (!names.every((name) => typeof snapshot?.digests?.[name] === 'string'
    && /^[0-9a-f]{64}$/i.test(snapshot.digests[name]))) {
    throw new ImportContractError(
      'CLEANUP_BASELINE_DIGEST_REQUIRED',
      'The cleanup baseline must include all preserved-table and identity digests.'
    );
  }
};

export const validateCleanupBaseline = (baseline) => {
  if (!baseline || baseline.kind !== CLEANUP_SNAPSHOT_KIND) {
    throw new ImportContractError(
      'CLEANUP_BASELINE_INVALID',
      'A cleanup preflight snapshot is required.'
    );
  }
  assertFormalCleanupTarget({
    target: baseline.target?.name,
    databaseId: baseline.target?.databaseId
  });
  ensureDigestSet(baseline);
  ensureCountSet(baseline);
  const expected = {
    counts: PRE_CLEANUP_COUNTS,
    metrics: {
      usersBalanceTotal: -480,
      ledgerByType: PRE_CLEANUP_LEDGER_BY_TYPE
    },
    foreignKeys: {
      enabled: 1,
      violations: []
    },
    protectedObjects: {
      cfKvPresent: true,
      sqliteSequencePresent: true
    }
  };
  const mismatches = compareSnapshotFields(baseline, expected, {
    ignoredCountFields: NON_EXACT_CLEANUP_BASELINE_COUNT_FIELDS
  });
  if (mismatches.length) {
    throw new ImportContractError(
      'CLEANUP_BASELINE_NOT_EXPECTED',
      'The cleanup baseline does not match the reviewed formal D1 preflight.',
      { mismatches }
    );
  }
  return true;
};

export const compareCleanupSnapshot = (actual, baseline) => {
  const mismatches = compareSnapshotFields(actual, baseline, {
    ignoredCountFields: NON_EXACT_CLEANUP_BASELINE_COUNT_FIELDS
  });
  return { matches: mismatches.length === 0, mismatches };
};

export const reconcileCleanup = (after, before) => {
  const expected = {
    counts: POST_CLEANUP_COUNTS,
    metrics: {
      usersBalanceTotal: 0,
      ledgerByType: emptyLedgerByType()
    },
    digests: before.digests,
    foreignKeys: {
      enabled: 1,
      violations: []
    },
    protectedObjects: before.protectedObjects
  };
  const mismatches = compareSnapshotFields(after, expected);
  return {
    passed: mismatches.length === 0,
    mismatches,
    expected
  };
};

export const runFormalCleanup = async (
  database,
  {
    target = FORMAL_CLEANUP_TARGET.name,
    databaseId,
    configuredDatabaseId,
    baseline = null,
    dryRun = true,
    confirmed = false,
    executionMode = 'local',
    remoteExecutionAuthorized = false
  } = {}
) => {
  assertFormalCleanupTarget({ target, databaseId, configuredDatabaseId });
  if (!['local', 'remote'].includes(executionMode)) {
    throw new ImportContractError(
      'CLEANUP_EXECUTION_MODE_INVALID',
      'Cleanup execution mode must be local or remote.'
    );
  }
  if (executionMode === 'remote' && remoteExecutionAuthorized !== true) {
    throw new ImportContractError(
      'REMOTE_CLEANUP_DISABLED',
      'Remote cleanup requires the bounded remote maintenance adapter.'
    );
  }

  const before = await readCleanupSnapshot(database, { target, databaseId });
  let baselineComparison = null;
  if (baseline) {
    validateCleanupBaseline(baseline);
    baselineComparison = compareCleanupSnapshot(before, baseline);
  }

  if (dryRun) {
    return {
      kind: CLEANUP_SNAPSHOT_KIND,
      mode: 'dry-run',
      target: { ...FORMAL_CLEANUP_TARGET },
      baselineProvided: Boolean(baseline),
      baselineMatches: baselineComparison?.matches ?? null,
      baselineMismatches: baselineComparison?.mismatches || [],
      readyForExecute: Boolean(baselineComparison?.matches),
      before,
      cleanupSql: [...CLEANUP_SQL],
      expectedAfter: POST_CLEANUP_COUNTS
    };
  }

  assertCleanupConfirmation({ confirmed, dryRun, executionMode });
  if (!baseline) {
    throw new ImportContractError(
      'CLEANUP_BASELINE_REQUIRED',
      'Execute mode requires a previously captured cleanup baseline.'
    );
  }
  if (!baselineComparison?.matches) {
    throw new ImportContractError(
      'CLEANUP_BASELINE_MISMATCH',
      'Current counts, balance metrics, FK state, or preserved digests differ from the preflight baseline.',
      { mismatches: baselineComparison?.mismatches || [] }
    );
  }

  try {
    await runMutationBatch(database, buildCleanupStatements(database));
  } catch (error) {
    throw new ImportContractError(
      'CLEANUP_TRANSACTION_FAILED',
      'The atomic cleanup batch failed; D1 must roll back the entire batch.',
      { cause: error?.code || error?.message || 'unknown' }
    );
  }

  const after = await readCleanupSnapshot(database, { target, databaseId });
  const reconciliation = reconcileCleanup(after, before);
  if (!reconciliation.passed) {
    throw new ImportContractError(
      'CLEANUP_RECONCILIATION_FAILED',
      'Cleanup committed but post-clean reconciliation failed; stop and investigate before any further mutation.',
      { mismatches: reconciliation.mismatches }
    );
  }
  return {
    kind: CLEANUP_SNAPSHOT_KIND,
    mode: 'execute',
    target: { ...FORMAL_CLEANUP_TARGET },
    before,
    after,
    reconciliation
  };
};
