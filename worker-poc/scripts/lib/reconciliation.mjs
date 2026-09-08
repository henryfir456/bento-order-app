export const buildReconciliation = (validation, { balanceReconciliation = null, stagedCounts = null } = {}) => {
  const quarantine = validation?.quarantine || [];
  const warnings = validation?.warnings || [];
  return {
    sourceHash: validation?.sourceHash || 'unknown-source',
    importerVersion: validation?.importerVersion || 'unknown-version',
    batchId: validation?.batchId || 'unknown-batch',
    sourceCounts: validation?.summary?.sourceCounts || {},
    acceptedCounts: validation?.summary?.acceptedCounts || {},
    quarantineCount: quarantine.length,
    warningCount: warnings.length,
    quarantineByReason: validation?.summary?.quarantineByReason || {},
    warningByCode: validation?.summary?.warningByCode || {},
    duplicateMenuWarnings: warnings.filter((item) => (
      item.code === 'DUPLICATE_MENU_WARNING'
    )),
    orphanOrderCount: quarantine.filter((item) => (
      item.reasonCode === 'ORPHAN_ORDER_USER'
    )).length,
    incompleteLedgerCount: quarantine.filter((item) => (
      item.reasonCode === 'INCOMPLETE_LEDGER_POLICY'
    )).length,
    ...(balanceReconciliation ? { balanceReconciliation } : {}),
    ...(stagedCounts ? { stagedCounts } : {})
  };
};
