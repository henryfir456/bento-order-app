export const formatSignedAmount = (value) => {
  const amount = Number(value || 0);
  return `${amount >= 0 ? '+' : '-'}$${Math.abs(amount)}`;
};

export const formatBalanceAmount = (value) => {
  const balance = Number(value || 0);
  return `${balance < 0 ? '-' : ''}$${Math.abs(balance)}`;
};
