import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { canonicalizeWorkbook } from '../scripts/lib/workbook-reader.mjs';
import { normalizeLegacyWorkbook } from '../scripts/lib/import-normalizer.mjs';
import { resolveLegacyIdentities } from '../scripts/lib/identity-mapping.mjs';
import {
  ACTIONS,
  buildLegacyReconciliationPlan
} from '../scripts/lib/legacy-reconciliation.mjs';
import { runLegacyReconciliationDryRun } from '../scripts/legacy-reconciliation-dry-run.mjs';

const source = (sheet, row, values) => ({
  ...values,
  source: { sheet, row },
  raw: { ...values }
});

const actualSqlPath = new URL('../../gas/bento_script.sql', import.meta.url);

const emptySheet = (headers = []) => ({ headers, rows: [] });

const makeWorkbook = ({ users = [], orders = [], likes = [], topups = [] } = {}) => ({
  shapeIssues: [],
  sheets: {
    Settings: emptySheet(['order_date', 'vendor', 'mode']),
    Likes: {
      headers: ['Date', 'username', 'LINE_UserID', 'Created_At'],
      rows: likes
    },
    TopupHistory: {
      headers: [
        'Timestamp', 'username', 'LINE_UserID', '姓名', '樓層', '異動金額',
        '結餘', '備註', 'TransactionID', 'Type', 'ReferenceID',
        'OperatorUserID', 'OperatorName'
      ],
      rows: topups
    },
    Users: {
      headers: ['username', 'UserID (LINE ID)', 'DisplayName', '樓層', 'Balance', 'Role'],
      rows: users
    },
    Menu: emptySheet(['date', 'vendor', 'item_id', 'item_name', 'price', 'enabled']),
    Announcements: emptySheet(['id', 'title', 'content', 'start_date', 'end_date', 'enabled']),
    Orders: {
      headers: [
        'order_id', 'order_date', 'vendor', 'name', 'pickup_floor', 'item_id',
        'item_name', 'quantity', 'unit_price', 'subtotal', 'created_at',
        'updated_at', 'status', 'username', 'LINE_UserID', 'BalanceAfter'
      ],
      rows: orders
    }
  }
});

const d1Snapshot = (users = [], existingKeys = {}) => ({
  snapshotVersion: 1,
  users,
  existingKeys: {
    orders: [],
    likes: [],
    balanceLedger: [],
    openingBalanceSnapshots: [],
    ...existingKeys
  }
});

const buildPlan = ({ users = [], orders = [], likes = [], topups = [], d1Users = [], identityMap } = {}) => {
  const workbook = makeWorkbook({ users, orders, likes, topups });
  const normalized = normalizeLegacyWorkbook(workbook, {
    sourceHash: 'fixture-source',
    importerVersion: 'fixture-version'
  });
  const resolved = resolveLegacyIdentities(normalized, { identityMap });
  return buildLegacyReconciliationPlan({
    normalized: resolved,
    d1Snapshot: d1Snapshot(d1Users),
    sourceHash: 'fixture-source',
    importerVersion: 'fixture-version'
  });
};

const legacyUser = (employeeId, overrides = {}) => source('Users', overrides.sourceRow || 2, {
  username: employeeId,
  UserID: overrides.lineUserId || null,
  DisplayName: overrides.displayName || 'Legacy User',
  樓層: overrides.pickupFloor || '1樓',
  Balance: overrides.balance ?? 100,
  Role: overrides.role || 'User',
  ...overrides
});

const canonicalUser = (employeeId, overrides = {}) => ({
  user_id: overrides.user_id || `canonical-${employeeId}`,
  employee_id: employeeId,
  line_user_id: overrides.line_user_id || null,
  display_name: overrides.display_name || 'Legacy User',
  pickup_floor: overrides.pickup_floor || '1樓',
  balance: overrides.balance ?? 100,
  role: overrides.role || 'User',
  active: overrides.active ?? 1
});

const legacyOrder = (employeeId, overrides = {}) => source('Orders', overrides.sourceRow || 2, {
  order_id: overrides.order_id || 'legacy-order-1',
  order_date: '2026-09-08',
  vendor: 'Vendor A',
  name: 'Legacy User',
  pickup_floor: '1樓',
  item_id: 'item-1',
  item_name: 'Bento',
  quantity: 1,
  unit_price: 100,
  subtotal: 100,
  created_at: '2026-09-07T08:00:00.000Z',
  updated_at: '2026-09-07T08:00:00.000Z',
  status: 'ACTIVE',
  username: employeeId,
  LINE_UserID: null,
  BalanceAfter: 0,
  ...overrides
});

test('direct username creates one deterministic non-LINE canonical preview', () => {
  const plan = buildPlan({
    users: [legacyUser(' 000001 ', { lineUserId: 'legacy-line-1', balance: 100 })]
  });
  const row = plan.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Users');

  assert.equal(row.normalizedEmployeeId, '000001');
  assert.equal(row.plannedAction, ACTIONS.CREATE_CANONICAL);
  assert.match(row.targetCanonicalUserId, /^user_/);
  assert.equal(row.mutationPreview.execute, false);
  assert.equal(row.mutationPreview.user.line_user_id, null);
  assert.equal(row.mutationPreview.user.employee_id, '000001');
  assert.equal(plan.summary.counts.CREATE_CANONICAL, 1);
  assert.equal(plan.rowsWritten, 0);
  assert.equal(plan.changedDb, false);
});

test('existing non-LINE and LINE-bound owners classify separately without a second user', () => {
  const plan = buildPlan({
    users: [
      legacyUser('000001', { displayName: 'Renamed Legacy User', sourceRow: 2 }),
      legacyUser('000002', { lineUserId: 'line-2', displayName: 'Line User', sourceRow: 3 })
    ],
    d1Users: [
      canonicalUser('000001'),
      canonicalUser('000002', { user_id: 'canonical-line', line_user_id: 'line-2', display_name: 'Line Canonical User' })
    ]
  });
  const userRows = plan.reconciliationRows.filter((item) => item.legacySourceRow.sheet === 'Users');

  assert.equal(userRows[0].plannedAction, ACTIONS.MERGE_EXISTING_NONLINE);
  assert.equal(userRows[0].targetCanonicalUserId, 'canonical-000001');
  assert.equal(userRows[1].plannedAction, ACTIONS.MERGE_EXISTING_LINE);
  assert.equal(userRows[1].targetCanonicalUserId, 'canonical-line');
  assert.equal(plan.summary.counts.CREATE_CANONICAL, 0);
});

test('fully consistent existing state with no historical link is NO_CHANGE', () => {
  const plan = buildPlan({
    users: [legacyUser('000001')],
    d1Users: [canonicalUser('000001')]
  });
  const row = plan.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Users');

  assert.equal(row.plannedAction, ACTIONS.NO_CHANGE);
  assert.equal(row.mutationPreview, null);
});

test('balance mismatch is REVIEW_BALANCE and never emits an overwrite or ledger mutation', () => {
  const plan = buildPlan({
    users: [legacyUser('000001', { balance: 120 })],
    d1Users: [canonicalUser('000001', { balance: 100 })]
  });
  const row = plan.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Users');

  assert.equal(row.plannedAction, ACTIONS.REVIEW_BALANCE);
  assert.equal(row.existingBalance, 100);
  assert.equal(row.legacyBalance, 120);
  assert.equal(row.mutationPreview.kind, 'REVIEW_ONLY');
  assert.equal(row.mutationPreview.execute, false);
  assert.equal(row.mutationPreview.ledgerMutation, false);
});

test('Legacy privilege escalation is ambiguous and existing authority is preserved', () => {
  const plan = buildPlan({
    users: [legacyUser('000001', { role: 'Admin' })],
    d1Users: [canonicalUser('000001', { role: 'User' })]
  });
  const row = plan.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Users');

  assert.equal(row.plannedAction, ACTIONS.AMBIGUOUS);
  assert.ok(row.conflictFlags.includes('ROLE_ESCALATION_REVIEW'));
  assert.equal(row.mutationPreview, null);
});

test('LINE ownership conflict fails closed and does not guess a target', () => {
  const plan = buildPlan({
    users: [legacyUser('000001', { lineUserId: 'line-owned-by-two' })],
    d1Users: [
      canonicalUser('000001', { line_user_id: 'line-one' }),
      canonicalUser('000002', { user_id: 'canonical-two', line_user_id: 'line-owned-by-two' })
    ]
  });
  const row = plan.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Users');

  assert.equal(row.plannedAction, ACTIONS.AMBIGUOUS);
  assert.equal(row.targetCanonicalUserId, null);
  assert.ok(row.conflictFlags.includes('LINE_OWNERSHIP_CONFLICT'));
});

test('normalized employee collisions fail closed and never create duplicate canonical users', () => {
  const plan = buildPlan({
    users: [
      legacyUser('001', { sourceRow: 2 }),
      legacyUser(' 001 ', { sourceRow: 3 })
    ]
  });
  const rows = plan.reconciliationRows.filter((item) => item.legacySourceRow.sheet === 'Users');

  assert.deepEqual(rows.map((row) => row.plannedAction), [ACTIONS.AMBIGUOUS, ACTIONS.AMBIGUOUS]);
  assert.equal(plan.summary.counts.CREATE_CANONICAL, 0);
  assert.equal(plan.summary.normalizationCollisions, 1);
});

test('name-only and map-only rows remain ambiguous without a direct workbook username', () => {
  const plan = buildPlan({
    users: [legacyUser(null, { username: null, lineUserId: 'legacy-line-1' })],
    identityMap: { bySource: { 'Users:2': '000009' } }
  });
  const row = plan.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Users');

  assert.equal(row.plannedAction, ACTIONS.AMBIGUOUS);
  assert.equal(row.normalizedEmployeeId, null);
  assert.equal(row.targetCanonicalUserId, null);
  assert.ok(row.conflictFlags.includes('EMPLOYEE_ID_REQUIRED'));
});

test('deterministically resolved historical rows preview one canonical target and keep TopupHistory policy-gated', () => {
  const plan = buildPlan({
    users: [legacyUser('000001', { lineUserId: 'line-1' })],
    d1Users: [canonicalUser('000001', { user_id: 'canonical-line', line_user_id: 'line-1' })],
    orders: [legacyOrder('000001')],
    likes: [source('Likes', 2, {
      Date: '2026-09-08', username: '000001', LINE_UserID: 'line-1', Created_At: '2026-09-07T10:00:00Z'
    })],
    topups: [source('TopupHistory', 2, {
      Timestamp: '2026-09-07T09:00:00Z', username: '000001', LINE_UserID: 'line-1',
      姓名: 'Legacy User', 樓層: '1樓', 異動金額: 10, 結餘: 110, TransactionID: 'tx-1',
      Type: 'TOPUP', ReferenceID: 'ref-1', OperatorUserID: null, OperatorName: 'Admin'
    })]
  });
  const order = plan.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Orders');
  const like = plan.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'Likes');
  const topup = plan.reconciliationRows.find((item) => item.legacySourceRow.sheet === 'TopupHistory');

  assert.equal(order.targetCanonicalUserId, 'canonical-line');
  assert.equal(order.mutationPreview.relationship.targetUserId, 'canonical-line');
  assert.equal(order.mutationPreview.relationship.targetTable, 'orders');
  assert.equal(like.mutationPreview.relationship.targetTable, 'likes');
  assert.equal(topup.plannedAction, ACTIONS.REVIEW_BALANCE);
  assert.equal(topup.mutationPreview.ledgerMutation, false);
  assert.equal(plan.summary.unresolvedHistoricalRows, 0);
});

test('known Legacy Orders blank column 13 preserves CANCELLED and unknown shapes fail closed', () => {
  const headers = [
    'order_id', 'order_date', 'vendor', 'name', 'pickup_floor', 'item_id',
    'item_name', 'quantity', 'unit_price', 'subtotal', 'created_at', 'updated_at',
    '', 'LINE_UserID', 'BalanceAfter'
  ];
  const row = [
    'legacy-order-cancelled', '2026-09-08', 'Vendor A', 'Legacy User', '1樓',
    'item-1', 'Bento', 1, 100, 100, '2026-09-07T08:00:00Z',
    '2026-09-07T08:00:00Z', 'CANCELLED', 'line-1', 0
  ];
  const known = canonicalizeWorkbook({ Orders: [headers, row] });
  const knownNormalized = normalizeLegacyWorkbook(known, { sourceHash: 'orders-shape' });
  assert.equal(knownNormalized.Orders[0].status, 'CANCELLED');
  assert.ok(known.shapeIssues.some((issue) => issue.code === 'ORDERS_STATUS_COLUMN_RECOGNIZED'));

  const unknown = canonicalizeWorkbook({
    Orders: [
      [...headers.slice(0, 12), '', 'UnexpectedHeader', 'BalanceAfter'],
      row
    ]
  });
  const unknownNormalized = normalizeLegacyWorkbook(unknown, { sourceHash: 'orders-unknown-shape' });
  assert.notEqual(unknownNormalized.Orders[0].status, 'ACTIVE');
  assert.ok(unknown.shapeIssues.some((issue) => issue.code === 'ORDERS_STATUS_HEADER_AMBIGUOUS'));
});

test('same source and D1 snapshot produce stable rows, planHash, and zero-write safety evidence', () => {
  const input = {
    users: [legacyUser('000001')],
    d1Users: [canonicalUser('000001')],
    orders: [legacyOrder('000001')]
  };
  const first = buildPlan(input);
  const second = buildPlan(input);

  assert.equal(first.planHash, second.planHash);
  assert.deepEqual(first.reconciliationRows, second.reconciliationRows);
  assert.equal(first.rowsWritten, 0);
  assert.equal(first.changedDb, false);
  assert.equal(first.dryRunSafety.remoteMutation, false);
  assert.equal(first.dryRunSafety.productionWriteSqlExecuted, false);
  assert.equal(first.dryRunSafety.mutationPreviewExecutable, false);
});

test('dry-run entrypoint writes only an explicit local report and proves zero database writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bento-legacy-reconciliation-'));
  const inputPath = join(directory, 'legacy.xlsx');
  const outputPath = join(directory, 'reconciliation.json');
  await writeFile(inputPath, 'synthetic workbook bytes', 'utf8');
  try {
    const result = await runLegacyReconciliationDryRun({
      inputPath,
      outputPath,
      adapter: { read: async () => makeWorkbook({ users: [legacyUser('000001')] }) },
      d1Snapshot: d1Snapshot([])
    });
    const report = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(result.writtenPath, outputPath);
    assert.equal(report.rowsWritten, 0);
    assert.equal(report.changedDb, false);
    assert.equal(report.dryRunSafety.remoteMutation, false);
    assert.equal(report.dryRunSafety.mutationPreviewExecutable, false);
    assert.equal(report.summary.counts.CREATE_CANONICAL, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('two-source dry-run entrypoint parses the local SQL history and keeps it zero-write', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bento-two-source-reconciliation-'));
  const inputPath = join(directory, 'current.xlsx');
  const outputPath = join(directory, 'reconciliation.json');
  await writeFile(inputPath, 'synthetic workbook bytes', 'utf8');
  try {
    const result = await runLegacyReconciliationDryRun({
      inputPath,
      sqlDumpPath: actualSqlPath,
      outputPath,
      adapter: { read: async () => makeWorkbook() },
      d1Snapshot: d1Snapshot([])
    });
    assert.equal(result.summary.totalSqlHistoricalIdentities, 49);
    assert.equal(result.summary.historicalOrderFactCount, 5825);
    assert.equal(result.summary.historicalLikeFactCount, 543);
    assert.equal(result.summary.historicalWalletFactCount, 1177);
    assert.equal(result.rowsWritten, 0);
    assert.equal(result.changedDb, false);
    assert.equal(result.dryRunSafety.sqlExecuted, false);
    assert.equal(result.dryRunSafety.remoteD1Accessed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
