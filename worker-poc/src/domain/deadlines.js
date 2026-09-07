export const TIME_ZONE = 'Asia/Taipei';

export const isDateOnly = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};

export const getTaipeiDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return parts.year + '-' + parts.month + '-' + parts.day;
};

export const deadlineAt = (orderDate, mode) => {
  if (!isDateOnly(orderDate)) return null;
  const [year, month, day] = orderDate.split('-').map(Number);
  const deadline = new Date(Date.UTC(year, month - 1, day));
  if (mode === 'B') {
    deadline.setUTCDate(deadline.getUTCDate() - 1);
    deadline.setUTCHours(10, 0, 0, 0);
  } else {
    deadline.setUTCHours(2, 0, 0, 0);
  }
  return deadline;
};

export const deadlineInfo = (orderDate, mode, now = new Date()) => {
  const deadline = deadlineAt(orderDate, mode);
  if (!deadline) return null;
  return {
    now: now.toISOString(),
    deadline: deadline.toISOString(),
    isExpired: now > deadline
  };
};
