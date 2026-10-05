const fail = (message) => { throw new TypeError(message); };
const requiredText = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} is required`);
  return value.trim();
};
const nullableText = (value, name) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') fail(`${name} must be text or null`);
  return value.trim() || null;
};
const integer = (value, name) => {
  if (!Number.isSafeInteger(value)) fail(`${name} must be a safe integer`);
  return value;
};
const statement = (sql, params, kind = 'mutation') => Object.freeze({
  sql: sql.trim(), params: Object.freeze(params), kind
});
const assertExists = (predicate, params, ownerId, occurredAt) => statement(`
  INSERT INTO employee_guest_sessions(session_id, token_hash, user_id, expires_at)
  SELECT '__canonical_identity_repair_assert__', NULL, ?, ?
  WHERE NOT EXISTS (${predicate})
`, [ownerId, occurredAt, ...params]);

const exactOrders = Object.freeze([
  { orderDate: '2026-10-06', totalAmount: 100, initialBalanceAfter: -100 },
  { orderDate: '2026-10-07', totalAmount: 100, initialBalanceAfter: -200 }
]);

const validate = (input) => {
  if (!input || typeof input !== 'object') fail('repair input is required');
  if (input.state === 'already-applied') return null;

  const values = {
    employeeId: requiredText(input.employeeId, 'employeeId'),
    lineUserId: requiredText(input.lineUserId, 'lineUserId'),
    canonicalUserId: requiredText(input.canonicalUserId, 'canonicalUserId'),
    sourceUserId: requiredText(input.sourceUserId, 'sourceUserId'),
    sourceEmployeeId: requiredText(input.sourceEmployeeId, 'sourceEmployeeId'),
    sourceDisplayName: requiredText(input.sourceDisplayName, 'sourceDisplayName'),
    displayName: requiredText(input.displayName, 'displayName'),
    canonicalCurrentDisplayName: requiredText(input.canonicalCurrentDisplayName, 'canonicalCurrentDisplayName'),
    canonicalUpdatedAt: requiredText(input.canonicalUpdatedAt, 'canonicalUpdatedAt'),
    sourceUpdatedAt: requiredText(input.sourceUpdatedAt, 'sourceUpdatedAt'),
    operatorUpdatedAt: requiredText(input.operatorUpdatedAt, 'operatorUpdatedAt'),
    operatorVerificationStatus: requiredText(input.operatorVerificationStatus, 'operatorVerificationStatus'),
    operatorUserId: requiredText(input.operatorUserId, 'operatorUserId'),
    operatorEmployeeId: nullableText(input.operatorEmployeeId, 'operatorEmployeeId'),
    operatorLineUserId: nullableText(input.operatorLineUserId, 'operatorLineUserId'),
    operatorDisplayName: requiredText(input.operatorDisplayName, 'operatorDisplayName'),
    occurredAt: requiredText(input.occurredAt, 'occurredAt'),
    auditId: requiredText(input.auditId, 'auditId')
  };
  if (values.canonicalUserId === values.sourceUserId) fail('canonical and source user IDs must be distinct');
  if (values.employeeId === values.sourceEmployeeId) fail('canonical and source employee IDs must be different');
  if (values.operatorUserId === values.sourceUserId || values.operatorUserId === values.canonicalUserId) {
    fail('operator must be a separate user');
  }
  if (Number.isNaN(Date.parse(values.occurredAt))) fail('occurredAt must be a valid timestamp');
  integer(input.sourceMirrorBalance, 'sourceMirrorBalance');
  integer(input.sourceLatestSequence, 'sourceLatestSequence');
  integer(input.globalLatestSequence, 'globalLatestSequence');
  integer(input.canonicalBalance, 'canonicalBalance');
  integer(input.canonicalLatestBalance, 'canonicalLatestBalance');
  integer(input.canonicalLedgerCount, 'canonicalLedgerCount');
  if (input.canonicalLedgerCount < 0) fail('canonicalLedgerCount cannot be negative');
  integer(input.canonicalLatestSequence, 'canonicalLatestSequence');
  if (input.sourceMirrorBalance !== -200 || input.canonicalLatestBalance !== input.canonicalBalance) {
    fail('frozen account balances do not match the approved ledger state');
  }

  if (!Array.isArray(input.refunds) || input.refunds.length !== 2) fail('exactly two refund orders are required');
  const refunds = input.refunds.map((refund, index) => {
    const expectedOrder = exactOrders[index];
    if (!refund || typeof refund !== 'object') fail(`refund ${index + 1} is required`);
    const result = {
      orderId: requiredText(refund.orderId, `refund ${index + 1} orderId`),
      orderDate: requiredText(refund.orderDate, `refund ${index + 1} orderDate`),
      debitTransactionId: requiredText(refund.debitTransactionId, `refund ${index + 1} debitTransactionId`),
      debitSequenceNumber: integer(refund.debitSequenceNumber, `refund ${index + 1} debitSequenceNumber`),
      debitBalanceAfter: integer(refund.debitBalanceAfter, `refund ${index + 1} debitBalanceAfter`),
      transactionId: requiredText(refund.transactionId, `refund ${index + 1} transactionId`),
      transitionId: requiredText(refund.transitionId, `refund ${index + 1} transitionId`)
    };
    if (result.orderDate !== expectedOrder.orderDate) fail('refund orders must be the approved October 6 and 7 dates in order');
    if (result.debitBalanceAfter !== expectedOrder.initialBalanceAfter) fail('order debit balances do not match the approved frozen state');
    return { ...result, totalAmount: expectedOrder.totalAmount };
  });
  const uniqueIds = [
    ...refunds.flatMap((refund) => [refund.orderId, refund.debitTransactionId, refund.transactionId, refund.transitionId]),
    values.auditId
  ];
  if (new Set(uniqueIds).size !== uniqueIds.length) fail('repair and order identifiers must be unique');

  if (!Array.isArray(input.preservedOrders) || input.preservedOrders.length !== 2) {
    fail('exactly two canonical orders must be frozen for retention');
  }
  const preservedOrders = input.preservedOrders.map((order, index) => {
    const expectedOrder = exactOrders[index];
    const result = {
      orderId: requiredText(order.orderId, `preserved order ${index + 1} orderId`),
      orderDate: requiredText(order.orderDate, `preserved order ${index + 1} orderDate`),
      debitTransactionId: requiredText(order.debitTransactionId, `preserved order ${index + 1} debitTransactionId`),
      debitSequenceNumber: integer(order.debitSequenceNumber, `preserved order ${index + 1} debitSequenceNumber`),
      debitBalanceAfter: integer(order.debitBalanceAfter, `preserved order ${index + 1} debitBalanceAfter`)
    };
    if (result.orderDate !== expectedOrder.orderDate) {
      fail('canonical retained orders do not match their frozen ledger state');
    }
    return result;
  });

  const guestSessionIds = input.guestSessionIds;
  if (!Array.isArray(guestSessionIds) || guestSessionIds.some((id) => typeof id !== 'string' || !id.trim())) {
    fail('guestSessionIds must be an array of non-empty IDs');
  }
  if (new Set(guestSessionIds).size !== guestSessionIds.length) fail('guestSessionIds must be unique');
  return { ...values, sourceMirrorBalance: input.sourceMirrorBalance,
    sourceLatestSequence: input.sourceLatestSequence,
    globalLatestSequence: input.globalLatestSequence,
    canonicalBalance: input.canonicalBalance, canonicalLedgerCount: input.canonicalLedgerCount,
    canonicalLatestBalance: input.canonicalLatestBalance,
    canonicalLatestSequence: input.canonicalLatestSequence,
    refunds, preservedOrders, guestSessionIds: [...guestSessionIds] };
};

const guardStatement = (selectSql, params, input) => statement(`
  INSERT INTO employee_guest_sessions(session_id, token_hash, user_id, expires_at)
  SELECT '__canonical_identity_repair_guard__', NULL, ?, ?
  WHERE NOT EXISTS (${selectSql})
`, [input.sourceUserId, input.occurredAt, ...params], 'precondition');

const guardStatements = (input) => {
  const orderDates = input.refunds.map(({ orderDate }) => orderDate);
  const orderIds = input.refunds.map(({ orderId }) => orderId);
  const preservedIds = input.preservedOrders.map(({ orderId }) => orderId);
  const sessionMismatch = input.guestSessionIds.length
    ? `AND NOT EXISTS (
        SELECT 1 FROM employee_guest_sessions egs
        WHERE (egs.user_id = source.user_id OR egs.employee_id = source.employee_id)
          AND egs.revoked_at IS NULL AND egs.session_id NOT IN (${input.guestSessionIds.map(() => '?').join(', ')})
      )`
    : '';
  const sessionMismatchParams = input.guestSessionIds;

  const identity = guardStatement(`
    SELECT 1 FROM users canonical
    JOIN users source ON source.user_id = ?
    JOIN users actor ON actor.user_id = ?
    WHERE canonical.user_id = ? AND canonical.employee_id = ?
      AND canonical.line_user_id IS NULL AND canonical.display_name = ?
      AND canonical.active = 1 AND canonical.role = 'User' AND canonical.balance = ?
      AND canonical.updated_at = ?
      AND source.employee_id = ? AND source.line_user_id = ?
      AND source.display_name = ? AND source.active = 1 AND source.role = 'User'
      AND actor.role = 'Admin' AND actor.active = 1 AND actor.employee_id IS ?
      AND actor.line_user_id IS ? AND actor.display_name = ? AND actor.updated_at = ?
      AND actor.verification_status = ?
      AND (SELECT COUNT(*) FROM users WHERE line_user_id = ?) = 1
      AND NOT EXISTS (SELECT 1 FROM users other WHERE other.employee_id = ?
        AND other.user_id NOT IN (?, ?))
      AND NOT EXISTS (SELECT 1 FROM users other WHERE other.employee_id = source.employee_id
        AND other.user_id <> source.user_id)
  `, [input.sourceUserId, input.operatorUserId, input.canonicalUserId, input.employeeId,
    input.canonicalCurrentDisplayName, input.canonicalBalance, input.canonicalUpdatedAt,
    input.sourceEmployeeId, input.lineUserId, input.sourceDisplayName,
    input.operatorEmployeeId, input.operatorLineUserId, input.operatorDisplayName,
    input.operatorUpdatedAt, input.operatorVerificationStatus, input.lineUserId,
    input.employeeId, input.canonicalUserId, input.sourceUserId], input);

  const canonicalLedgerRows = input.preservedOrders.flatMap(({ debitTransactionId, orderId, debitSequenceNumber, debitBalanceAfter }) => [
    debitTransactionId, orderId, debitSequenceNumber, debitBalanceAfter
  ]);
  const canonical = guardStatement(`
    SELECT 1 FROM users canonical
    WHERE canonical.user_id = ? AND canonical.employee_id = ?
      AND canonical.line_user_id IS NULL AND canonical.display_name = ?
      AND canonical.active = 1 AND canonical.role = 'User' AND canonical.balance = ?
      AND canonical.updated_at = ?
      AND (SELECT COUNT(*) FROM balance_ledger WHERE user_id = canonical.user_id) = ?
      AND (SELECT balance_after FROM balance_ledger bl
        JOIN balance_ledger_sequence bls USING(transaction_id) WHERE bl.user_id = canonical.user_id
        ORDER BY bls.sequence_number DESC LIMIT 1) IS ?
      AND (SELECT MAX(bls.sequence_number) FROM balance_ledger bl
        JOIN balance_ledger_sequence bls USING(transaction_id) WHERE bl.user_id = canonical.user_id) IS ?
      AND (SELECT COUNT(*) FROM orders WHERE user_id = canonical.user_id AND status = 'ACTIVE'
        AND order_date IN (?, ?)) = 2
      AND NOT EXISTS (SELECT 1 FROM orders WHERE user_id = canonical.user_id
        AND status = 'ACTIVE' AND order_date IN (?, ?) AND order_id NOT IN (?, ?))
      AND NOT EXISTS (
        SELECT 1 FROM (SELECT ? AS order_id, ? AS order_date UNION ALL SELECT ?, ?)
          expected_order LEFT JOIN orders o ON o.order_id = expected_order.order_id
        WHERE o.user_id IS NOT canonical.user_id OR o.status IS NOT 'ACTIVE'
          OR o.order_date IS NOT expected_order.order_date OR o.total_amount IS NOT 100
      )
      AND NOT EXISTS (
        SELECT 1 FROM (SELECT ? AS transaction_id, ? AS reference_id, ? AS sequence_number, ? AS balance_after
          UNION ALL SELECT ?, ?, ?, ?) expected
        LEFT JOIN balance_ledger bl ON bl.transaction_id = expected.transaction_id
        LEFT JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
        WHERE bl.user_id IS NOT canonical.user_id OR bl.type IS NOT 'ORDER'
          OR bl.amount IS NOT -100 OR bl.reference_id IS NOT expected.reference_id
          OR bl.balance_after IS NOT expected.balance_after OR bls.sequence_number IS NOT expected.sequence_number
      )
  `, [input.canonicalUserId, input.employeeId, input.canonicalCurrentDisplayName,
    input.canonicalBalance, input.canonicalUpdatedAt, input.canonicalLedgerCount,
    input.canonicalLatestBalance, input.canonicalLatestSequence,
    ...orderDates, ...orderDates, ...preservedIds,
    ...input.preservedOrders.flatMap(({ orderId, orderDate }) => [orderId, orderDate]),
    ...canonicalLedgerRows], input);

  const sourceOrders = guardStatement(`
    SELECT 1 FROM users source
    WHERE source.user_id = ? AND source.employee_id = ? AND source.line_user_id = ?
      AND source.display_name = ? AND source.active = 1 AND source.role = 'User'
      AND source.balance = ? AND source.updated_at = ?
      AND (SELECT COUNT(*) FROM orders WHERE user_id = source.user_id) = 2
      AND (SELECT COUNT(*) FROM orders WHERE user_id = source.user_id AND status = 'ACTIVE') = 2
      AND (SELECT COUNT(*) FROM orders WHERE user_id = source.user_id AND status = 'ACTIVE'
        AND order_date IN (?, ?) AND total_amount = 100 AND created_by_user_id = source.user_id
        AND created_auth_mode = 'line' AND employee_id_snapshot = source.employee_id
        AND line_user_id_snapshot = source.line_user_id
        AND display_name_snapshot = source.display_name) = 2
      AND NOT EXISTS (SELECT 1 FROM orders WHERE user_id = source.user_id AND status = 'ACTIVE'
        AND (order_id NOT IN (?, ?) OR order_date NOT IN (?, ?) OR total_amount <> 100))
      AND NOT EXISTS (
        SELECT 1 FROM (SELECT ? AS order_id, ? AS order_date UNION ALL SELECT ?, ?) expected_order
        LEFT JOIN orders o ON o.order_id = expected_order.order_id
        WHERE o.user_id IS NOT source.user_id OR o.status IS NOT 'ACTIVE'
          OR o.total_amount IS NOT 100 OR o.order_date IS NOT expected_order.order_date
          OR o.created_by_user_id IS NOT source.user_id OR o.created_auth_mode IS NOT 'line'
          OR o.employee_id_snapshot IS NOT source.employee_id
          OR o.line_user_id_snapshot IS NOT source.line_user_id
          OR o.display_name_snapshot IS NOT source.display_name
      )
  `, [input.sourceUserId, input.sourceEmployeeId, input.lineUserId, input.sourceDisplayName,
    input.sourceMirrorBalance, input.sourceUpdatedAt, ...orderDates,
    ...orderIds, ...orderDates,
    ...input.refunds.flatMap(({ orderId, orderDate }) => [orderId, orderDate])], input);

  const sourceDebitRows = input.refunds.flatMap(({ debitTransactionId, orderId, debitSequenceNumber, debitBalanceAfter }) => [
    debitTransactionId, orderId, debitSequenceNumber, debitBalanceAfter
  ]);
  const refundIds = input.refunds.map(({ transactionId }) => transactionId);
  const transitionIds = input.refunds.map(({ transitionId }) => transitionId);
  const sourceLedger = guardStatement(`
    SELECT 1 FROM users source
    WHERE source.user_id = ?
      AND (SELECT COUNT(*) FROM balance_ledger WHERE user_id = source.user_id) = 2
      AND NOT EXISTS (
        SELECT 1 FROM (SELECT ? AS transaction_id, ? AS reference_id, ? AS sequence_number, ? AS balance_after
          UNION ALL SELECT ?, ?, ?, ?) expected
        LEFT JOIN balance_ledger bl ON bl.transaction_id = expected.transaction_id
        LEFT JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
        WHERE bl.user_id IS NOT source.user_id OR bl.type IS NOT 'ORDER'
          OR bl.amount IS NOT -100 OR bl.reference_id IS NOT expected.reference_id
          OR bl.balance_after IS NOT expected.balance_after OR bls.sequence_number IS NOT expected.sequence_number
      )
      AND NOT EXISTS (SELECT 1 FROM balance_ledger bl WHERE bl.user_id = source.user_id AND bl.type <> 'ORDER')
      AND (SELECT balance_after FROM balance_ledger bl JOIN balance_ledger_sequence bls USING(transaction_id)
        WHERE bl.user_id = source.user_id ORDER BY bls.sequence_number DESC LIMIT 1) IS -200
      AND (SELECT MAX(bls.sequence_number) FROM balance_ledger bl
        JOIN balance_ledger_sequence bls USING(transaction_id) WHERE bl.user_id = source.user_id) IS ?
      AND (SELECT MAX(sequence_number) FROM balance_ledger_sequence) IS ?
      AND NOT EXISTS (SELECT 1 FROM balance_ledger WHERE type = 'REFUND' AND reference_id IN (?, ?))
      AND NOT EXISTS (SELECT 1 FROM balance_ledger WHERE transaction_id IN (?, ?))
      AND NOT EXISTS (SELECT 1 FROM order_status_history WHERE transition_id IN (?, ?))
      AND NOT EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_id = ?)
  `, [input.sourceUserId, ...sourceDebitRows, input.sourceLatestSequence,
    input.globalLatestSequence, ...orderIds, ...refundIds, ...transitionIds, input.auditId], input);

  const sessionsAndDependencies = guardStatement(`
    SELECT 1 FROM users source
    WHERE source.user_id = ?
      AND (SELECT COUNT(*) FROM employee_guest_sessions
        WHERE (user_id = source.user_id OR employee_id = source.employee_id) AND revoked_at IS NULL) = ?
      ${sessionMismatch}
      AND NOT EXISTS (SELECT 1 FROM opening_balance_snapshots WHERE user_id = source.user_id)
      AND NOT EXISTS (SELECT 1 FROM idempotency_keys
        WHERE actor_user_id = source.user_id AND status = 'IN_PROGRESS')
  `, [input.sourceUserId, input.guestSessionIds.length, ...sessionMismatchParams], input);

  const guards = [identity, canonical, sourceOrders, sourceLedger, sessionsAndDependencies];
  for (const guard of guards) {
    const expressionTerms = (guard.sql.match(/\b(?:AND|OR)\b/gi) || []).length;
    const nestingDepth = maxParenthesisDepth(guard.sql);
    if (expressionTerms + nestingDepth > 40 || guard.params.length > 80) {
      fail('repair precondition exceeds the supported SQL expression budget');
    }
  }
  return guards;
};

const maxParenthesisDepth = (sql) => {
  let depth = 0;
  let maxDepth = 0;
  let quote = null;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote) {
      if (char === quote && sql[index + 1] === quote) { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') { depth += 1; maxDepth = Math.max(maxDepth, depth); }
    if (char === ')') depth -= 1;
  }
  return maxDepth;
};

const balanceAndRefund = (input, refund, index) => {
  const expectedBefore = input.sourceMirrorBalance + index * 100;
  return [
    statement(`
      UPDATE users SET balance = balance + 100, updated_at = ?
      WHERE user_id = ? AND active = 1 AND balance = ?
    `, [input.occurredAt, input.sourceUserId, expectedBefore]),
    statement(`
      INSERT INTO balance_ledger (
        transaction_id, user_id, employee_id_snapshot, line_user_id_snapshot,
        display_name_snapshot, amount, balance_after, type, reference_id,
        operator_user_id, operator_employee_id_snapshot, operator_line_user_id_snapshot,
        operator_display_name_snapshot, operator_auth_mode, auth_mode, note, occurred_at
      )
      SELECT ?, source.user_id, source.employee_id, source.line_user_id,
             source.display_name, 100, ?, 'REFUND', ?, ?, ?, ?, ?,
             'legacy_import', 'legacy_import', 'ORDER_CANCELLED', ?
      FROM users source
      JOIN orders o ON o.order_id = ? AND o.user_id = source.user_id
      WHERE source.user_id = ? AND source.balance = ? AND o.status = 'ACTIVE'
        AND o.total_amount = 100 AND o.order_date = ?
    `, [refund.transactionId, expectedBefore + 100, refund.orderId,
      input.operatorUserId, input.operatorEmployeeId, input.operatorLineUserId,
      input.operatorDisplayName, input.occurredAt, refund.orderId, input.sourceUserId,
      expectedBefore + 100, refund.orderDate])
  ];
};

const cancelOrder = (input, refund) => [
  statement(`
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_user_id,
      actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
      display_name_snapshot, reason, metadata_json, occurred_at
    )
    SELECT ?, o.order_id, 'ACTIVE', 'CANCELLED', ?, 'legacy_import',
           actor.employee_id, actor.line_user_id, actor.display_name,
           'ORDER_CANCELLED', '{"repair":"canonical-identity-split"}', ?
    FROM orders o JOIN users actor ON actor.user_id = ?
    WHERE o.order_id = ? AND o.user_id = ? AND o.status = 'ACTIVE'
      AND o.total_amount = 100 AND o.order_date = ?
      AND EXISTS (SELECT 1 FROM balance_ledger WHERE transaction_id = ? AND type = 'REFUND' AND reference_id = o.order_id)
  `, [refund.transitionId, input.operatorUserId, input.occurredAt,
    input.operatorUserId, refund.orderId, input.sourceUserId, refund.orderDate, refund.transactionId]),
  statement(`
    UPDATE orders
    SET status = 'CANCELLED', cancelled_by_user_id = ?,
        cancelled_auth_mode = 'legacy_import', updated_at = ?
    WHERE order_id = ? AND user_id = ? AND status = 'ACTIVE' AND total_amount = 100 AND order_date = ?
      AND EXISTS (SELECT 1 FROM balance_ledger WHERE type = 'REFUND' AND reference_id = orders.order_id)
  `, [input.operatorUserId, input.occurredAt, refund.orderId, input.sourceUserId, refund.orderDate])
];

const auditMetadataFor = (values) => JSON.stringify({
  repair: 'canonical_identity_split',
  canonicalUserId: values.canonicalUserId,
  canonicalEmployeeId: values.employeeId,
  sourceUserId: values.sourceUserId,
  sourceEmployeeIdReserved: values.sourceEmployeeId,
  transferredLineUserId: values.lineUserId,
  retainedOrderIds: values.preservedOrders.map(({ orderId }) => orderId),
  cancelledOrderIds: values.refunds.map(({ orderId }) => orderId),
  refundTransactionIds: values.refunds.map(({ transactionId }) => transactionId),
  refundAmountEach: 100,
  totalRefunded: 200,
  sourceBalanceBefore: values.sourceMirrorBalance,
  sourceBalanceAfter: 0,
  canonicalBalancePreserved: values.canonicalBalance,
  sourceLedgerLatestSequenceBefore: values.sourceLatestSequence,
  globalLedgerLatestSequenceBefore: values.globalLatestSequence
});

export const buildCanonicalIdentityRepairPlan = (input) => {
  const values = validate(input);
  if (input?.state === 'already-applied') {
    fail('already-applied replay must be verified with the read-only postcondition query');
  }
  const statements = [...guardStatements(values)];
  for (const [index, refund] of values.refunds.entries()) {
    const [balanceUpdate, refundInsert] = balanceAndRefund(values, refund, index);
    statements.push(balanceUpdate);
    statements.push(assertExists(
      'SELECT 1 FROM users WHERE user_id = ? AND balance = ?',
      [values.sourceUserId, values.sourceMirrorBalance + (index + 1) * 100],
      values.sourceUserId, values.occurredAt
    ));
    statements.push(refundInsert);
    statements.push(assertExists(
      `SELECT 1 FROM balance_ledger bl JOIN balance_ledger_sequence bls USING(transaction_id)
         WHERE bl.transaction_id = ? AND bl.user_id = ? AND bl.type = 'REFUND'
           AND bl.amount = 100 AND bl.balance_after = ? AND bl.reference_id = ?
           AND bl.auth_mode = 'legacy_import' AND bl.operator_user_id = ?
           AND bl.operator_auth_mode = 'legacy_import'
           AND bls.sequence_number = ?`,
      [refund.transactionId, values.sourceUserId, values.sourceMirrorBalance + (index + 1) * 100,
        refund.orderId, values.operatorUserId, values.globalLatestSequence + index + 1],
      values.sourceUserId, values.occurredAt
    ));
    const [historyInsert, cancelUpdate] = cancelOrder(values, refund);
    statements.push(historyInsert, cancelUpdate);
    statements.push(assertExists(
      `SELECT 1 FROM orders o JOIN order_status_history h ON h.order_id = o.order_id
         WHERE o.order_id = ? AND o.user_id = ? AND o.status = 'CANCELLED'
           AND o.cancelled_by_user_id = ? AND o.cancelled_auth_mode = 'legacy_import'
           AND h.transition_id = ? AND h.to_status = 'CANCELLED'`,
      [refund.orderId, values.sourceUserId, values.operatorUserId, refund.transitionId],
      values.sourceUserId, values.occurredAt
    ));
  }
  const auditMetadataJson = auditMetadataFor(values);
  statements.push(statement(`
    UPDATE employee_guest_sessions
    SET revoked_at = ?, revoked_reason = 'admin_revoke'
    WHERE (user_id = ? OR employee_id = ?) AND revoked_at IS NULL
  `, [values.occurredAt, values.sourceUserId, values.sourceEmployeeId]));
  statements.push(assertExists(
    `SELECT 1 WHERE NOT EXISTS (
      SELECT 1 FROM employee_guest_sessions
      WHERE (user_id = ? OR employee_id = ?) AND revoked_at IS NULL
    )`,
    [values.sourceUserId, values.sourceEmployeeId], values.sourceUserId, values.occurredAt
  ));
  statements.push(statement(`
    UPDATE users
    SET active = 0, line_user_id = NULL, balance = 0, updated_at = ?
    WHERE user_id = ? AND employee_id = ? AND line_user_id = ? AND active = 1 AND balance = 0
  `, [values.occurredAt, values.sourceUserId, values.sourceEmployeeId, values.lineUserId]));
  statements.push(assertExists(
    `SELECT 1 FROM users WHERE user_id = ? AND employee_id = ? AND line_user_id IS NULL
      AND active = 0 AND balance = 0`,
    [values.sourceUserId, values.sourceEmployeeId], values.sourceUserId, values.occurredAt
  ));
  statements.push(statement(`
    UPDATE users
    SET line_user_id = ?, display_name = ?, updated_at = ?
    WHERE user_id = ? AND employee_id = ? AND line_user_id IS NULL AND active = 1
  `, [values.lineUserId, values.displayName, values.occurredAt,
    values.canonicalUserId, values.employeeId]));
  statements.push(assertExists(
    `SELECT 1 FROM users WHERE user_id = ? AND employee_id = ? AND line_user_id = ?
       AND display_name = ? AND active = 1 AND balance = ? AND updated_at = ?`,
    [values.canonicalUserId, values.employeeId, values.lineUserId, values.displayName,
      values.canonicalBalance, values.occurredAt], values.sourceUserId, values.occurredAt
  ));
  statements.push(statement(`
    INSERT INTO admin_audit_log (
      audit_id, actor_user_id, actor_auth_mode, actor_employee_id_snapshot,
      actor_line_user_id_snapshot, target_user_id, target_employee_id_snapshot,
      target_line_user_id_snapshot, action, metadata_json, occurred_at
    )
    SELECT ?, actor.user_id, 'legacy_import', actor.employee_id, actor.line_user_id,
           source.user_id, source.employee_id, source.line_user_id,
           'CANONICAL_IDENTITY_SPLIT_REPAIRED',
           ?, ?
    FROM users actor JOIN users source ON source.user_id = ?
    WHERE actor.user_id = ? AND source.active = 0 AND source.balance = 0
      AND source.line_user_id IS NULL
      AND EXISTS (SELECT 1 FROM users canonical WHERE canonical.user_id = ? AND canonical.line_user_id = ?)
  `, [values.auditId, auditMetadataJson, values.occurredAt, values.sourceUserId,
    values.operatorUserId, values.canonicalUserId, values.lineUserId]));
  statements.push(assertExists(
    `SELECT 1 FROM admin_audit_log WHERE audit_id = ? AND action = 'CANONICAL_IDENTITY_SPLIT_REPAIRED'
      AND actor_user_id = ? AND target_user_id = ?`,
    [values.auditId, values.operatorUserId, values.sourceUserId], values.sourceUserId, values.occurredAt
  ));
  return Object.freeze({ status: 'ready', statements: Object.freeze(statements) });
};

export const bindCanonicalIdentityRepairPlan = (database, plan) => {
  if (!plan || !Array.isArray(plan.statements)) fail('repair plan is required');
  if (plan.status === 'already-applied' && plan.statements.length === 0) return [];
  return plan.statements.map(({ sql, params }) => database.prepare(sql).bind(...params));
};

export const buildCanonicalIdentityRepairPostconditionQuery = (input) => {
  const values = validate({ ...input, state: undefined });
  const conditions = [];
  const params = [];
  const require = (sql, valuesToBind) => { conditions.push(`(${sql})`); params.push(...valuesToBind); };
  require(`EXISTS (SELECT 1 FROM users WHERE user_id = ? AND employee_id = ?
    AND line_user_id = ? AND display_name = ? AND active = 1 AND balance = ? AND updated_at = ?)`,
  [values.canonicalUserId, values.employeeId, values.lineUserId, values.displayName,
    values.canonicalBalance, values.occurredAt]);
  require(`(SELECT COUNT(*) FROM balance_ledger WHERE user_id = ?) = ?
    AND (SELECT balance_after FROM balance_ledger bl JOIN balance_ledger_sequence bls USING(transaction_id)
      WHERE bl.user_id = ? ORDER BY bls.sequence_number DESC LIMIT 1) IS ?
    AND (SELECT MAX(bls.sequence_number) FROM balance_ledger bl
      JOIN balance_ledger_sequence bls USING(transaction_id) WHERE bl.user_id = ?) IS ?`,
  [values.canonicalUserId, values.canonicalLedgerCount, values.canonicalUserId,
    values.canonicalLatestBalance, values.canonicalUserId, values.canonicalLatestSequence]);
  require(`EXISTS (SELECT 1 FROM users WHERE user_id = ? AND employee_id = ?
    AND line_user_id IS NULL AND display_name = ? AND active = 0 AND balance = 0
    AND updated_at = ?)`,
  [values.sourceUserId, values.sourceEmployeeId, values.sourceDisplayName, values.occurredAt]);
  require(`(SELECT COUNT(*) FROM balance_ledger WHERE user_id = ?) = 4
    AND (SELECT balance_after FROM balance_ledger bl JOIN balance_ledger_sequence bls USING(transaction_id)
      WHERE bl.user_id = ? ORDER BY bls.sequence_number DESC LIMIT 1) IS 0
    AND (SELECT MAX(bls.sequence_number) FROM balance_ledger bl
      JOIN balance_ledger_sequence bls USING(transaction_id) WHERE bl.user_id = ?) IS ?`,
  [values.sourceUserId, values.sourceUserId, values.sourceUserId, values.globalLatestSequence + 2]);
  for (const [index, refund] of values.refunds.entries()) {
    const starting = values.sourceMirrorBalance + (index + 1) * 100;
    require(`EXISTS (SELECT 1 FROM balance_ledger bl JOIN balance_ledger_sequence bls USING(transaction_id)
      WHERE bl.transaction_id = ? AND bl.user_id = ? AND bl.type = 'REFUND'
        AND bl.amount = 100 AND bl.balance_after = ? AND bl.reference_id = ?
        AND bl.auth_mode = 'legacy_import' AND bl.operator_user_id = ?
        AND bl.operator_auth_mode = 'legacy_import' AND bls.sequence_number = ?)`,
    [refund.transactionId, values.sourceUserId, starting, refund.orderId,
      values.operatorUserId, values.globalLatestSequence + index + 1]);
    require(`EXISTS (SELECT 1 FROM orders WHERE order_id = ? AND user_id = ?
      AND order_date = ? AND total_amount = 100 AND status = 'CANCELLED'
      AND cancelled_by_user_id = ? AND cancelled_auth_mode = 'legacy_import')`,
    [refund.orderId, values.sourceUserId, refund.orderDate, values.operatorUserId]);
    require(`EXISTS (SELECT 1 FROM order_status_history WHERE transition_id = ?
      AND order_id = ? AND from_status = 'ACTIVE' AND to_status = 'CANCELLED'
      AND actor_user_id = ? AND actor_auth_mode = 'legacy_import')`,
    [refund.transitionId, refund.orderId, values.operatorUserId]);
  }
  for (const order of values.preservedOrders) {
    require(`EXISTS (SELECT 1 FROM orders WHERE order_id = ? AND user_id = ?
      AND order_date = ? AND total_amount = 100 AND status = 'ACTIVE')`,
    [order.orderId, values.canonicalUserId, order.orderDate]);
    require(`EXISTS (SELECT 1 FROM balance_ledger bl JOIN balance_ledger_sequence bls USING(transaction_id)
      WHERE bl.transaction_id = ? AND bl.user_id = ? AND bl.type = 'ORDER' AND bl.amount = -100
        AND bl.balance_after = ? AND bl.reference_id = ? AND bls.sequence_number = ?)`,
    [order.debitTransactionId, values.canonicalUserId, order.debitBalanceAfter,
      order.orderId, order.debitSequenceNumber]);
  }
  require(`(SELECT COUNT(*) FROM employee_guest_sessions
      WHERE (user_id = ? OR employee_id = ?) AND revoked_at IS NULL) = 0`,
  [values.sourceUserId, values.sourceEmployeeId]);
  require(`EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_id = ?
    AND action = 'CANONICAL_IDENTITY_SPLIT_REPAIRED' AND actor_user_id = ?
    AND target_user_id = ? AND metadata_json = ?)`,
  [values.auditId, values.operatorUserId, values.sourceUserId, auditMetadataFor(values)]);
  return statement(`SELECT CASE WHEN ${conditions.join(' AND ')} THEN 1 ELSE 0 END AS is_applied`, params);
};
