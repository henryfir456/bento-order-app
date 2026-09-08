const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

export const reconcileBalances = async (database) => {
  const result = await database.prepare(`
    SELECT u.line_user_id, u.display_name, u.balance,
      (
        SELECT bl.balance_after
        FROM balance_ledger bl
        JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
        WHERE bl.line_user_id = u.line_user_id
        ORDER BY bls.sequence_number DESC
        LIMIT 1
      ) AS latest_ledger_balance,
      (
        SELECT bl.transaction_id
        FROM balance_ledger bl
        JOIN balance_ledger_sequence bls ON bls.transaction_id = bl.transaction_id
        WHERE bl.line_user_id = u.line_user_id
        ORDER BY bls.sequence_number DESC
        LIMIT 1
      ) AS latest_transaction_id,
      obs.snapshot_balance AS opening_balance_snapshot,
      obs.policy_status AS opening_balance_policy_status
    FROM users u
    LEFT JOIN opening_balance_snapshots obs ON obs.line_user_id = u.line_user_id
    ORDER BY u.line_user_id ASC
  `).all();
  const users = rowsFrom(result).map((row) => {
    const usersBalance = Number(row.balance);
    const hasLedger = row.latest_ledger_balance !== null && row.latest_ledger_balance !== undefined;
    const latestLedgerBalance = hasLedger ? Number(row.latest_ledger_balance) : null;
    const difference = hasLedger ? usersBalance - latestLedgerBalance : null;
    const snapshotPolicyRequired = row.opening_balance_policy_status === 'REQUIRED';
    let status = 'CONSISTENT';
    if (snapshotPolicyRequired) status = 'OPENING_BALANCE_POLICY_REQUIRED';
    else if (!hasLedger) status = usersBalance === 0 ? 'NO_LEDGER_EVIDENCE' : 'OPENING_BALANCE_POLICY_REQUIRED';
    else if (difference !== 0) status = 'BALANCE_MISMATCH';
    return {
      lineUserId: row.line_user_id,
      displayName: row.display_name,
      usersBalance,
      latestLedgerBalance,
      latestTransactionId: row.latest_transaction_id || null,
      openingBalanceSnapshot: row.opening_balance_snapshot === null
        || row.opening_balance_snapshot === undefined
        ? null
        : Number(row.opening_balance_snapshot),
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
  return {
    userCount: users.length,
    consistentCount: countByStatus.CONSISTENT || 0,
    mismatchCount: countByStatus.BALANCE_MISMATCH || 0,
    openingBalancePolicyRequiredCount: countByStatus.OPENING_BALANCE_POLICY_REQUIRED || 0,
    noLedgerEvidenceCount: countByStatus.NO_LEDGER_EVIDENCE || 0,
    allConsistent: users.every((row) => row.isConsistent),
    users
  };
};

export const buildBalanceReconciliation = reconcileBalances;
