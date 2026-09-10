const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const asNumberOrNull = (value) => (
  value === null || value === undefined ? null : Number(value)
);

export const reconcileBalances = async (database) => {
  const result = await database.prepare(`
    SELECT u.user_id, u.employee_id, u.line_user_id, u.display_name, u.balance,
      (
        SELECT bl.balance_after
        FROM balance_ledger bl
        JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
        WHERE bl.user_id = u.user_id
        ORDER BY bls.sequence_number DESC
        LIMIT 1
      ) AS latest_ledger_balance,
      (
        SELECT bl.transaction_id
        FROM balance_ledger bl
        JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
        WHERE bl.user_id = u.user_id
        ORDER BY bls.sequence_number DESC
        LIMIT 1
      ) AS latest_transaction_id,
      obs.snapshot_balance AS opening_balance_snapshot,
      obs.policy_status AS opening_balance_policy_status
    FROM users u
    LEFT JOIN opening_balance_snapshots obs ON obs.user_id = u.user_id
    ORDER BY u.user_id ASC
  `).all();
  const unexplainedOffsets = [];
  const users = rowsFrom(result).map((row) => {
    const usersBalance = Number(row.balance);
    const hasLedger = row.latest_ledger_balance !== null && row.latest_ledger_balance !== undefined;
    const latestLedgerBalance = asNumberOrNull(row.latest_ledger_balance);
    const openingBalanceSnapshot = asNumberOrNull(row.opening_balance_snapshot);
    const difference = hasLedger ? usersBalance - latestLedgerBalance : null;
    const snapshotPolicyRequired = row.opening_balance_policy_status === 'REQUIRED';
    let status = 'CONSISTENT';
    if (snapshotPolicyRequired) status = 'OPENING_BALANCE_POLICY_REQUIRED';
    else if (!hasLedger) status = usersBalance === 0 ? 'NO_LEDGER_EVIDENCE' : 'OPENING_BALANCE_POLICY_REQUIRED';
    else if (difference !== 0) status = 'BALANCE_MISMATCH';

    if (status === 'BALANCE_MISMATCH') {
      unexplainedOffsets.push({
        userId: row.user_id,
        employeeId: row.employee_id || null,
        difference,
        status
      });
    }
    return {
      userId: row.user_id,
      employeeId: row.employee_id || null,
      lineUserId: row.line_user_id || null,
      displayName: row.display_name,
      usersBalance,
      latestLedgerBalance,
      latestTransactionId: row.latest_transaction_id || null,
      openingBalanceSnapshot,
      openingBalancePolicyStatus: row.opening_balance_policy_status || null,
      difference,
      status,
      isConsistent: status === 'CONSISTENT'
    };
  });
  const countByStatus = users.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});
  const usersBalanceTotal = users.reduce((sum, row) => sum + row.usersBalance, 0);
  const latestLedgerBalanceTotal = users.reduce((sum, row) => (
    sum + (row.latestLedgerBalance === null ? 0 : row.latestLedgerBalance)
  ), 0);
  const openingBalanceTotal = users.reduce((sum, row) => (
    sum + (row.openingBalanceSnapshot === null ? 0 : row.openingBalanceSnapshot)
  ), 0);
  const ledgerTotalsResult = await database.prepare(`
    SELECT COUNT(*) AS row_count, COALESCE(SUM(amount), 0) AS amount_total
    FROM balance_ledger
  `).first();
  return {
    userCount: users.length,
    consistentCount: countByStatus.CONSISTENT || 0,
    mismatchCount: countByStatus.BALANCE_MISMATCH || 0,
    openingBalancePolicyRequiredCount: countByStatus.OPENING_BALANCE_POLICY_REQUIRED || 0,
    noLedgerEvidenceCount: countByStatus.NO_LEDGER_EVIDENCE || 0,
    usersBalanceTotal,
    latestLedgerBalanceTotal,
    openingBalanceTotal,
    ledgerRowCount: Number(ledgerTotalsResult?.row_count || 0),
    ledgerAmountTotal: Number(ledgerTotalsResult?.amount_total || 0),
    unexplainedOffsets,
    allConsistent: users.every((row) => row.isConsistent) && unexplainedOffsets.length === 0,
    users
  };
};

export const buildBalanceReconciliation = reconcileBalances;
