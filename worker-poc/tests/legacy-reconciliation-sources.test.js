import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ACTIONS,
  buildLegacyReconciliationPlan
} from '../scripts/lib/legacy-reconciliation.mjs';
import { stableId } from '../scripts/lib/import-contract.mjs';

const d1Snapshot = (users = []) => ({
  snapshotVersion: 1,
  users,
  existingKeys: { orders: [], likes: [], balanceLedger: [], openingBalanceSnapshots: [] }
});

const currentUser = (employeeId, overrides = {}) => ({
  employeeId,
  employeeIdSource: 'workbook',
  displayName: overrides.displayName || 'Current User',
  pickupFloor: overrides.pickupFloor || '1樓',
  balance: overrides.balance ?? 100,
  role: overrides.role || 'User',
  active: overrides.active ?? true,
  lineUserId: overrides.lineUserId || null,
  source: { sheet: 'Users', row: overrides.sourceRow || 2 },
  raw: { ...overrides }
});

const canonicalUser = (employeeId, overrides = {}) => ({
  user_id: overrides.user_id || `canonical-${employeeId}`,
  employee_id: employeeId,
  line_user_id: overrides.line_user_id || null,
  display_name: overrides.display_name || 'Current User',
  pickup_floor: overrides.pickup_floor || '1樓',
  balance: overrides.balance ?? 100,
  role: overrides.role || 'User',
  active: overrides.active ?? 1
});

const currentSnapshot = (users = []) => ({
  normalized: {
    sourceHash: 'excel-current-hash',
    importerVersion: 'fixture-version',
    shapeIssues: [],
    Users: users,
    Orders: [],
    Likes: [],
    TopupHistory: [],
    Settings: [],
    Menu: [],
    Announcements: []
  },
  workbook: { sheets: {}, shapeIssues: [] },
  sourceHash: 'excel-current-hash'
});

const historical = ({ employeeId, kind = 'order', sourceId = 11, sourceRow = 100, eventType } = {}) => ({
  historicalOrderFacts: kind === 'order' ? [{
    kind: 'HISTORICAL_ORDER_FACT',
    normalizedEmployeeId: employeeId,
    sourceTable: 'bento_order_status',
    sourceId,
    sourceRow,
    originalEventType: eventType || 'order',
    syntheticOrderId: false,
    rawEvidence: { username: employeeId, username_update: 'operator-1' }
  }] : [],
  historicalLikeFacts: kind === 'like' ? [{
    kind: 'HISTORICAL_LIKE_EVENT',
    normalizedEmployeeId: employeeId,
    sourceTable: 'bento_order_status',
    sourceId,
    sourceRow,
    originalEventType: eventType || 'heart',
    occurredAt: '2026-09-01T00:00:00.000Z',
    rawEvidence: { username: employeeId }
  }] : [],
  historicalWalletFacts: kind === 'wallet' ? [{
    kind: 'HISTORICAL_WALLET_EVENT',
    normalizedEmployeeId: employeeId,
    sourceTable: 'bento_order_status',
    sourceId,
    sourceRow,
    originalEventType: eventType || 'wallet_sub',
    wallet: 20,
    rawEvidence: { username: employeeId }
  }] : [],
  historicalMenuFacts: [],
  historicalTypeFacts: []
});

const plan = ({ currentUsers = [], d1Users = [], facts = historical({ employeeId: '000001' }) } = {}) => (
  buildLegacyReconciliationPlan({
    currentSnapshot: currentSnapshot(currentUsers),
    historicalFacts: facts,
    d1Snapshot: d1Snapshot(d1Users),
    sourceHashes: { excel: 'excel-current-hash', sql: 'sql-history-hash' },
    importerVersion: 'fixture-version'
  })
);

test('SQL historical order resolves to existing non-LINE canonical owner', () => {
  const result = plan({ d1Users: [canonicalUser('000001')] });
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(row.plannedAction, ACTIONS.MERGE_EXISTING_NONLINE);
  assert.equal(row.targetCanonicalUserId, 'canonical-000001');
  assert.equal(row.mutationPreview.kind, 'HISTORICAL_ORDER_FACT_PREVIEW');
  assert.equal(row.mutationPreview.modernOrderMaterialization, false);
  assert.equal(row.mutationPreview.syntheticOrderId, false);
});

test('current state is not NO_CHANGE when SQL history still needs a relationship preview', () => {
  const result = plan({
    currentUsers: [currentUser('000001')],
    d1Users: [canonicalUser('000001')]
  });
  const row = result.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Users');

  assert.equal(row.plannedAction, ACTIONS.MERGE_EXISTING_NONLINE);
  assert.equal(row.reason, 'HISTORICAL_FACT_REQUIRES_RELATIONSHIP_PREVIEW');
});

test('SQL historical order resolves to existing LINE-bound owner without creating another user', () => {
  const result = plan({
    d1Users: [canonicalUser('000001', { user_id: 'canonical-line', line_user_id: 'line-1' })]
  });
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(row.plannedAction, ACTIONS.MERGE_EXISTING_LINE);
  assert.equal(row.targetCanonicalUserId, 'canonical-line');
  assert.equal(result.summary.counts.CREATE_CANONICAL, 0);
});

test('SQL-only identity without D1 owner becomes one deterministic CREATE candidate without guessing profile data', () => {
  const result = plan();
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(row.plannedAction, ACTIONS.CREATE_CANONICAL);
  assert.equal(row.targetCanonicalUserId, stableId('user', '000001'));
  assert.equal(row.mutationPreview.kind, 'HISTORICAL_ORDER_FACT_PREVIEW');
  assert.deepEqual(row.mutationPreview.canonicalUserCandidate.user, {
    user_id: stableId('user', '000001'),
    employee_id: '000001',
    line_user_id: null,
    display_name: 'Legacy employee 000001',
    pickup_floor: null,
    balance: 0,
    role: 'User',
    active: true,
    verification_status: 'UNVERIFIED'
  });
  assert.deepEqual(
    row.mutationPreview.canonicalUserCandidate.blockedByRequiredProfileFields,
    []
  );
  assert.equal(row.mutationPreview.canonicalUserCandidate.canonicalIdentityReady, true);
  assert.equal(row.mutationPreview.canonicalUserCandidate.execute, false);
  assert.equal(result.summary.createCanonicalIdentityCount, 1);
  assert.equal(result.summary.createCanonicalReadyCount, 1);
  assert.equal(result.summary.createCanonicalBlockedByRequiredProfileFields, 0);
  assert.equal(result.rowsWritten, 0);
  assert.equal(result.changedDb, false);
});

test('deterministic CREATE candidate fails closed if its user_id already belongs to an unlinked canonical user', () => {
  const result = plan({
    d1Users: [{
      user_id: stableId('user', '000001'),
      employee_id: null,
      line_user_id: null,
      display_name: 'Existing unlinked canonical user',
      pickup_floor: '1樓',
      balance: 0,
      role: 'User',
      active: 1
    }]
  });
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(row.plannedAction, ACTIONS.AMBIGUOUS);
  assert.equal(row.targetCanonicalUserId, null);
  assert.ok(row.conflictFlags.includes('DETERMINISTIC_USER_ID_COLLISION'));
  assert.equal(result.summary.counts.CREATE_CANONICAL, 0);
});

test('inactive canonical owner is not an automatic historical merge target', () => {
  const result = plan({
    d1Users: [canonicalUser('000001', { active: 0 })]
  });
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(row.plannedAction, ACTIONS.AMBIGUOUS);
  assert.equal(row.targetCanonicalUserId, null);
  assert.ok(row.conflictFlags.includes('INACTIVE_CANONICAL_OWNER'));
  assert.equal(result.summary.inactiveRetired, 1);
  assert.equal(result.summary.missingCanonical, 0);
});

test('direct-ID current master can create one deterministic canonical target for its history', () => {
  const result = plan({ currentUsers: [currentUser('000001')], facts: historical({ employeeId: '000001' }) });
  const userRow = result.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Users');
  const historyRow = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(userRow.plannedAction, ACTIONS.CREATE_CANONICAL);
  assert.equal(historyRow.targetCanonicalUserId, userRow.targetCanonicalUserId);
  assert.equal(result.summary.counts.CREATE_CANONICAL, 2);
  assert.equal(new Set(result.reconciliationRows.map((row) => row.targetCanonicalUserId).filter(Boolean)).size, 1);
});

test('wallet facts are REVIEW_BALANCE evidence and never ledger mutations', () => {
  const result = plan({
    d1Users: [canonicalUser('000001')],
    facts: historical({ employeeId: '000001', kind: 'wallet' })
  });
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(row.plannedAction, ACTIONS.REVIEW_BALANCE);
  assert.equal(row.mutationPreview.ledgerMutation, false);
  assert.equal(row.mutationPreview.balanceAdjustment, false);
});

test('like facts remain chronological event previews and do not materialize current likes', () => {
  const result = plan({
    d1Users: [canonicalUser('000001')],
    facts: historical({ employeeId: '000001', kind: 'like', eventType: 'heart-outline' })
  });
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(row.mutationPreview.kind, 'HISTORICAL_LIKE_EVENT_PREVIEW');
  assert.equal(row.mutationPreview.currentLikeMaterialization, false);
  assert.equal(row.mutationPreview.eventPolicy, 'CHRONOLOGICAL_RECONCILIATION_REQUIRED');
});

test('same three source inputs produce identical plan rows, summary, and planHash', () => {
  const input = { d1Users: [canonicalUser('000001')], facts: historical({ employeeId: '000001' }) };
  const first = plan(input);
  const second = plan(input);

  assert.equal(first.planHash, second.planHash);
  assert.deepEqual(first.reconciliationRows, second.reconciliationRows);
  assert.deepEqual(first.summary, second.summary);
  assert.equal(first.rowsWritten, 0);
  assert.equal(first.changedDb, false);
  assert.equal(first.dryRunSafety.sqlExecuted, false);
});

test('duplicate D1 owners fail closed for every historical fact', () => {
  const result = plan({
    d1Users: [
      canonicalUser('000001', { user_id: 'canonical-one' }),
      canonicalUser('000001', { user_id: 'canonical-two' })
    ]
  });
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(row.plannedAction, ACTIONS.AMBIGUOUS);
  assert.equal(row.targetCanonicalUserId, null);
  assert.ok(row.conflictFlags.includes('MULTIPLE_CANONICAL_OWNERS'));
});

test('historical normalization collision metadata fails closed instead of merging by normalized value', () => {
  const facts = historical({ employeeId: 'ABC001' });
  facts.normalizationCollisions = [{
    normalizedEmployeeId: 'ABC001',
    rawValues: ['abc001', 'ABC001']
  }];
  const result = plan({
    d1Users: [canonicalUser('ABC001')],
    facts
  });
  const row = result.reconciliationRows.find((item) => item.sourceTable === 'bento_order_status');

  assert.equal(row.plannedAction, ACTIONS.AMBIGUOUS);
  assert.equal(row.targetCanonicalUserId, null);
  assert.ok(row.conflictFlags.includes('NORMALIZED_EMPLOYEE_COLLISION'));
});

test('duplicate historical source references fail closed without a guessed relationship', () => {
  const facts = historical({ employeeId: '000001' });
  facts.historicalOrderFacts.push({ ...facts.historicalOrderFacts[0] });
  const result = plan({
    d1Users: [canonicalUser('000001')],
    facts
  });

  const rows = result.reconciliationRows.filter((item) => item.sourceTable === 'bento_order_status');
  assert.deepEqual(rows.map((row) => row.plannedAction), [ACTIONS.AMBIGUOUS, ACTIONS.AMBIGUOUS]);
  assert.ok(rows.every((row) => row.targetCanonicalUserId === null));
  assert.ok(rows.every((row) => row.conflictFlags.includes('DUPLICATE_HISTORICAL_SOURCE_ROW')));
});
