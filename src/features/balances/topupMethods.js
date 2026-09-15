export const TOPUP_METHOD_OPTIONS = Object.freeze([
  { value: 'TAIWAN_PAY', label: '台灣 Pay' },
  { value: 'LINE_PAY_MONEY', label: 'LINE Pay MONEY' },
  { value: 'BANK_TRANSFER', label: '帳戶轉帳' },
  { value: 'CASH', label: '現金' },
  { value: 'IPASS_MONEY', label: 'iPASS MONEY' }
]);

const TOPUP_METHOD_LABELS = Object.freeze(
  Object.fromEntries(TOPUP_METHOD_OPTIONS.map(({ value, label }) => [value, label]))
);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const existingTransactionDescription = (transaction) => (
  text(transaction?.description)
  || text(transaction?.note)
  || text(transaction?.type)
  || '交易異動'
);

export const formatTransactionDescription = (transaction = {}) => {
  const methodLabel = transaction.type === 'TOPUP'
    ? TOPUP_METHOD_LABELS[text(transaction.topupMethod)]
    : '';
  if (!methodLabel) return existingTransactionDescription(transaction);

  const note = text(transaction.note);
  return note ? `${methodLabel}｜${note}` : methodLabel;
};
