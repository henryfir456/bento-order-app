const TAIPEI_TIMEZONE = 'Asia/Taipei';

const getTaipeiParts = (date = new Date(), includeTime = false) => {
  const options = {
    timeZone: TAIPEI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  };
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.second = '2-digit';
    options.hourCycle = 'h23';
  }

  const parts = new Intl.DateTimeFormat('en-US', {
    ...options
  }).formatToParts(date);

  return parts.reduce((result, part) => {
    if (['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type)) {
      result[part.type] = Number(part.value);
    }
    return result;
  }, {});
};

const getTaipeiDateParts = (date = new Date()) => getTaipeiParts(date);

export const getTaipeiYearMonth = (date = new Date()) => {
  const { year, month } = getTaipeiDateParts(date);
  return { year, month };
};

export const formatDateInput = (date = new Date()) => {
  const { year, month, day } = getTaipeiDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const formatDateTime = (value) => {
  if (value === null || value === undefined || value === '') return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  const { year, month, day, hour, minute, second } = getTaipeiParts(date, true);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
};

export const shiftYearMonth = (year, month, offset) => {
  const monthIndex = Number(year) * 12 + Number(month) - 1 + Number(offset);
  return {
    year: Math.floor(monthIndex / 12),
    month: (monthIndex % 12) + 1
  };
};

export const getWeekdayLeadingBlankCount = (year, monthIndex) => {
  const firstDayOfWeek = new Date(year, monthIndex, 1).getDay();
  return firstDayOfWeek >= 1 && firstDayOfWeek <= 5 ? firstDayOfWeek - 1 : 0;
};
