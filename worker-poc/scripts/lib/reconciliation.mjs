export const buildReconciliation = (validation, { balanceReconciliation = null, stagedCounts = null } = {}) => {
  const quarantine = validation?.quarantine || [];
  const warnings = validation?.warnings || [];
  const identityFoundationReadiness = validation?.identityFoundationReadiness || {
    status: 'BLOCKED',
    blockers: [{ code: 'IDENTITY_FOUNDATION_NOT_COMPUTED' }]
  };
  const legacyImportReadiness = validation?.legacyImportReadiness || validation?.readiness || {
    status: 'BLOCKED',
    blockers: [{ code: 'LEGACY_IMPORT_READINESS_NOT_COMPUTED' }]
  };
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
    identityFoundationReadiness,
    legacyImportReadiness,
    readiness: legacyImportReadiness,
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
