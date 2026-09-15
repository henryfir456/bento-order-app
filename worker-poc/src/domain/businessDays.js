import { getTaipeiDate, isDateOnly } from './deadlines.js';
import { resolveClock } from '../db/transactions.js';

const isWeekend = (date) => {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
};

const formatDate = (date) => date.toISOString().slice(0, 10);

export const secondFollowingBusinessDay = (dateOnly) => {
  if (!isDateOnly(dateOnly)) return null;
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (isWeekend(date)) return null;

  let followingBusinessDays = 0;
  while (followingBusinessDays < 2) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (!isWeekend(date)) followingBusinessDays += 1;
  }
  return formatDate(date);
};

export const scheduledBusinessDates = (scheduledTime) => {
  const businessDate = getTaipeiDate(resolveClock(scheduledTime));
  return {
    businessDate,
    targetDate: secondFollowingBusinessDay(businessDate)
  };
};

