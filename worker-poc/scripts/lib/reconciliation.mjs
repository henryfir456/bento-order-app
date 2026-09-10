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
    readiness: validation?.readiness || {
      status: 'BLOCKED',
      blockers: [{ code: 'READINESS_NOT_COMPUTED' }]
    },
    identitySummary: validation?.summary?.identitySummary || {},
    financialSummary: validation?.summary?.financialSummary || {},
    duplicateMenuWarnings: warnings.filter((item) => (
      item.code === 'DUPLICATE_MENU_WARNING'
    )),
    orphanOrderCount: quarantine.filter((item) => (
      item.reasonCode === 'ORPHAN_ORDER_USER'
    )).length,
    incompleteLedgerCount: quarantine.filter((item) => (
      item.reasonCode === 'INCOMPLETE_LEDGER_POLICY'
    )).length,
    remoteImport: 'NOT EXECUTED',
    ...(balanceReconciliation ? { balanceReconciliation } : {}),
    ...(stagedCounts ? { stagedCounts } : {})
  };
};
