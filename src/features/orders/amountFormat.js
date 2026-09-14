export const formatSignedAmount = (amount) => {
  const numeric = Number(amount ?? 0);
  const formatted = numeric.toLocaleString('en-US');
  return formatted.startsWith('-')
    ? `-$${formatted.slice(1)}`
    : `$${formatted}`;
};
