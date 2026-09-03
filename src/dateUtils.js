const TAIPEI_TIMEZONE = 'Asia/Taipei';

const getTaipeiDateParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  return parts.reduce((result, part) => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      result[part.type] = Number(part.value);
    }
    return result;
  }, {});
};

export const getTaipeiYearMonth = (date = new Date()) => {
  const { year, month } = getTaipeiDateParts(date);
  return { year, month };
};

export const formatDateInput = (date = new Date()) => {
  const { year, month, day } = getTaipeiDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const shiftYearMonth = (year, month, offset) => {
  const monthIndex = Number(year) * 12 + Number(month) - 1 + Number(offset);
  return {
    year: Math.floor(monthIndex / 12),
    month: (monthIndex % 12) + 1
  };
};
