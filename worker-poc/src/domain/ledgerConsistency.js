const policyIdFromNote = (note) => {
  const match = String(note || '').match(/(?:^|\s)policy_id=([^\s]+)/i);
  return match ? match[1] : null;
};

const rowDetails = (row) => ({
  sequenceNumber: Number(row.sequence_number),
  transactionId: row.transaction_id,
  type: row.type,
  amount: Number(row.amount),
  balanceBefore: Number(row.balance_after) - Number(row.amount),
  occurredAt: row.occurred_at || null,
  note: row.note || '',
  policyId: policyIdFromNote(row.note)
});

/**
 * Checks the immutable, sequence-backed balance chain without using users.balance
 * as an anchor. The first row establishes the only unavoidable baseline; every
 * later row must equal the previous sequenced balance plus its amount.
 */
export const analyzeLedgerRows = (rows = []) => {
  const ordered = rows.slice().sort((left, right) => (
    Number(left.sequence_number) - Number(right.sequence_number)
  ));
  if (ordered.length === 0) {
    return {
      status: 'CONSISTENT',
      initialBalanceBefore: null,
      sequenceDiscontinuities: [],
      propagatedRows: []
    };
  }

  const first = ordered[0];
  const initialBalanceBefore = Number(first.balance_after) - Number(first.amount);
  let cumulativeAmount = 0;
  const sequenceDiscontinuities = [];
  const propagatedRows = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];
    const amount = Number(row.amount);
    const actualBalanceAfter = Number(row.balance_after);
    cumulativeAmount += amount;
    const reconstructedBalanceAfter = initialBalanceBefore + cumulativeAmount;
    const previous = ordered[index - 1] || null;
    const previousBalanceAfter = previous ? Number(previous.balance_after) : null;
    const expectedBalanceAfter = previous
      ? previousBalanceAfter + amount
      : null;
    const localBreak = previous !== null && actualBalanceAfter !== expectedBalanceAfter;
    const chainOffset = actualBalanceAfter - reconstructedBalanceAfter;
    const details = {
      ...rowDetails(row),
      previousSequence: previous ? Number(previous.sequence_number) : null,
      previousBalanceAfter,
      expectedBalanceAfter,
      actualBalanceAfter,
      delta: localBreak ? actualBalanceAfter - expectedBalanceAfter : 0,
      reconstructedBalanceAfter,
      chainOffset
    };

    if (localBreak) sequenceDiscontinuities.push(details);
    else if (chainOffset !== 0) propagatedRows.push(details);
  }

  return {
    status: sequenceDiscontinuities.length > 0 ? 'LEDGER_CHAIN_DISCONTINUITY' : 'CONSISTENT',
    initialBalanceBefore,
    sequenceDiscontinuities,
    propagatedRows
  };
};

const inMonth = (row, monthStart, monthEnd) => (
  row.occurred_at >= monthStart && row.occurred_at < monthEnd
);

export const buildMonthlyReconciliation = ({
  allRows = [],
  monthRows = [],
  monthStart,
  monthEnd,
  openingBalance,
  closingBalance,
  openingSequence = null,
  closingSequence = null,
  totalCredit,
  totalDebit
}) => {
  const expectedClosingBalance = openingBalance === null || openingBalance === undefined
    ? null
    : Number(openingBalance) + Number(totalCredit) - Number(totalDebit);
  const monthlyDelta = expectedClosingBalance === null || closingBalance === null
    ? null
    : Number(closingBalance) - expectedClosingBalance;
  const monthIds = new Set(monthRows.map((row) => row.transaction_id));
  const firstMonthIndex = allRows.findIndex((row) => monthIds.has(row.transaction_id));
  let lastMonthIndex = -1;
  for (let index = allRows.length - 1; index >= 0; index -= 1) {
    if (monthIds.has(allRows[index].transaction_id)) {
      lastMonthIndex = index;
      break;
    }
  }
  const outOfPeriodSequenceRows = firstMonthIndex >= 0 && lastMonthIndex >= firstMonthIndex
    ? allRows
      .slice(firstMonthIndex, lastMonthIndex + 1)
      .filter((row) => !inMonth(row, monthStart, monthEnd))
      .map((row) => ({
        ...rowDetails(row),
        balanceAfter: Number(row.balance_after)
      }))
    : [];
  const adjustmentRows = monthRows
    .filter((row) => row.type === 'ADJUSTMENT')
    .map((row) => ({
      ...rowDetails(row),
      balanceAfter: Number(row.balance_after)
    }));
  const ledger = analyzeLedgerRows(allRows);
  const status = ledger.sequenceDiscontinuities.length > 0
    ? 'LEDGER_CHAIN_DISCONTINUITY'
    : monthlyDelta === 0
      ? 'CONSISTENT'
      : outOfPeriodSequenceRows.length > 0
        ? 'SEQUENCE_DATE_BOUNDARY_MISMATCH'
        : 'MONTHLY_AMOUNT_BALANCE_MISMATCH';

  return {
    status,
    expectedClosingBalance,
    actualClosingBalance: closingBalance,
    monthlyDelta,
    openingSequence: openingSequence === null || openingSequence === undefined
      ? null
      : Number(openingSequence),
    closingSequence: closingSequence === null || closingSequence === undefined
      ? null
      : Number(closingSequence),
    openingBalanceSource: openingSequence === null || openingSequence === undefined
      ? (monthRows.length > 0 ? 'first_sequenced_row_baseline' : 'empty_ledger_zero')
      : 'sequenced_ledger',
    closingBalanceSource: closingSequence === null || closingSequence === undefined
      ? 'opening_balance_fallback'
      : 'sequenced_ledger',
    outOfPeriodSequenceRows,
    adjustmentRows,
    sequenceDiscontinuities: ledger.sequenceDiscontinuities,
    propagatedRows: ledger.propagatedRows
  };
};
